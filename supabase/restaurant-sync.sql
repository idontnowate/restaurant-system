-- restaurant-sync.sql — قاعدة بيانات نظام المطاعم (عدة مطاعم + حسابات + مزامنة)
--
-- التشغيل: Supabase (مشروع المطعم) ← SQL Editor ← الصق الملف كاملاً ← Run.
-- يمكن تشغيله أكثر من مرة بأمان (عند كل تحديث للنظام).
--
-- بعد أول تشغيل أنشئ حساب المزوّد (أنت) مرة واحدة من SQL Editor:
--   select rms_provider_create('اسم_المستخدم', 'كلمة_مرور_قوية', 'اسمك');
--
-- البنية:
--  * rms_restaurants: المطاعم المشتركة واشتراكاتها (يديرها المزوّد من provider.html).
--  * rms_users: موظفو كل مطعم بأسماء مستخدمين وكلمات مرور مشفّرة (يديرهم مدير المطعم).
--  * rms_sessions: جلسات الدخول (يُحفظ تشفير الرمز فقط، لا الرمز نفسه).
--  * rms_data + rms_events: بيانات المطعم (نسخة كاملة) + العمليات المتزامنة (طلب، حالة، دفع…)
--    البيانات الحالية = النسخة الكاملة + العمليات التي بعدها بالترتيب (نفس منطق server.py).
--  * rms_images: صور الأطباق والشعار (منفصلة حتى تبقى المزامنة خفيفة).
--  * rms_orders: أرشيف الطلبات القديمة (للتقارير)، rms_log: سجل العمليات.
--  * كل الجداول مقفلة؛ الوصول فقط عبر الدوال أدناه التي تتحقق من الجلسة والصلاحية.

create extension if not exists pgcrypto with schema extensions;

-- النسخة التجريبية السابقة (مزامنة برمز) — لم تعد مستخدمة
drop function if exists public.rms_pull(text, bigint, bigint);
drop function if exists public.rms_save(text, jsonb, bigint);
drop function if exists public.rms_op(text, jsonb);

-- ===================== الجداول =====================
create table if not exists public.rms_providers (
  id         uuid primary key default gen_random_uuid(),
  username   text not null unique,
  pass_hash  text not null,
  name       text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.rms_restaurants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text not null default '',
  owner_name text not null default '',
  city       text not null default '',
  notes      text not null default '',
  active     boolean not null default true,
  expires_at timestamptz not null default now() + interval '30 days',
  max_users  int not null default 25,
  created_at timestamptz not null default now(),
  last_seen  timestamptz
);

create table if not exists public.rms_users (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.rms_restaurants(id) on delete cascade,
  username      text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  pass_hash     text not null,
  name          text not null,
  role          text not null check (role in ('مدير','كاشير','ويتر','طباخ','سائق')),
  shift         text not null default 'صباحي',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login    timestamptz
);
create index if not exists rms_users_restaurant on public.rms_users (restaurant_id);

