/* core.js — البيانات والمزامنة والأدوات المشتركة بين لوحة الإدارة وتطبيق الويتر
 *
 * يعمل بثلاث طرق (تُختار تلقائياً عند فتح الصفحة):
 *  server — خادم المطعم (server.py) على نفس شبكة الواي فاي، بدون حسابات.
 *  cloud  — عبر الإنترنت (Supabase): كل مطعم بحساباته وبياناته، مع تسجيل دخول.
 *  local  — هذا المتصفح فقط (للتجربة عندما لا يوجد خادم ولا إنترنت مُعد).
 */

/* ============ الإعدادات الافتراضية ============ */
const DEF_SETTINGS={
  name:'اسم المطعم', branch:'الفرع الرئيسي', phone:'', address:'', logo:'🍽', logoImg:null,
  currency:'د.ع', usdRate:1310,
  types:{'صالة':true,'سفري':true,'توصيل':true}, service:10, tax:0, maxDiscount:20, roundTo:250, requireTable:true,
  pays:{'نقدي':true,'بطاقة':true,'محفظة':true,'آجل':false},
  receiptHeader:'أهلاً وسهلاً بكم', receiptFooter:'شكراً لزيارتكم — نتمنى لكم وجبة شهية', receiptWidth:'80', autoPrint:false, showQR:false, showLogo:true,
  warnMin:10, lateMin:20, kdsSound:true, kitchenTicket:false,
  deliveryFee:2000, minDelivery:10000, zones:[{name:'المنطقة 1',fee:2000}],
  autoDeduct:true, sellOutOfStock:true, lowAlert:true,
  openingCash:100000, closeShift:true, pointsPer:1000,
};
const EXPENSE_CATS=['إيجار','رواتب','كهرباء','مولدة','غاز','ماء','مواد تنظيف','صيانة','تسويق','نقل','أخرى'];

/* ============ الأدوار والصلاحيات ============ */
const ROLES=['مدير','كاشير','ويتر','طباخ','سائق'];
// كل صف خانة يتحكم بها المدير: صفحة كاملة أو جزء داخل صفحة
const PERM_ROWS=[
  {group:'الصفحات'},
  {k:'dash',t:'لوحة التحكم'},{k:'pos',t:'نقطة البيع'},{k:'kds',t:'شاشة المطبخ'},{k:'tables',t:'الطاولات والحجوزات'},
  {k:'orders',t:'سجل الطلبات'},{k:'menu',t:'المنيو'},{k:'inv',t:'المخزون'},{k:'cust',t:'العملاء'},
  {k:'cash',t:'الصندوق والوردية'},{k:'expenses',t:'المصاريف'},{k:'reports',t:'التقارير'},
  {k:'staff',t:'الموظفين'},{k:'log',t:'سجل العمليات'},{k:'settings',t:'الإعدادات'},
  {group:'الخانات والعمليات'},
  {k:'sales',t:'رؤية أرقام المبيعات',h:'إجمالي المبيعات ومتوسط الفاتورة في لوحة التحكم'},
  {k:'cost',t:'رؤية التكلفة والأرباح',h:'تكلفة الصنف، نسبة التكلفة، قيمة المخزون'},
  {k:'discount',t:'إعطاء خصم',h:'خانة الخصم في نقطة البيع والحساب'},
  {k:'void',t:'إلغاء الطلبات',h:'إلغاء طلب مسجل مع ذكر السبب (يُسجل في سجل العمليات)'},
  {k:'editPrice',t:'تعديل الأسعار',h:'تعديل سعر الصنف من المنيو'},
  {k:'addItem',t:'إضافة وتعديل الأصناف',h:'زر «صنف جديد» في نقطة البيع والمنيو، والتصنيفات'},
  {k:'tablesEdit',t:'تعديل الطوابق والطاولات',h:'إضافة طوابق وأقسام وطاولات'},
  {k:'stockIn',t:'استلام بضاعة وتسجيل الهدر',h:'إضافة كميات للمخزون أو خصم التالف'},
  {k:'invEdit',t:'إضافة وتعديل المواد',h:'إضافة مادة خام جديدة أو حذفها'},
  {k:'waiterApp',t:'تطبيق الويتر',h:'الدخول لتطبيق الويتر من الموبايل'},
];
const DEF_PERMS={
  'كاشير':{dash:true,pos:true,tables:true,orders:true,cust:true,discount:true,kds:true,cash:true},
  'ويتر':{tables:true,pos:true,waiterApp:true},
  'طباخ':{kds:true,inv:true,stockIn:true},
  'سائق':{orders:true},
};

