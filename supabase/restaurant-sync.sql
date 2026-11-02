-- restaurant-sync.sql — مزامنة نظام المطعم عبر الإنترنت (Supabase)
--
-- التشغيل: Supabase ← SQL Editor ← الصق الملف كاملاً ← Run. يمكن تشغيله أكثر من مرة بأمان.
--
-- الفكرة (نفس منطق server.py):
--  * كل مطعم له «رمز» سري طويل. من يملك الرمز يقرأ ويكتب بيانات المطعم (يُعطى للأجهزة عبر QR).
--  * rms_state: آخر نسخة كاملة من بيانات المطعم (المنيو، الإعدادات، الطاولات...).
--  * rms_ops: العمليات التي قد تحدث من عدة أجهزة بنفس اللحظة (طلب جديد، حالة طلب، حالة طاولة).
--    البيانات الحالية = النسخة الكاملة + العمليات التي بعدها بالترتيب، فلا يضيع طلب أرسله ويتر
--    بينما الكاشير يعدّل المنيو.
--  * الجداول مقفلة تماماً؛ الوصول فقط عبر الدوال الثلاث التي تتحقق من الرمز.

create table if not exists public.rms_state (
  code       text primary key check (code ~ '^[A-Z0-9]{20,64}$'),
  version    bigint not null default 0,
  last_op    bigint not null default 0,      -- آخر عملية مدموجة داخل state
  state      jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rms_ops (
  id         bigserial primary key,
  code       text not null references public.rms_state(code) on delete cascade,
  op         jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists rms_ops_code_id on public.rms_ops (code, id);

-- لا وصول مباشر للجداول من المتصفح
alter table public.rms_state enable row level security;
alter table public.rms_ops   enable row level security;
revoke all on public.rms_state, public.rms_ops from anon, authenticated;
revoke all on sequence public.rms_ops_id_seq from anon, authenticated;

-- ===== قراءة التحديثات =====
-- p_version: آخر نسخة كاملة عند الجهاز، p_after: آخر عملية طبّقها.
-- إذا تغيّرت النسخة الكاملة نعيدها مع العمليات التي بعدها، وإلا نعيد العمليات الجديدة فقط.
create or replace function public.rms_pull(p_code text, p_version bigint, p_after bigint)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  r public.rms_state;
  since bigint;
begin
  select * into r from public.rms_state where code = p_code;
  if not found or r.state is null then
    return jsonb_build_object('exists', false);
  end if;
  since := case when r.version = p_version then greatest(p_after, r.last_op) else r.last_op end;
  return jsonb_build_object(
    'exists',  true,
    'version', r.version,
    'last_op', r.last_op,
    'state',   case when r.version = p_version then null else r.state end,
    'ops', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'op', o.op) order by o.id)
      from public.rms_ops o where o.code = p_code and o.id > since
    ), '[]'::jsonb)
  );
end $$;

-- ===== حفظ النسخة الكاملة =====
-- p_folded: آخر عملية موجودة داخل p_state. العمليات بعدها تبقى وتُطبَّق فوقها عند كل الأجهزة.
create or replace function public.rms_save(p_code text, p_state jsonb, p_folded bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v bigint;
begin
  if p_code !~ '^[A-Z0-9]{20,64}$' then raise exception 'bad code'; end if;
  if jsonb_typeof(p_state) <> 'object' or pg_column_size(p_state) > 8000000 then
    raise exception 'bad state';
  end if;
  insert into public.rms_state (code) values (p_code) on conflict (code) do nothing;
  perform 1 from public.rms_state where code = p_code for update;
  update public.rms_state
     set state = p_state,
         last_op = greatest(0, least(p_folded, (select coalesce(max(id), 0) from public.rms_ops where code = p_code))),
         version = version + 1,
         updated_at = now()
   where code = p_code
  returning version into v;
  -- تنظيف العمليات القديمة المدموجة (نبقيها 3 أيام لجهاز كان مطفأً ثم عاد)
  delete from public.rms_ops
   where code = p_code
     and id <= (select last_op from public.rms_state where code = p_code)
     and created_at < now() - interval '3 days';
  return jsonb_build_object('version', v);
end $$;

-- ===== عملية من جهاز (طلب جديد، حالة طلب، حالة طاولة) =====
create or replace function public.rms_op(p_code text, p_op jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  new_id bigint;
begin
  if jsonb_typeof(p_op) <> 'object' or pg_column_size(p_op) > 100000 then
    raise exception 'bad op';
  end if;
  -- القفل يضمن أن أرقام العمليات تُحفظ بالترتيب، فلا يفوت جهازاً أي عملية
  perform 1 from public.rms_state where code = p_code and state is not null for update;
  if not found then raise exception 'unknown restaurant'; end if;
  insert into public.rms_ops (code, op) values (p_code, p_op) returning id into new_id;
  update public.rms_state set updated_at = now() where code = p_code;
  return jsonb_build_object('id', new_id);
end $$;

revoke all on function public.rms_pull(text, bigint, bigint) from public;
revoke all on function public.rms_save(text, jsonb, bigint)  from public;
revoke all on function public.rms_op(text, jsonb)            from public;
grant execute on function public.rms_pull(text, bigint, bigint) to anon, authenticated;
grant execute on function public.rms_save(text, jsonb, bigint)  to anon, authenticated;
grant execute on function public.rms_op(text, jsonb)            to anon, authenticated;