create table if not exists public.rms_sessions (
  token_hash text primary key,
  kind       text not null check (kind in ('user','provider')),
  subject    uuid not null,
  device     text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists rms_sessions_subject on public.rms_sessions (subject);

create table if not exists public.rms_login_fail (
  username text not null,
  at       timestamptz not null default now()
);
create index if not exists rms_login_fail_user on public.rms_login_fail (username, at);

create table if not exists public.rms_data (
  restaurant_id uuid primary key references public.rms_restaurants(id) on delete cascade,
  version       bigint not null default 0,
  last_op       bigint not null default 0,
  state         jsonb,
  updated_at    timestamptz not null default now()
);

create table if not exists public.rms_events (
  id            bigserial primary key,
  restaurant_id uuid not null references public.rms_restaurants(id) on delete cascade,
  op            jsonb not null,
  created_at    timestamptz not null default now()
);
create index if not exists rms_events_restaurant on public.rms_events (restaurant_id, id);

create table if not exists public.rms_images (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.rms_restaurants(id) on delete cascade,
  data          text not null,
  created_at    timestamptz not null default now()
);
create index if not exists rms_images_restaurant on public.rms_images (restaurant_id);

create table if not exists public.rms_orders (
  restaurant_id uuid not null references public.rms_restaurants(id) on delete cascade,
  uid           text not null,
  created_at    timestamptz not null,
  data          jsonb not null,
  primary key (restaurant_id, uid)
);
create index if not exists rms_orders_time on public.rms_orders (restaurant_id, created_at);

create table if not exists public.rms_log (
  id            bigserial primary key,
  restaurant_id uuid not null references public.rms_restaurants(id) on delete cascade,
  at            timestamptz not null default now(),
  user_name     text not null default '',
  action        text not null,
  details       text not null default ''
);
create index if not exists rms_log_restaurant on public.rms_log (restaurant_id, id desc);

-- لا وصول مباشر لأي جدول من المتصفح
do $$ declare t text; begin
  foreach t in array array['rms_providers','rms_restaurants','rms_users','rms_sessions','rms_login_fail',
                           'rms_data','rms_events','rms_images','rms_orders','rms_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on sequence public.rms_events_id_seq, public.rms_log_id_seq from anon, authenticated;

-- ===================== أدوات داخلية =====================
create or replace function public.rms_hash(p text) returns text
language sql immutable set search_path = public, extensions
as $$ select encode(extensions.digest(p, 'sha256'), 'hex') $$;

create or replace function public.rms_new_session(p_kind text, p_subject uuid, p_device text) returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare tok text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  delete from public.rms_sessions where expires_at < now();
  insert into public.rms_sessions (token_hash, kind, subject, device, expires_at)
  values (public.rms_hash(tok), p_kind, p_subject, left(coalesce(p_device, ''), 200), now() + interval '60 days');
  return tok;
end $$;

-- يتحقق من جلسة موظف ويعيد بياناته، أو يرفض برسالة: AUTH / INACTIVE / SUSPENDED / EXPIRED
create or replace function public.rms_auth(p_token text) returns public.rms_users
language plpgsql security definer set search_path = public, extensions
as $$
declare u public.rms_users; r public.rms_restaurants;
begin
  select usr.* into u from public.rms_sessions s join public.rms_users usr on usr.id = s.subject
   where s.token_hash = public.rms_hash(coalesce(p_token, '')) and s.kind = 'user' and s.expires_at > now();
  if not found then raise exception 'AUTH'; end if;
  if not u.active then raise exception 'INACTIVE'; end if;
  select * into r from public.rms_restaurants where id = u.restaurant_id;
  if not r.active then raise exception 'SUSPENDED'; end if;
  if r.expires_at < now() then raise exception 'EXPIRED'; end if;
  if r.last_seen is null or r.last_seen < now() - interval '2 minutes' then
    update public.rms_restaurants set last_seen = now() where id = r.id;
  end if;
  return u;
end $$;

create or replace function public.rms_auth_manager(p_token text) returns public.rms_users
language plpgsql security definer set search_path = public, extensions
as $$
declare u public.rms_users := public.rms_auth(p_token);
begin
  if u.role <> 'مدير' then raise exception 'FORBIDDEN'; end if;
  return u;
end $$;

create or replace function public.rms_auth_provider(p_token text) returns public.rms_providers
language plpgsql security definer set search_path = public, extensions
as $$
declare p public.rms_providers;
begin
  select pr.* into p from public.rms_sessions s join public.rms_providers pr on pr.id = s.subject
   where s.token_hash = public.rms_hash(coalesce(p_token, '')) and s.kind = 'provider' and s.expires_at > now();
  if not found then raise exception 'AUTH'; end if;
  return p;
end $$;

create or replace function public.rms_add_log(p_restaurant uuid, p_user text, p_action text, p_details text) returns void
language sql security definer set search_path = public
as $$ insert into public.rms_log (restaurant_id, user_name, action, details)
      values (p_restaurant, coalesce(p_user, ''), left(p_action, 80), left(coalesce(p_details, ''), 1000)) $$;

create or replace function public.rms_user_json(u public.rms_users) returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('id', u.id, 'name', u.name, 'username', u.username, 'role', u.role, 'shift', u.shift,
    'restaurant', (select jsonb_build_object('id', r.id, 'name', r.name, 'expires_at', r.expires_at)
                   from public.rms_restaurants r where r.id = u.restaurant_id))
$$;

create or replace function public.rms_check_password(p text) returns void
language plpgsql immutable
as $$ begin
  if p is null or length(p) < 6 then raise exception 'WEAK_PASSWORD'; end if;
end $$;

-- ===================== الدخول =====================
create or replace function public.rms_login(p_username text, p_password text, p_device text default '')
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare uname text := lower(trim(coalesce(p_username, ''))); u public.rms_users; r public.rms_restaurants;
begin
  delete from public.rms_login_fail where at < now() - interval '1 day';
  if (select count(*) from public.rms_login_fail where username = uname and at > now() - interval '15 minutes') >= 8 then
    return jsonb_build_object('error', 'LOCKED');
  end if;
  select * into u from public.rms_users where username = uname;
  if not found or u.pass_hash <> extensions.crypt(coalesce(p_password, ''), u.pass_hash) then
    insert into public.rms_login_fail (username) values (uname);
    return jsonb_build_object('error', 'LOGIN');
  end if;
  delete from public.rms_login_fail where username = uname;
  if not u.active then return jsonb_build_object('error', 'INACTIVE'); end if;
  select * into r from public.rms_restaurants where id = u.restaurant_id;
  if not r.active then return jsonb_build_object('error', 'SUSPENDED'); end if;
  if r.expires_at < now() then return jsonb_build_object('error', 'EXPIRED'); end if;
  update public.rms_users set last_login = now() where id = u.id;
  perform public.rms_add_log(u.restaurant_id, u.name, 'دخول', coalesce(p_device, ''));
  return jsonb_build_object('token', public.rms_new_session('user', u.id, p_device), 'user', public.rms_user_json(u));
end $$;

create or replace function public.rms_session(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$ begin return public.rms_user_json(public.rms_auth(p_token)); end $$;

create or replace function public.rms_logout(p_token text) returns void
language sql security definer set search_path = public, extensions
as $$ delete from public.rms_sessions where token_hash = public.rms_hash(coalesce(p_token, '')) $$;

create or replace function public.rms_change_password(p_token text, p_old text, p_new text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare u public.rms_users := public.rms_auth(p_token);
begin
  if u.pass_hash <> extensions.crypt(coalesce(p_old, ''), u.pass_hash) then return jsonb_build_object('error', 'LOGIN'); end if;
  perform public.rms_check_password(p_new);
  update public.rms_users set pass_hash = extensions.crypt(p_new, extensions.gen_salt('bf')) where id = u.id;
  -- إنهاء الجلسات الأخرى لهذا الموظف
  delete from public.rms_sessions where subject = u.id and token_hash <> public.rms_hash(p_token);
  return jsonb_build_object('ok', true);
end $$;

-- ===================== المزامنة =====================
create or replace function public.rms_pull(p_token text, p_version bigint, p_after bigint)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare u public.rms_users := public.rms_auth(p_token); d public.rms_data; since bigint;
begin
  select * into d from public.rms_data where restaurant_id = u.restaurant_id;
  if not found or d.state is null then return jsonb_build_object('exists', false); end if;
  since := case when d.version = p_version then greatest(p_after, d.last_op) else d.last_op end;
  return jsonb_build_object(
    'exists', true, 'version', d.version, 'last_op', d.last_op,
    'state', case when d.version = p_version then null else d.state end,
    'ops', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'op', e.op) order by e.id)
                     from public.rms_events e where e.restaurant_id = u.restaurant_id and e.id > since), '[]'::jsonb));