/* ============ بيانات البداية ============ */
// مطعم جديد على الإنترنت: يبدأ نظيفاً مع هيكل جاهز
function BLANK(name){
  return {
    settings:{...structuredClone(DEF_SETTINGS),name:name||DEF_SETTINGS.name},
    perms:structuredClone(DEF_PERMS),
    categories:['مشويات','سندويشات','مقبلات','مشروبات','حلويات'],
    inventory:[], menu:[],
    floors:[{id:'f1',name:'الطابق الأرضي',sections:[{id:'s1',name:'الصالة الرئيسية'}]}],
    tables:[1,2,3,4,5,6].map(i=>({id:i,seats:4,status:'free',section:'s1'})),
    staff:[], customers:[], orders:[], expenses:[], shifts:[], reservations:[], waste:[], log:[],
    nextId:1, shiftStart:Date.now(),
  };
}
// بيانات تجريبية للوضع المحلي (للعرض والتجربة)
function SEED(){
  const st=['free','busy','free','res','bill','free','busy','free','free','res','free','free'];
  const sec=['s1','s1','s1','s1','s1','s2','s2','s2','s3','s3','s4','s4'];
  return {
  settings:{...structuredClone(DEF_SETTINGS),name:'مطعم الديرة',phone:'07700000000',address:'بغداد - المنصور',
    zones:[{name:'المنصور',fee:2000},{name:'الكرادة',fee:3000},{name:'زيونة',fee:3000}]},
  perms:structuredClone(DEF_PERMS),
  categories:['مشويات','شاورما','برغر','مقبلات','مشروبات','حلويات'],
  inventory:[
    {id:'chk',name:'صدور دجاج',unit:'كغم',qty:18,min:10,cost:9000},
    {id:'meat',name:'لحم غنم',unit:'كغم',qty:6,min:8,cost:22000},
    {id:'bread',name:'خبز صمون',unit:'قطعة',qty:240,min:100,cost:150},
    {id:'bun',name:'خبز برغر',unit:'قطعة',qty:35,min:40,cost:300},
    {id:'rice',name:'رز',unit:'كغم',qty:40,min:15,cost:2500},
    {id:'veg',name:'خضروات مشكلة',unit:'كغم',qty:12,min:5,cost:1500},
    {id:'oil',name:'زيت قلي',unit:'لتر',qty:20,min:10,cost:3000},
    {id:'cola',name:'مشروبات غازية',unit:'علبة',qty:96,min:48,cost:400},
    {id:'potato',name:'بطاطا',unit:'كغم',qty:25,min:10,cost:1000},
  ],
  menu:[
    {id:1,name:'تكة دجاج',cat:'مشويات',price:12000,emo:'🍢',on:true,recipe:{chk:.3,bread:2,veg:.1}},
    {id:2,name:'كباب لحم',cat:'مشويات',price:15000,emo:'🥩',on:true,recipe:{meat:.3,bread:2,veg:.1}},
    {id:3,name:'مشكل مشويات',cat:'مشويات',price:28000,emo:'🍖',on:true,recipe:{meat:.3,chk:.3,bread:3,rice:.2}},
    {id:4,name:'شاورما دجاج صمون',cat:'شاورما',price:3000,emo:'🌯',on:true,recipe:{chk:.12,bread:1}},
    {id:5,name:'شاورما لحم صمون',cat:'شاورما',price:4000,emo:'🥙',on:true,recipe:{meat:.12,bread:1}},
    {id:6,name:'وجبة شاورما عربي',cat:'شاورما',price:7000,emo:'🍱',on:true,recipe:{chk:.2,bread:1,potato:.15}},
    {id:7,name:'برغر لحم',cat:'برغر',price:8000,emo:'🍔',on:true,recipe:{meat:.15,bun:1,potato:.15}},
    {id:8,name:'برغر دجاج كرسبي',cat:'برغر',price:7000,emo:'🍔',on:true,recipe:{chk:.15,bun:1,oil:.05}},
    {id:9,name:'بطاطا مقلية',cat:'مقبلات',price:2500,emo:'🍟',on:true,recipe:{potato:.25,oil:.05}},
    {id:10,name:'حمص',cat:'مقبلات',price:3000,emo:'🥣',on:true,recipe:{}},
    {id:11,name:'سلطة',cat:'مقبلات',price:3000,emo:'🥗',on:true,recipe:{veg:.25}},
    {id:12,name:'كولا',cat:'مشروبات',price:1000,emo:'🥤',on:true,recipe:{cola:1}},
    {id:13,name:'عصير برتقال',cat:'مشروبات',price:3000,emo:'🍊',on:true,recipe:{}},
    {id:14,name:'لبن',cat:'مشروبات',price:1000,emo:'🥛',on:false,recipe:{}},
    {id:15,name:'كنافة',cat:'حلويات',price:5000,emo:'🍮',on:true,recipe:{}},
    {id:16,name:'زلابية',cat:'حلويات',price:3000,emo:'🍩',on:true,recipe:{}},
  ],
  floors:[
    {id:'f1',name:'الطابق الأرضي',sections:[{id:'s1',name:'الصالة الرئيسية'},{id:'s2',name:'صالة العوائل'}]},
    {id:'f2',name:'الطابق الأول',sections:[{id:'s3',name:'قسم VIP'},{id:'s4',name:'التراس'}]},
  ],
  tables:st.map((s,i)=>({id:i+1,seats:[2,4,4,6][i%4],status:s,section:sec[i]})),
  staff:[
    {id:1,name:'علي حسين',role:'مدير',shift:'صباحي',on:true},
    {id:2,name:'زينب كريم',role:'كاشير',shift:'صباحي',on:true},
    {id:3,name:'مصطفى جاسم',role:'ويتر',shift:'صباحي',on:true},
    {id:4,name:'حيدر عباس',role:'طباخ',shift:'صباحي',on:true},
    {id:5,name:'سجاد محمد',role:'سائق',shift:'مسائي',on:false},
    {id:6,name:'نور الهدى',role:'كاشير',shift:'مسائي',on:false},
    {id:7,name:'كرار علي',role:'ويتر',shift:'مسائي',on:true},
  ],
  customers:[
    {id:'c1',name:'أحمد ستار',phone:'07701234567',address:'المنصور',orders:23,spent:412000,points:412},
    {id:'c2',name:'مريم علي',phone:'07809876543',address:'',orders:11,spent:186000,points:186},
    {id:'c3',name:'شركة النور',phone:'07501112233',address:'',orders:40,spent:1250000,points:1250},
  ],
  orders:seedOrders(), expenses:[], shifts:[], reservations:[], waste:[], log:[],
  nextId:1050, shiftStart:new Date().setHours(0,0,0,0),
  };
}
function seedOrders(){
  const now=Date.now(), out=[], pays=['نقدي','نقدي','بطاقة','محفظة'], types=['صالة','سفري','توصيل'];
  const picks=[[4,2,12,2],[1,1,9,1,11,1],[7,2,9,2,12,2],[3,1,10,1,13,2],[6,3],[2,1,11,1,15,1],[5,4,12,4],[8,1,9,1]];
  for(let i=0;i<34;i++){
    const p=picks[i%picks.length], items=[];
    for(let j=0;j<p.length;j+=2) items.push({id:p[j],qty:p[j+1]});
    const h=8+Math.floor(Math.pow(Math.random(),.6)*Math.min(14,new Date().getHours()-7||1));
    const d=new Date(); d.setHours(h,Math.floor(Math.random()*60));
    out.push({id:1000+i,uid:'seed'+i,type:types[i%3],table:null,items,status:'done',pay:pays[i%4],discount:0,by:'زينب كريم',createdAt:Math.min(d.getTime(),now-3600e3)});
  }
  out.push({id:1040,uid:'seed40',type:'صالة',table:2,items:[{id:1,qty:2},{id:11,qty:1},{id:12,qty:2}],status:'preparing',pay:null,discount:0,by:'مصطفى جاسم',createdAt:now-14*60e3});
  out.push({id:1041,uid:'seed41',type:'سفري',table:null,items:[{id:4,qty:3,note:'بدون مخلل'},{id:9,qty:1}],status:'new',pay:'نقدي',discount:0,by:'زينب كريم',createdAt:now-4*60e3});
  out.push({id:1042,uid:'seed42',type:'صالة',table:7,items:[{id:3,qty:1},{id:10,qty:2},{id:13,qty:2}],status:'new',pay:null,discount:0,by:'كرار علي',createdAt:now-2*60e3});
  out.push({id:1043,uid:'seed43',type:'توصيل',table:null,items:[{id:7,qty:2},{id:9,qty:2}],status:'ready',pay:'نقدي',discount:0,by:'زينب كريم',
    customer:{name:'أحمد ستار',phone:'07701234567',address:'المنصور'},createdAt:now-22*60e3});
  out.push({id:1044,uid:'seed44',type:'صالة',table:5,items:[{id:2,qty:2},{id:11,qty:2}],status:'done',pay:null,discount:0,by:'مصطفى جاسم',createdAt:now-50*60e3});
  return out;
}