end $$;

create or replace function public.rms_save(p_token text, p_state jsonb, p_folded bigint)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare u public.rms_users := public.rms_auth(p_token); v bigint; rid uuid := u.restaurant_id;
begin
  if jsonb_typeof(p_state) <> 'object' or pg_column_size(p_state) > 8000000 then raise exception 'TOO_BIG'; end if;
  insert into public.rms_data (restaurant_id) values (rid) on conflict (restaurant_id) do nothing;
  perform 1 from public.rms_data where restaurant_id = rid for update;
  update public.rms_data
     set state = p_state,
         last_op = greatest(0, least(p_folded, (select coalesce(max(id), 0) from public.rms_events where restaurant_id = rid))),
         version = version + 1, updated_at = now()
   where restaurant_id = rid returning version into v;
  delete from public.rms_events
   where restaurant_id = rid and id <= (select last_op from public.rms_data where restaurant_id = rid)
     and created_at < now() - interval '3 days';
  return jsonb_build_object('version', v);
end $$;

create or replace function public.rms_op(p_token text, p_op jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare u public.rms_users := public.rms_auth(p_token); new_id bigint;
begin
  if jsonb_typeof(p_op) <> 'object' or pg_column_size(p_op) > 100000 then raise exception 'TOO_BIG'; end if;
  -- القفل يضمن حفظ العمليات بالترتيب فلا يفوت جهازاً أي عملية
  perform 1 from public.rms_data where restaurant_id = u.restaurant_id and state is not null for update;
  if not found then raise exception 'NO_DATA'; end if;
  insert into public.rms_events (restaurant_id, op) values (u.restaurant_id, p_op) returning id into new_id;
  return jsonb_build_object('id', new_id);
end $$;

-- ===================== الموظفون (مدير المطعم) =====================
create or replace function public.rms_staff_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare u public.rms_users := public.rms_auth(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'username', x.username, 'role', x.role,
            'shift', x.shift, 'active', x.active, 'last_login', x.last_login) order by x.created_at)
          from public.rms_users x where x.restaurant_id = u.restaurant_id), '[]'::jsonb);
end $$;

-- p_user: {id?, name, username, password?, role, shift, active}
create or replace function public.rms_staff_save(p_token text, p_user jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  m public.rms_users := public.rms_auth_manager(p_token);
  uid uuid := nullif(p_user->>'id', '')::uuid;
  uname text := lower(trim(coalesce(p_user->>'username', '')));
  pw text := nullif(p_user->>'password', '');
  nm text := trim(coalesce(p_user->>'name', ''));
  rl text := coalesce(p_user->>'role', 'كاشير');
  limit_n int;
begin
  if nm = '' then raise exception 'NAME'; end if;
  if uname !~ '^[a-z0-9._-]{3,32}$' then raise exception 'USERNAME'; end if;
  if exists (select 1 from public.rms_users where username = uname and id is distinct from uid) then raise exception 'TAKEN'; end if;
  if pw is not null then perform public.rms_check_password(pw); end if;
  if uid is null then
    if pw is null then raise exception 'WEAK_PASSWORD'; end if;
    select max_users into limit_n from public.rms_restaurants where id = m.restaurant_id;
    if (select count(*) from public.rms_users where restaurant_id = m.restaurant_id) >= limit_n then raise exception 'LIMIT'; end if;
    insert into public.rms_users (restaurant_id, username, pass_hash, name, role, shift, active)
    values (m.restaurant_id, uname, extensions.crypt(pw, extensions.gen_salt('bf')), nm, rl,
            coalesce(p_user->>'shift', 'صباحي'), coalesce((p_user->>'active')::boolean, true))
    returning id into uid;
    perform public.rms_add_log(m.restaurant_id, m.name, 'إضافة موظف', nm || ' (' || rl || ')');
  else
    if not exists (select 1 from public.rms_users where id = uid and restaurant_id = m.restaurant_id) then raise exception 'FORBIDDEN'; end if;
    -- المدير لا يستطيع إيقاف نفسه أو تغيير دوره (حتى لا يبقى المطعم بلا مدير)
    if uid = m.id and (rl <> 'مدير' or not coalesce((p_user->>'active')::boolean, true)) then raise exception 'SELF'; end if;
    update public.rms_users set username = uname, name = nm, role = rl,
           shift = coalesce(p_user->>'shift', shift), active = coalesce((p_user->>'active')::boolean, active),
           pass_hash = case when pw is null then pass_hash else extensions.crypt(pw, extensions.gen_salt('bf')) end
     where id = uid;
    if pw is not null and uid <> m.id then delete from public.rms_sessions where subject = uid; end if;
    if not coalesce((p_user->>'active')::boolean, true) then delete from public.rms_sessions where subject = uid; end if;
    perform public.rms_add_log(m.restaurant_id, m.name, 'تعديل موظف',
      nm || ' (' || rl || ')' || case when pw is null then '' else ' — تغيير كلمة المرور' end);
  end if;
  return jsonb_build_object('id', uid);
end $$;

create or replace function public.rms_staff_delete(p_token text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare m public.rms_users := public.rms_auth_manager(p_token); nm text;
begin
  if p_id = m.id then raise exception 'SELF'; end if;
  delete from public.rms_users where id = p_id and restaurant_id = m.restaurant_id returning name into nm;
  if nm is null then raise exception 'FORBIDDEN'; end if;
  delete from public.rms_sessions where subject = p_id;
  perform public.rms_add_log(m.restaurant_id, m.name, 'حذف موظف', nm);
end $$;

-- ===================== الصور =====================
create or replace function public.rms_image_put(p_token text, p_data text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare u public.rms_users := public.rms_auth(p_token); new_id uuid;
begin
  if p_data !~ '^data:image/(jpeg|png|webp);base64,' or length(p_data) > 600000 then raise exception 'BAD_IMAGE'; end if;
  insert into public.rms_images (restaurant_id, data) values (u.restaurant_id, p_data) returning id into new_id;
  return jsonb_build_object('id', new_id);
end $$;

create or replace function public.rms_images_get(p_token text, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare u public.rms_users := public.rms_auth(p_token);
begin
  return coalesce((select jsonb_object_agg(id, data) from public.rms_images
                   where restaurant_id = u.restaurant_id and id = any(p_ids[1:200])), '{}'::jsonb);
end $$;

-- ===================== أرشيف الطلبات والسجل =====================
create or replace function public.rms_archive(p_token text, p_orders jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare u public.rms_users := public.rms_auth(p_token); n int;
begin
  if jsonb_typeof(p_orders) <> 'array' then raise exception 'BAD'; end if;
  insert into public.rms_orders (restaurant_id, uid, created_at, data)
  select u.restaurant_id, o->>'uid', to_timestamp((o->>'createdAt')::double precision / 1000), o
    from jsonb_array_elements(p_orders) o where coalesce(o->>'uid', '') <> ''
  on conflict (restaurant_id, uid) do update set data = excluded.data;
  get diagnostics n = row_count;
  return jsonb_build_object('saved', n);
end $$;

create or replace function public.rms_orders_range(p_token text, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare u public.rms_users := public.rms_auth(p_token);
begin
  return coalesce((select jsonb_agg(data order by created_at) from public.rms_orders
                   where restaurant_id = u.restaurant_id and created_at >= p_from and created_at < p_to), '[]'::jsonb);
end $$;

create or replace function public.rms_log_add(p_token text, p_action text, p_details text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare u public.rms_users := public.rms_auth(p_token);
begin perform public.rms_add_log(u.restaurant_id, u.name, p_action, p_details); end $$;

create or replace function public.rms_log_list(p_token text, p_limit int default 200) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare m public.rms_users := public.rms_auth_manager(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('at', at, 'user', user_name, 'action', action, 'details', details) order by id desc)
                   from (select * from public.rms_log where restaurant_id = m.restaurant_id order by id desc
                         limit least(greatest(p_limit, 1), 1000)) l), '[]'::jsonb);
end $$;

-- ===================== المزوّد (صاحب البرنامج) =====================
-- يُشغَّل من SQL Editor فقط (غير متاح من المتصفح)
create or replace function public.rms_provider_create(p_username text, p_password text, p_name text default '') returns text
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public.rms_check_password(p_password);
  insert into public.rms_providers (username, pass_hash, name)
  values (lower(trim(p_username)), extensions.crypt(p_password, extensions.gen_salt('bf')), coalesce(p_name, ''))
  on conflict (username) do update set pass_hash = excluded.pass_hash, name = excluded.name;
  return 'تم إنشاء حساب المزوّد: ' || lower(trim(p_username));
end $$;

create or replace function public.rms_provider_login(p_username text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare uname text := 'provider:' || lower(trim(coalesce(p_username, ''))); p public.rms_providers;
begin
  if (select count(*) from public.rms_login_fail where username = uname and at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('error', 'LOCKED');
  end if;
  select * into p from public.rms_providers where username = lower(trim(coalesce(p_username, '')));
  if not found or p.pass_hash <> extensions.crypt(coalesce(p_password, ''), p.pass_hash) then
    insert into public.rms_login_fail (username) values (uname);
    return jsonb_build_object('error', 'LOGIN');
  end if;
  delete from public.rms_login_fail where username = uname;
  return jsonb_build_object('token', public.rms_new_session('provider', p.id, 'provider'), 'name', p.name, 'username', p.username);
end $$;

create or replace function public.rms_provider_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare p public.rms_providers := public.rms_auth_provider(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'phone', r.phone, 'owner_name', r.owner_name, 'city', r.city, 'notes', r.notes,
      'active', r.active, 'expires_at', r.expires_at, 'max_users', r.max_users, 'created_at', r.created_at, 'last_seen', r.last_seen,
      'users', (select count(*) from public.rms_users x where x.restaurant_id = r.id),
      'managers', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'username', x.username)), '[]'::jsonb)
                   from public.rms_users x where x.restaurant_id = r.id and x.role = 'مدير'),
      'orders_30d', (select count(*) from public.rms_orders o where o.restaurant_id = r.id and o.created_at > now() - interval '30 days')
                  + coalesce((select count(*) from public.rms_data d, jsonb_array_elements(coalesce(d.state->'orders', '[]'::jsonb)) x
                              where d.restaurant_id = r.id and (x->>'createdAt')::double precision > extract(epoch from now() - interval '30 days') * 1000
                                and not exists (select 1 from public.rms_orders o2 where o2.restaurant_id = r.id and o2.uid = x->>'uid')), 0)
    ) order by r.created_at desc) from public.rms_restaurants r), '[]'::jsonb);