// بيانات محفوظة بنسخة أقدم: نضيف ما استجد بقيمه الافتراضية
function migrate(){
  S.settings={...structuredClone(DEF_SETTINGS),...S.settings};
  delete S.settings.tablesCount;
  S.perms=S.perms||structuredClone(DEF_PERMS);
  if(!S.floors){
    S.floors=[{id:'f1',name:'الطابق الأرضي',sections:[{id:'s1',name:'الصالة الرئيسية'}]}];
    S.tables.forEach(t=>t.section='s1');
  }
  for(const k of ['staff','customers','orders','expenses','shifts','reservations','waste','log','inventory','menu','categories']) S[k]=S[k]||[];
  if(!S.shiftStart) S.shiftStart=new Date().setHours(0,0,0,0);
  if(!S.nextId) S.nextId=1;
  S.staff.forEach((p,i)=>{if(!p.id)p.id=i+1});
  S.customers.forEach((c,i)=>{if(!c.id)c.id='c'+i+uid()});
  S.orders.forEach(o=>{if(!o.uid)o.uid='o'+o.id});
}

/* ============ الحفظ والمزامنة ============ */
// مشروع Supabase الخاص بالمطعم. اتركهما فارغين لإيقاف العمل عبر الإنترنت.
const CLOUD={url:'https://pjgskvedvswfshiigykk.supabase.co', key:'sb_publishable_iwliAUV1iaP6D5GFBdtBCQ_YEthFLao'};
const CLOUD_READY=!!(CLOUD.url&&CLOUD.key);
const KEY='rms-proto-v1', SKEY='rms-session', CCACHE='rms-cloud-cache';
let MODE='local';
let S=null, V=0, putTimer=null, putting=false, dirty=false, online=true;
let lastOp=0;          // (cloud) آخر عملية طبّقها هذا الجهاز
let onRemote=()=>{};   // تضعها كل صفحة: ماذا تفعل عند وصول تحديث من جهاز آخر

const lsGet=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const lsSet=(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v);return true}catch(e){return false}};
let SESSION=null; try{SESSION=JSON.parse(lsGet(SKEY))}catch(e){}
const TOKEN=()=>SESSION?.token;