end $$;

-- p_r: {id?, name, phone, owner_name, city, notes, active, expires_at, max_users,
--       manager: {name, username, password}}  (المدير مطلوب عند الإنشاء فقط)
create or replace function public.rms_provider_restaurant_save(p_token text, p_r jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  p public.rms_providers := public.rms_auth_provider(p_token);
  rid uuid := nullif(p_r->>'id', '')::uuid;
  mg jsonb := p_r->'manager';
  uname text;
begin
  if trim(coalesce(p_r->>'name', '')) = '' then raise exception 'NAME'; end if;
  if rid is null then
    uname := lower(trim(coalesce(mg->>'username', '')));
    if uname !~ '^[a-z0-9._-]{3,32}$' then raise exception 'USERNAME'; end if;
    if exists (select 1 from public.rms_users where username = uname) then raise exception 'TAKEN'; end if;
    perform public.rms_check_password(mg->>'password');
    insert into public.rms_restaurants (name, phone, owner_name, city, notes, active, expires_at, max_users)
    values (trim(p_r->>'name'), coalesce(p_r->>'phone', ''), coalesce(p_r->>'owner_name', ''), coalesce(p_r->>'city', ''),
            coalesce(p_r->>'notes', ''), coalesce((p_r->>'active')::boolean, true),
            coalesce((p_r->>'expires_at')::timestamptz, now() + interval '30 days'), coalesce((p_r->>'max_users')::int, 25))
    returning id into rid;
    insert into public.rms_users (restaurant_id, username, pass_hash, name, role)
    values (rid, uname, extensions.crypt(mg->>'password', extensions.gen_salt('bf')),
            coalesce(nullif(trim(mg->>'name'), ''), 'المدير'), 'مدير');
    perform public.rms_add_log(rid, 'المزوّد', 'إنشاء المطعم', '');
  else
    update public.rms_restaurants set
      name = trim(p_r->>'name'),
      phone = coalesce(p_r->>'phone', phone), owner_name = coalesce(p_r->>'owner_name', owner_name),
      city = coalesce(p_r->>'city', city), notes = coalesce(p_r->>'notes', notes),
      active = coalesce((p_r->>'active')::boolean, active),
      expires_at = coalesce((p_r->>'expires_at')::timestamptz, expires_at),
      max_users = coalesce((p_r->>'max_users')::int, max_users)
    where id = rid;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform public.rms_add_log(rid, 'المزوّد', 'تعديل الاشتراك',
      'ينتهي ' || to_char((select expires_at from public.rms_restaurants where id = rid), 'YYYY-MM-DD') ||
      case when (select active from public.rms_restaurants where id = rid) then '' else ' — موقوف' end);
  end if;
  return jsonb_build_object('id', rid);
end $$;

create or replace function public.rms_provider_restaurant_delete(p_token text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare p public.rms_providers := public.rms_auth_provider(p_token);
begin
  delete from public.rms_sessions where subject in (select id from public.rms_users where restaurant_id = p_id);
  delete from public.rms_restaurants where id = p_id;
end $$;

create or replace function public.rms_provider_users(p_token text, p_restaurant uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare p public.rms_providers := public.rms_auth_provider(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'username', x.username, 'role', x.role,
            'active', x.active, 'last_login', x.last_login) order by x.created_at)
          from public.rms_users x where x.restaurant_id = p_restaurant), '[]'::jsonb);
end $$;

create or replace function public.rms_provider_reset_password(p_token text, p_user uuid, p_password text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare p public.rms_providers := public.rms_auth_provider(p_token); rid uuid;
begin
  perform public.rms_check_password(p_password);
  update public.rms_users set pass_hash = extensions.crypt(p_password, extensions.gen_salt('bf')), active = true
   where id = p_user returning restaurant_id into rid;
  if rid is null then raise exception 'NOT_FOUND'; end if;
  delete from public.rms_sessions where subject = p_user;
  delete from public.rms_login_fail where username = (select username from public.rms_users where id = p_user);
  perform public.rms_add_log(rid, 'المزوّد', 'إعادة تعيين كلمة مرور', (select name from public.rms_users where id = p_user));
end $$;

create or replace function public.rms_provider_change_password(p_token text, p_old text, p_new text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare p public.rms_providers := public.rms_auth_provider(p_token);
begin
  if p.pass_hash <> extensions.crypt(coalesce(p_old, ''), p.pass_hash) then return jsonb_build_object('error', 'LOGIN'); end if;
  perform public.rms_check_password(p_new);
  update public.rms_providers set pass_hash = extensions.crypt(p_new, extensions.gen_salt('bf')) where id = p.id;
  delete from public.rms_sessions where subject = p.id and token_hash <> public.rms_hash(p_token);
  return jsonb_build_object('ok', true);
end $$;

-- ===================== الصلاحيات =====================
-- الدوال الداخلية لا تُستدعى من المتصفح
do $$ declare f text; begin
  foreach f in array array[
    'rms_hash(text)', 'rms_new_session(text,uuid,text)', 'rms_auth(text)', 'rms_auth_manager(text)', 'rms_auth_provider(text)',
    'rms_add_log(uuid,text,text,text)', 'rms_user_json(rms_users)', 'rms_check_password(text)', 'rms_provider_create(text,text,text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'rms_login(text,text,text)', 'rms_session(text)', 'rms_logout(text)', 'rms_change_password(text,text,text)',
    'rms_pull(text,bigint,bigint)', 'rms_save(text,jsonb,bigint)', 'rms_op(text,jsonb)',
    'rms_staff_list(text)', 'rms_staff_save(text,jsonb)', 'rms_staff_delete(text,uuid)',
    'rms_image_put(text,text)', 'rms_images_get(text,uuid[])',
    'rms_archive(text,jsonb)', 'rms_orders_range(text,timestamptz,timestamptz)', 'rms_log_add(text,text,text)', 'rms_log_list(text,int)',
    'rms_provider_login(text,text)', 'rms_provider_list(text)', 'rms_provider_restaurant_save(text,jsonb)',
    'rms_provider_restaurant_delete(text,uuid)', 'rms_provider_users(text,uuid)', 'rms_provider_reset_password(text,uuid,text)',
    'rms_provider_change_password(text,text,text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