async function api(path,opt={}){
  const r=await fetch(path,{headers:{'Content-Type':'application/json'},cache:'no-store',...opt});
  if(!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
}
// استدعاء دالة في Supabase. الأخطاء تعود برمز مثل AUTH أو EXPIRED
const BLOCKING=['AUTH','INACTIVE','SUSPENDED','EXPIRED'];
async function rpc(fn,args={},{noAuth=false}={}){
  let r;
  try{
    r=await fetch(`${CLOUD.url}/rest/v1/rpc/${fn}`,{method:'POST',cache:'no-store',
      headers:{apikey:CLOUD.key,Authorization:'Bearer '+CLOUD.key,'Content-Type':'application/json'},
      body:JSON.stringify(args),signal:AbortSignal.timeout?AbortSignal.timeout(25000):undefined});
  }catch(e){const x=new Error('NETWORK');x.code='NETWORK';throw x}
  if(!r.ok){
    let m='HTTP'+r.status; try{m=(await r.json()).message||m}catch(e){}
    const x=new Error(m); x.code=m;
    if(!noAuth&&BLOCKING.includes(m)) blocked(m);
    throw x;
  }
  return r.json();
}
const ERR_TEXT={
  NETWORK:'لا يوجد اتصال بالإنترنت', LOGIN:'اسم المستخدم أو كلمة المرور غير صحيحة',
  LOCKED:'محاولات كثيرة خاطئة — حاول بعد 15 دقيقة', INACTIVE:'هذا الحساب موقوف — راجع مدير المطعم',
  SUSPENDED:'اشتراك المطعم موقوف — تواصل مع مزوّد البرنامج', EXPIRED:'انتهى اشتراك المطعم — تواصل مع مزوّد البرنامج لتجديده',
  AUTH:'انتهت الجلسة — سجّل الدخول مرة أخرى', FORBIDDEN:'ليست لديك صلاحية لهذه العملية',
  TAKEN:'اسم المستخدم مستخدم من قبل — اختر اسماً آخر', USERNAME:'اسم المستخدم: 3 أحرف على الأقل، إنجليزي وأرقام فقط (. _ - مسموحة)',
  WEAK_PASSWORD:'كلمة المرور يجب أن تكون 6 أحرف على الأقل', NAME:'أدخل الاسم', SELF:'لا يمكنك إيقاف حسابك أو تغيير دورك',
  LIMIT:'وصلت للحد الأقصى من الموظفين في اشتراكك', BAD_IMAGE:'الصورة غير صالحة أو كبيرة جداً', TOO_BIG:'البيانات كبيرة جداً — قلّل الصور',
  NOT_FOUND:'غير موجود',
};
const errText=e=>{
  const c=e?.code||e?.message||e;
  if(/Could not find the function|schema cache/.test(c)) return 'قاعدة البيانات غير مُحدَّثة — شغّل ملف supabase/restaurant-sync.sql في Supabase';
  return ERR_TEXT[c]||('حدث خطأ: '+c);
};

const PAGE=location.pathname.split('/').pop()||'index.html';
function goLogin(reason){
  location.replace('login.html?next='+encodeURIComponent(PAGE)+(reason?'&r='+reason:''));
}
// الجلسة لم تعد صالحة أو الاشتراك متوقف: نوقف الصفحة ونشرح السبب
let blockedShown=false;
function blocked(code){
  if(blockedShown) return; blockedShown=true;
  if(code==='AUTH'||code==='INACTIVE'){lsSet(SKEY,null);return goLogin(code)}
  const exp=SESSION?.user?.restaurant?.expires_at;
  document.body.innerHTML=`<div style="min-height:100vh;display:grid;place-items:center;padding:16px">
    <div class="card" style="max-width:440px;text-align:center;padding:28px">
      <div style="font-size:48px">${code==='EXPIRED'?'⏳':'⛔'}</div>
      <h2 style="margin:8px 0">${code==='EXPIRED'?'انتهى الاشتراك':'الاشتراك موقوف'}</h2>
      <p class="muted">${ERR_TEXT[code]}${code==='EXPIRED'&&exp?`<br>تاريخ الانتهاء: <b class="ltr">${new Date(exp).toLocaleDateString('en-GB')}</b>`:''}</p>
      <p class="muted" style="font-size:13px">بياناتك محفوظة ولن تُحذف — تعود فور التجديد.</p>
      <button class="btn" onclick="logout()">تسجيل الخروج</button></div></div>`;
}
async function logout(){
  try{if(MODE==='cloud'||TOKEN())await rpc('rms_logout',{p_token:TOKEN()},{noAuth:true})}catch(e){}
  lsSet(SKEY,null); lsSet(CCACHE,null);
  goLogin();
}

function setOnline(v){
  online=v;
  const t=MODE==='local'?' على هذا الجهاز':v?' متصل':' غير متصل';
  document.querySelectorAll('.net').forEach(e=>{e.classList.toggle('off',MODE!=='local'&&!v);e.lastChild.textContent=t});
}

async function loadState(){
  if(location.protocol.startsWith('http')){
    let r=null;
    try{r=await api('/api/state')}catch(e){}
    if(r&&'state' in r){
      MODE='server';
      if(r.state){S=r.state;V=r.version;migrate()}
      else{S=SEED();await pushNow()}
      return setOnline(true);
    }
  }
  if(CLOUD_READY){
    MODE='cloud';
    if(!TOKEN()){goLogin();return new Promise(()=>{})}
    return cloudLoad();
  }
  MODE='local';
  try{S=JSON.parse(lsGet(KEY))}catch(e){}
  if(!S) S=SEED();
  migrate(); setOnline(true);
  // تبويب آخر (مثلاً تطبيق الويتر) غيّر البيانات
  addEventListener('storage',e=>{if(MODE==='local'&&e.key===KEY&&e.newValue){S=JSON.parse(e.newValue);migrate();onRemote()}});
}
function save(){
  if(MODE==='local'){if(!lsSet(KEY,JSON.stringify(S)))toast('⚠ مساحة التخزين ممتلئة — قلّل الصور');return}
  if(MODE==='cloud'&&V<0){toast('⚠ لا يوجد اتصال بالإنترنت — التعديل لن يُحفظ');return}
  dirty=true; clearTimeout(putTimer); putTimer=setTimeout(pushNow,300);
}
async function pushNow(){
  if(putting){dirty=true;return}
  putting=true; dirty=false; clearTimeout(putTimer);
  try{
    if(MODE==='cloud'){
      const r=await rpc('rms_save',{p_token:TOKEN(),p_state:S,p_folded:lastOp});
      V=r.version; cacheCloud();
    }else{
      const r=await api('/api/state',{method:'PUT',body:JSON.stringify({base:V,state:S})});
      V=r.version;
      // وصلت طلبات من أجهزة أخرى أثناء التعديل: الخادم دمجها
      if(r.merged){S=r.state;migrate();onRemote()}
    }
    setOnline(true);
  }catch(e){
    if(BLOCKING.includes(e.code)){putting=false;return}
    setOnline(false);dirty=true;putTimer=setTimeout(pushNow,3000);
  }
  putting=false;
  if(dirty&&online) pushNow();
}
// عمليات قد تحدث من عدة أجهزة بنفس الوقت (طلب جديد، حالة طلب، دفع، طاولة) تُرسل كعملية منفصلة حتى لا تضيع
async function action(op){
  if(MODE==='local'){applyOp(S,op);save();return S}
  if(dirty||putting) await pushNow();
  if(MODE==='cloud'){
    if(V<0) throw new Error('NETWORK');
    await rpc('rms_op',{p_token:TOKEN(),p_op:op});
    await cloudPull(true);
    return S;
  }
  const r=await api('/api/action',{method:'POST',body:JSON.stringify({op})});
  S=r.state; V=r.version; migrate(); setOnline(true);
  return S;
}

/* ---- المزامنة عبر الإنترنت ---- */
const RID=()=>SESSION?.user?.restaurant?.id;
function cacheCloud(){lsSet(CCACHE,JSON.stringify({rid:RID(),S}))}
// يجلب ما تغيّر: نسخة كاملة جديدة (إن حفظ جهاز آخر) + العمليات الجديدة بالترتيب
async function cloudPull(quiet){
  const r=await rpc('rms_pull',{p_token:TOKEN(),p_version:V,p_after:lastOp});
  setOnline(true);
  if(!r.exists) return false;
  if(putting||dirty) return true;          // تعديل محلي بالطريق: نعيد المحاولة في الدورة القادمة
  let changed=false;
  if(r.state){S=r.state;V=r.version;lastOp=r.last_op;changed=true}
  for(const o of r.ops){if(o.id>lastOp){applyOp(S,o.op);lastOp=o.id;changed=true}}
  if(changed){migrate();syncStaffIntoState();cacheCloud();if(!quiet)onRemote()}
  return true;
}
// الموظفون في الإنترنت حسابات حقيقية؛ نضعهم في البيانات لعرض الأسماء والأدوار
let STAFF=null;
function syncStaffIntoState(){if(STAFF&&S) S.staff=STAFF.map(u=>({id:u.id,name:u.name,role:u.role,shift:u.shift,on:u.active,username:u.username,last_login:u.last_login}))}
async function loadStaff(){
  if(MODE!=='cloud') return;
  STAFF=await rpc('rms_staff_list',{p_token:TOKEN()}); syncStaffIntoState();
}
async function cloudLoad(){
  V=-1; lastOp=0;
  try{
    const [me]=await Promise.all([rpc('rms_session',{p_token:TOKEN()}),loadStaff()]);
    SESSION.user=me; lsSet(SKEY,JSON.stringify(SESSION));
    if(!await cloudPull(true)){
      // مطعم جديد: يبدأ ببيانات نظيفة باسم المطعم
      S=BLANK(me.restaurant?.name); migrate(); syncStaffIntoState();
      const r=await rpc('rms_save',{p_token:TOKEN(),p_state:S,p_folded:0}); V=r.version; cacheCloud();
    }
  }catch(e){
    if(BLOCKING.includes(e.code)) return new Promise(()=>{});
    // بدون إنترنت: نعرض آخر نسخة محفوظة على الجهاز حتى يعود الاتصال
    try{const c=JSON.parse(lsGet(CCACHE));if(c&&c.rid===RID())S=c.S}catch(x){}
    if(!S) throw e;
    migrate(); setOnline(false);
  }
}

// فحص التحديثات من الأجهزة الأخرى
setInterval(async()=>{
  if(MODE==='local'||putting||dirty||!S||blockedShown) return;
  try{
    if(MODE==='cloud'){await cloudPull(false);return}
    const r=await api('/api/version'); setOnline(true);
    if(r.version===V) return;
    const s=await api('/api/state');
    if(putting||dirty) return;
    S=s.state; V=s.version; migrate(); onRemote();
  }catch(e){if(!BLOCKING.includes(e.code))setOnline(false)}
},2000);

/* ---- الصور ----
 * في الوضع المحلي وخادم المطعم تُحفظ الصورة داخل البيانات.
 * عبر الإنترنت تُرفع مرة واحدة وتُحفظ كمرجع «img:رقم»، وتُخزَّن على الجهاز بعد أول تحميل. */
const IMG={}, imgWant=new Set(), imgFailed=new Set(); let imgTimer=null;
function imgSrc(v){
  if(!v) return null;
  if(!v.startsWith('img:')) return v;
  const id=v.slice(4);
  if(IMG[id]) return IMG[id];
  const c=lsGet('rms-img-'+id); if(c){IMG[id]=c;return c}
  if(MODE==='cloud'&&!imgFailed.has(id)){imgWant.add(id);clearTimeout(imgTimer);imgTimer=setTimeout(fetchImages,60)}
  return null;
}
async function fetchImages(){
  const ids=[...imgWant]; imgWant.clear(); if(!ids.length) return;
  try{
    const r=await rpc('rms_images_get',{p_token:TOKEN(),p_ids:ids});
    ids.forEach(id=>{if(r[id]){IMG[id]=r[id];lsSet('rms-img-'+id,r[id])}else imgFailed.add(id)});
    if(Object.keys(r).length&&typeof render==='function') render();
  }catch(e){}
}
async function storeImage(dataUrl){
  if(MODE!=='cloud') return dataUrl;
  const r=await rpc('rms_image_put',{p_token:TOKEN(),p_data:dataUrl});
  IMG[r.id]=dataUrl; lsSet('rms-img-'+r.id,dataUrl);
  return 'img:'+r.id;
}

/* ---- سجل العمليات ---- */
function logAction(act,details=''){
  const by=(typeof ME==='function'&&ME()?.name)||'';
  if(MODE==='cloud'){rpc('rms_log_add',{p_token:TOKEN(),p_action:act,p_details:String(details)}).catch(()=>{});return}
  S.log.unshift({at:Date.now(),user:by,action:act,details:String(details)}); S.log.length=Math.min(S.log.length,500); save();
}

/* ---- أرشفة الطلبات القديمة ----
 * الطلبات المنتهية الأقدم من يومين تُنقل للأرشيف (على الإنترنت) حتى تبقى المزامنة سريعة،
 * وتبقى متاحة في التقارير وسجل الطلبات. */
async function archiveOld(){
  if(MODE!=='cloud'||V<0||!S) return;
  const cut=new Date().setHours(0,0,0,0)-86400e3;
  const old=S.orders.filter(o=>o.createdAt<cut&&(o.status==='void'||(o.status==='done'&&(o.pay||!o.table))));
  if(!old.length) return;
  for(let i=0;i<old.length;i+=300) await rpc('rms_archive',{p_token:TOKEN(),p_orders:old.slice(i,i+300)});
  const gone=new Set(old.map(o=>o.uid));
  S.orders=S.orders.filter(o=>!gone.has(o.uid)); save();
}
// كل الطلبات بين تاريخين: من البيانات الحالية + الأرشيف
async function ordersBetween(from,to){
  const now=S.orders.filter(o=>o.createdAt>=from&&o.createdAt<to);
  if(MODE!=='cloud') return now;
  const seen=new Set(now.map(o=>o.uid));
  const arc=await rpc('rms_orders_range',{p_token:TOKEN(),p_from:new Date(from).toISOString(),p_to:new Date(to).toISOString()});
  return now.concat(arc.filter(o=>!seen.has(o.uid)));
}

/* ============ العمليات المتزامنة ============ */
// نفس منطق الخادم (server.py: apply_op). كل عملية آمنة إذا تكررت.
const RANK={new:0,preparing:1,ready:2,done:3,void:9};
function deduct(s,o,sign){
  if(!s.settings.autoDeduct) return;
  o.items.forEach(l=>{
    const m=s.menu.find(x=>x.id===l.id);
    Object.entries(m?.recipe||{}).forEach(([k,v])=>{const inv=s.inventory.find(i=>i.id===k);if(inv)inv.qty=Math.max(0,+(inv.qty-sign*v*l.qty).toFixed(3))});
  });
}
function applyOp(s,op){
  const byUid=u=>s.orders.find(x=>x.uid===u);
  if(op.type==='order'){
    const o=structuredClone(op.order);
    if(byUid(o.uid)) return;
    o.id=s.nextId++; s.orders.push(o);
    deduct(s,o,1);
    if(o.table){const t=s.tables.find(t=>t.id===o.table);if(t&&(t.status==='free'||t.status==='res'))t.status='busy'}
  }else if(op.type==='status'){
    const o=byUid(op.uid);
    if(o&&RANK[op.status]>RANK[o.status]&&o.status!=='void') o.status=op.status;
  }else if(op.type==='table'){
    const t=s.tables.find(t=>t.id===op.id); if(t) t.status=op.status;
  }else if(op.type==='pay'){
    // دفع حساب طاولة أو طلب: يُسجل الدفع على كل طلبات الحساب، وتتحرر الطاولة
    op.uids.forEach(u=>{const o=byUid(u);if(o&&!o.pay&&o.status!=='void'){
      o.pay=op.pay; o.paidAt=op.at; o.paidBy=op.by; if(op.discount!=null)o.discount=op.discount;
      if(op.customer) o.customer=op.customer;
    }});
    if(op.table){const t=s.tables.find(t=>t.id===op.table);if(t)t.status='free'}
  }else if(op.type==='void'){
    const o=byUid(op.uid);
    if(o&&o.status!=='void'){o.status='void';o.voidReason=op.reason;o.voidBy=op.by;o.voidAt=op.at;deduct(s,o,-1)}
  }else if(op.type==='move'){
    const to=s.tables.find(t=>t.id===op.to), from=s.tables.find(t=>t.id===op.from);
    if(!to||!from) return;
    s.orders.forEach(o=>{if(o.table===op.from&&!o.pay&&o.status!=='void')o.table=op.to});
    to.status='busy'; from.status='free';
  }
}

/* ============ تفضيلات هذا الجهاز ============ */
const PKEY='rms-prefs';
let P={theme:'aurora',lastDark:'aurora',motion:'on',font:15,user:1,waiter:null};
try{P={...P,...JSON.parse(localStorage.getItem(PKEY)||'{}')}}catch(e){}
const savePrefs=()=>{try{localStorage.setItem(PKEY,JSON.stringify(P))}catch(e){}};
function applyPrefs(){const r=document.documentElement;r.dataset.theme=P.theme;r.dataset.motion=P.motion;r.style.fontSize=P.font+'px'}
function setPref(k,v,ev){
  const prev=P.theme; P[k]=v; if(k==='theme'&&v!=='light') P.lastDark=v; savePrefs();
  const apply=()=>{applyPrefs();if(typeof render==='function')render()};
  const still=P.motion==='off'||matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(k!=='theme'||prev===v||!document.startViewTransition||still) return apply();
  const x=ev?ev.clientX:innerWidth/2, y=ev?ev.clientY:0, R=document.documentElement;
  R.style.setProperty('--vt-x',x+'px');R.style.setProperty('--vt-y',y+'px');
  R.style.setProperty('--vt-r',Math.ceil(Math.hypot(Math.max(x,innerWidth-x),Math.max(y,innerHeight-y)))+'px');
  R.classList.add('vt-circle');
  document.startViewTransition(apply).finished.finally(()=>R.classList.remove('vt-circle'));
}
// زر التبديل السريع: يعود لآخر مظهر داكن اختاره المستخدم
function quickTheme(ev){setPref('theme',P.theme==='light'?P.lastDark:'light',ev)}
applyPrefs();

/* ============ أدوات ============ */
const $=s=>document.querySelector(s);
const st=()=>S.settings;
// الأرقام بالإنجليزية (1,250) والتاريخ بالعربي مع أرقام إنجليزية
const num=n=>Math.round(n||0).toLocaleString('en-US');
const dec=n=>(+(+n||0).toFixed(2)).toLocaleString('en-US');
const fmt=n=>num(n)+' '+st().currency;
const timeStr=t=>new Date(t).toLocaleTimeString('ar-IQ-u-nu-latn',{hour:'2-digit',minute:'2-digit'});
const dateStr=t=>new Date(t).toLocaleDateString('ar-IQ-u-nu-latn',{day:'numeric',month:'short',year:'numeric'});
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;');
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const item=id=>S.menu.find(m=>m.id===id);
const sub=o=>o.items.reduce((s,l)=>s+(l.price??item(l.id)?.price??0)*l.qty,0);
// تفصيل الفاتورة: خصم، خدمة (صالة فقط)، ضريبة، توصيل، ثم التقريب
function calc(o){
  const s=sub(o), d=s*(o.discount||0)/100, base=s-d;
  const sv=o.type==='صالة'?base*st().service/100:0, tx=base*(st().tax||0)/100;
  const fee=o.type==='توصيل'?(o.fee??st().deliveryFee):0;
  let t=base+sv+tx+fee; const r=+st().roundTo; if(r) t=Math.round(t/r)*r;
  return {s,d,sv,tx,fee,t};
}
const total=o=>o.status==='void'?0:calc(o).t;
const costOf=m=>Object.entries(m.recipe||{}).reduce((s,[k,v])=>s+(S.inventory.find(i=>i.id===k)?.cost||0)*v,0);
const canMake=m=>Object.entries(m.recipe||{}).every(([k,v])=>(S.inventory.find(i=>i.id===k)?.qty??Infinity)>=v);
const available=m=>m.on&&(st().sellOutOfStock||canMake(m));
const mins=t=>Math.floor((Date.now()-t)/60e3);
const dayStart=(t=Date.now())=>new Date(t).setHours(0,0,0,0);
const isToday=t=>t>=dayStart();
const pic=m=>{const s=imgSrc(m.img);return s?`<img src="${s}" alt="">`:esc(m.emo||'🍽')};
const logoHtml=()=>{const s=imgSrc(st().logoImg);return s?`<img src="${s}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`:esc(st().logo||'🍽')};
// مكان الطاولة: الطابق والقسم
function tablePlace(id){
  const t=S.tables.find(x=>x.id===id); if(!t) return null;
  for(const f of S.floors){const s=f.sections.find(s=>s.id===t.section);if(s)return{t,f,s}}
  return {t,f:null,s:null};
}
const tableName=id=>{const p=tablePlace(id);return p?.s?`طاولة ${id} · ${p.s.name}`:`طاولة ${id}`};
function toast(msg){const t=$('#toast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('show'),2800)}
function beep(f=880){try{const a=new(window.AudioContext||window.webkitAudioContext)(),o=a.createOscillator(),g=a.createGain();o.frequency.value=f;o.connect(g);g.connect(a.destination);g.gain.setValueAtTime(.15,a.currentTime);g.gain.exponentialRampToValueAtTime(.001,a.currentTime+.5);o.start();o.stop(a.currentTime+.5)}catch(e){}}
// الصلاحيات: المدير يرى كل شيء دائماً
const can=(role,k)=>role==='مدير'||!!S.perms[role]?.[k];

// تصغير الصورة قبل حفظها (حتى تبقى البيانات خفيفة وسريعة المزامنة)
function resizeImage(file,max=480){
  return new Promise((ok,no)=>{
    const img=new Image(), url=URL.createObjectURL(file);
    img.onload=()=>{
      const k=Math.min(1,max/Math.max(img.width,img.height)), c=document.createElement('canvas');
      c.width=Math.round(img.width*k); c.height=Math.round(img.height*k);
      const g=c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,c.width,c.height); g.drawImage(img,0,0,c.width,c.height);
      URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg',.82));
    };
    img.onerror=()=>{URL.revokeObjectURL(url);no(new Error('BAD_IMAGE'))};
    img.src=url;
  });
}

/* ============ الطباعة ============ */
// تُطبع الفاتورة وتذكرة المطبخ من إطار مخفي بعرض ورق الطابعة الحرارية (80 أو 58 ملم)
function printHtml(body){
  const w=st().receiptWidth==='58'?58:80;
  const f=document.createElement('iframe');
  f.style.cssText='position:fixed;width:0;height:0;border:0;left:-9999px';
  document.body.appendChild(f);
  f.srcdoc=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
    @page{size:${w}mm auto;margin:3mm}
    body{font-family:Tahoma,Arial,sans-serif;font-size:12px;color:#000;margin:0;width:${w-6}mm}
    .c{text-align:center}.r{display:flex;justify-content:space-between;gap:6px}.b{font-weight:bold}
    hr{border:0;border-top:1px dashed #000;margin:6px 0}h1{font-size:16px;margin:2px 0}h2{font-size:20px;margin:4px 0}
    .big{font-size:15px}.note{font-size:11px}img{max-width:28mm;max-height:20mm}
  </style></head><body>${body}</body></html>`;
  f.onload=()=>{setTimeout(()=>{try{f.contentWindow.focus();f.contentWindow.print()}catch(e){}setTimeout(()=>f.remove(),60000)},150)};
}
function receiptHtml(o,{title='فاتورة',orders}={}){
  const s=st(), c=calc(o), logo=imgSrc(s.logoImg);
  const lines=o.items.map(l=>{const m=item(l.id),p=l.price??m?.price??0;return `<div class="r"><span>${num(l.qty)} × ${esc(l.name||m?.name||'—')}</span><span>${num(p*l.qty)}</span></div>`}).join('');
  return `<div class="c">${s.showLogo?(logo?`<img src="${logo}"><br>`:`<div style="font-size:22px">${esc(s.logo)}</div>`):''}
    <h1>${esc(s.name)}</h1>${esc(s.branch)}${s.phone?' · '+esc(s.phone):''}${s.address?'<br>'+esc(s.address):''}
    ${s.receiptHeader?'<br>'+esc(s.receiptHeader):''}</div><hr>
    <div class="r"><span>${title} ${orders?orders.map(x=>'#'+x.id).join(' '):'#'+(o.id??'')}</span><span>${esc(o.type)}${o.table?' · طاولة '+o.table:''}</span></div>
    <div class="r note"><span>${dateStr(o.createdAt||Date.now())} ${timeStr(o.createdAt||Date.now())}</span><span>${esc(o.paidBy||o.by||'')}</span></div>
    ${o.customer?.name||o.customer?.phone?`<div class="note">الزبون: ${esc(o.customer.name||'')} ${esc(o.customer.phone||'')}${o.customer.address?'<br>العنوان: '+esc(o.customer.address):''}</div>`:''}
    <hr>${lines}<hr>
    <div class="r"><span>المجموع</span><span>${num(c.s)}</span></div>
    ${c.d?`<div class="r"><span>خصم ${num(o.discount)}%</span><span>− ${num(c.d)}</span></div>`:''}
    ${c.sv?`<div class="r"><span>خدمة ${num(s.service)}%</span><span>${num(c.sv)}</span></div>`:''}
    ${c.tx?`<div class="r"><span>ضريبة ${num(s.tax)}%</span><span>${num(c.tx)}</span></div>`:''}
    ${c.fee?`<div class="r"><span>أجور التوصيل</span><span>${num(c.fee)}</span></div>`:''}
    <div class="r b big"><span>الإجمالي</span><span>${fmt(c.t)}</span></div>
    ${o.pay?`<div class="r"><span>الدفع</span><span>${esc(o.pay)}</span></div>`:'<div class="c b">غير مدفوع</div>'}
    <hr><div class="c">${esc(s.receiptFooter)}</div>`;
}
function printReceipt(o,opts){printHtml(receiptHtml(o,opts))}
function printTicket(o){
  printHtml(`<div class="c"><h2>#${o.id}</h2><div class="big b">${esc(o.type)}${o.table?' — '+esc(tableName(o.table)):''}</div>
    <div>${timeStr(o.createdAt)} · ${esc(o.by||'')}</div></div><hr>
    ${o.items.map(l=>`<div class="big b">${num(l.qty)} × ${esc(item(l.id)?.name||'—')}</div>${l.note?`<div>⚠ ${esc(l.note)}</div>`:''}`).join('')}
    ${o.note?`<hr><div>ملاحظة: ${esc(o.note)}</div>`:''}`);
}
// تنزيل ملف (CSV للتقارير، JSON للنسخ الاحتياطي)
function downloadFile(name,text,type='text/plain'){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([text],{type}));
  a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
const csv=rows=>'﻿'+rows.map(r=>r.map(v=>{v=String(v??'');return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}).join(',')).join('\n');
