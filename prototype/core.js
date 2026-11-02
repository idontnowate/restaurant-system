/* core.js — البيانات والمزامنة والأدوات المشتركة بين لوحة الإدارة وتطبيق الويتر
 *
 * يعمل بطريقتين:
 *  - مع الخادم (server.py): كل الأجهزة على نفس الشبكة تشترك بنفس البيانات وتتحدث تلقائياً.
 *  - بفتح الملف مباشرة: البيانات محفوظة في هذا المتصفح فقط (للتجربة).
 */

/* ============ الإعدادات الافتراضية ============ */
const DEF_SETTINGS={
  name:'مطعم الديرة', branch:'الفرع الرئيسي', phone:'07700000000', address:'بغداد - المنصور', logo:'🍽',
  currency:'د.ع', usdRate:1310,
  types:{'صالة':true,'سفري':true,'توصيل':true}, service:10, tax:0, maxDiscount:20, roundTo:250, requireTable:true,
  pays:{'نقدي':true,'بطاقة':true,'محفظة':true,'آجل':false},
  receiptHeader:'أهلاً وسهلاً بكم', receiptFooter:'شكراً لزيارتكم — نتمنى لكم وجبة شهية', receiptWidth:'80', autoPrint:true, showQR:true, showLogo:true,
  warnMin:10, lateMin:20, kdsSound:true, kitchenTicket:true,
  deliveryFee:2000, minDelivery:10000, zones:[{name:'المنصور',fee:2000},{name:'الكرادة',fee:3000},{name:'زيونة',fee:3000}],
  autoDeduct:true, sellOutOfStock:true, lowAlert:true,
  openingCash:100000, closeShift:true,
};

/* ============ الأدوار والصلاحيات ============ */
const ROLES=['مدير','كاشير','ويتر','طباخ','سائق'];
// كل صف خانة يتحكم بها المدير: صفحة كاملة أو جزء داخل صفحة
const PERM_ROWS=[
  {group:'الصفحات'},
  {k:'dash',t:'لوحة التحكم'},{k:'pos',t:'نقطة البيع'},{k:'kds',t:'شاشة المطبخ'},{k:'tables',t:'الطاولات'},
  {k:'orders',t:'سجل الطلبات'},{k:'menu',t:'المنيو'},{k:'inv',t:'المخزون'},{k:'staff',t:'الموظفين'},
  {k:'cust',t:'العملاء'},{k:'reports',t:'التقارير'},{k:'settings',t:'الإعدادات'},
  {group:'الخانات والعمليات'},
  {k:'sales',t:'رؤية أرقام المبيعات',h:'إجمالي المبيعات ومتوسط الفاتورة في لوحة التحكم'},
  {k:'cost',t:'رؤية التكلفة والأرباح',h:'تكلفة الصنف، نسبة التكلفة، قيمة المخزون'},
  {k:'discount',t:'إعطاء خصم',h:'خانة الخصم في نقطة البيع'},
  {k:'editPrice',t:'تعديل الأسعار',h:'تعديل سعر الصنف من المنيو'},
  {k:'addItem',t:'إضافة وتعديل الأصناف',h:'زر «صنف جديد» في نقطة البيع والمنيو'},
  {k:'tablesEdit',t:'تعديل الطوابق والطاولات',h:'إضافة طوابق وأقسام وطاولات'},
  {k:'stockIn',t:'استلام بضاعة',h:'إضافة كميات للمخزون'},
  {k:'waiterApp',t:'تطبيق الويتر',h:'الدخول لتطبيق الويتر من الموبايل'},
];
const DEF_PERMS={
  'كاشير':{dash:true,pos:true,tables:true,orders:true,cust:true,discount:true,kds:true},
  'ويتر':{tables:true,pos:true,waiterApp:true},
  'طباخ':{kds:true,inv:true,stockIn:true},
  'سائق':{orders:true},
};

/* ============ البيانات التجريبية ============ */
function SEED(){
  const st=['free','busy','free','res','bill','free','busy','free','free','res','free','free'];
  const sec=['s1','s1','s1','s1','s1','s2','s2','s2','s3','s3','s4','s4'];
  return {
  settings:structuredClone(DEF_SETTINGS),
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
    {name:'أحمد ستار',phone:'07701234567',orders:23,spent:412000,points:412},
    {name:'مريم علي',phone:'07809876543',orders:11,spent:186000,points:186},
    {name:'شركة النور',phone:'07501112233',orders:40,spent:1250000,points:1250},
    {name:'حسن فاضل',phone:'07712223344',orders:4,spent:52000,points:52},
  ],
  orders:seedOrders(),
  nextId:1050,
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
    out.push({id:1000+i,uid:'seed'+i,type:types[i%3],table:i%3===0?(i%12)+1:null,items,status:'done',pay:pays[i%4],discount:0,createdAt:Math.min(d.getTime(),now-3600e3)});
  }
  out.push({id:1040,uid:'seed40',type:'صالة',table:2,items:[{id:1,qty:2},{id:11,qty:1},{id:12,qty:2}],status:'preparing',pay:'نقدي',discount:0,by:'مصطفى جاسم',createdAt:now-14*60e3});
  out.push({id:1041,uid:'seed41',type:'سفري',table:null,items:[{id:4,qty:3,note:'بدون مخلل'},{id:9,qty:1}],status:'new',pay:'نقدي',discount:0,createdAt:now-4*60e3});
  out.push({id:1042,uid:'seed42',type:'صالة',table:7,items:[{id:3,qty:1},{id:10,qty:2},{id:13,qty:2}],status:'new',pay:'بطاقة',discount:0,by:'كرار علي',createdAt:now-2*60e3});
  out.push({id:1043,uid:'seed43',type:'توصيل',table:null,items:[{id:7,qty:2},{id:9,qty:2}],status:'ready',pay:'نقدي',discount:0,createdAt:now-22*60e3});
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
  S.staff.forEach((p,i)=>{if(!p.id)p.id=i+1});
  S.orders.forEach(o=>{if(!o.uid)o.uid='o'+o.id});
}

/* ============ الحفظ والمزامنة ============ */
// ثلاث طرق، يُختار أولها المتاح عند فتح الصفحة:
//  server — خادم المطعم (server.py) على نفس شبكة الواي فاي
//  cloud  — المزامنة عبر الإنترنت (Supabase) إذا رُبط الجهاز برمز المطعم
//  local  — هذا المتصفح فقط
// مشروع Supabase الخاص بالمطعم (منفصل عن أي برنامج آخر). اتركهما فارغين لإيقاف المزامنة عبر الإنترنت.
const CLOUD={url:'', key:''};
const CLOUD_READY=!!(CLOUD.url&&CLOUD.key);
const KEY='rms-proto-v1', CKEY='rms-cloud', CCACHE='rms-cloud-cache';
let MODE='local';
let S=null, V=0, putTimer=null, putting=false, dirty=false, online=true;
let lastOp=0;          // (cloud) آخر عملية طبّقها هذا الجهاز
let onRemote=()=>{};   // تضعها كل صفحة: ماذا تفعل عند وصول تحديث من جهاز آخر

/* ---- رمز المطعم (للمزامنة عبر الإنترنت) ---- */
const lsGet=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const lsSet=(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v);return true}catch(e){return false}};
const normCode=c=>String(c||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const fmtCode=c=>(c||'').match(/.{1,4}/g)?.join('-')||'';
function newCode(){const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return [...crypto.getRandomValues(new Uint8Array(24))].map(x=>a[x%32]).join('')}
let cloudCode=lsGet(CKEY);
// رابط من رمز QR: ...waiter.html#r=CODE يربط الجهاز مباشرة
{const m=location.hash.match(/(?:^#|&)r=([A-Za-z0-9-]+)/);
 if(m){const c=normCode(m[1]);if(c.length>=20){cloudCode=c;lsSet(CKEY,c)}history.replaceState(null,'',location.pathname+location.search)}}

async function api(path,opt={}){
  const r=await fetch(path,{headers:{'Content-Type':'application/json'},cache:'no-store',...opt});
  if(!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
}
async function rpc(fn,args){
  const r=await fetch(`${CLOUD.url}/rest/v1/rpc/${fn}`,{method:'POST',cache:'no-store',
    headers:{apikey:CLOUD.key,Authorization:'Bearer '+CLOUD.key,'Content-Type':'application/json'},
    body:JSON.stringify(args),signal:AbortSignal.timeout?AbortSignal.timeout(20000):undefined});
  if(!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
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
  if(cloudCode&&CLOUD_READY){MODE='cloud';return cloudLoad()}
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
      const r=await rpc('rms_save',{p_code:cloudCode,p_state:S,p_folded:lastOp});
      V=r.version; cacheCloud();
    }else{
      const r=await api('/api/state',{method:'PUT',body:JSON.stringify({base:V,state:S})});
      V=r.version;
      // وصلت طلبات من أجهزة أخرى أثناء التعديل: الخادم دمجها
      if(r.merged){S=r.state;migrate();onRemote()}
    }
    setOnline(true);
  }catch(e){setOnline(false);dirty=true;putTimer=setTimeout(pushNow,3000)}
  putting=false;
  if(dirty&&online) pushNow();
}
// عمليات قد تحدث من عدة أجهزة بنفس الوقت (طلب جديد، حالة طلب، حالة طاولة) تُرسل كعملية منفصلة حتى لا تضيع
async function action(op){
  if(MODE==='local'){applyOp(S,op);save();return S}
  if(dirty||putting) await pushNow();
  if(MODE==='cloud'){
    if(V<0) throw new Error('offline');
    await rpc('rms_op',{p_code:cloudCode,p_op:op});
    await cloudPull(true);
    return S;
  }
  const r=await api('/api/action',{method:'POST',body:JSON.stringify({op})});
  S=r.state; V=r.version; migrate(); setOnline(true);
  return S;
}

/* ---- المزامنة عبر الإنترنت ---- */
function cacheCloud(){lsSet(CCACHE,JSON.stringify({code:cloudCode,S}))}
// يجلب ما تغيّر: نسخة كاملة جديدة (إن حفظ جهاز آخر) + العمليات الجديدة بالترتيب
async function cloudPull(quiet){
  const r=await rpc('rms_pull',{p_code:cloudCode,p_version:V,p_after:lastOp});
  setOnline(true);
  if(!r.exists) return false;
  if(putting||dirty) return true;          // تعديل محلي بالطريق: نعيد المحاولة في الدورة القادمة
  let changed=false;
  if(r.state){S=r.state;V=r.version;lastOp=r.last_op;changed=true}
  for(const o of r.ops){if(o.id>lastOp){applyOp(S,o.op);lastOp=o.id;changed=true}}
  if(changed){migrate();cacheCloud();if(!quiet)onRemote()}
  return true;
}
async function cloudLoad(){
  V=-1; lastOp=0;
  try{
    if(!await cloudPull(true)){
      // مطعم جديد: نرفع بيانات هذا الجهاز
      try{S=JSON.parse(lsGet(KEY))}catch(e){}
      if(!S) S=SEED(); migrate();
      const r=await rpc('rms_save',{p_code:cloudCode,p_state:S,p_folded:0}); V=r.version; cacheCloud();
    }
  }catch(e){
    // بدون إنترنت: نعرض آخر نسخة محفوظة على الجهاز حتى يعود الاتصال
    try{const c=JSON.parse(lsGet(CCACHE));if(c&&c.code===cloudCode)S=c.S}catch(e){}
    if(!S) throw e;
    migrate(); setOnline(false);
  }
}
// ربط هذا الجهاز: إنشاء مزامنة جديدة ببيانات الجهاز الحالية
async function cloudCreate(){
  const code=newCode();
  const r=await rpc('rms_save',{p_code:code,p_state:S,p_folded:0});
  cloudCode=code; lsSet(CKEY,code); MODE='cloud'; V=r.version; lastOp=0; cacheCloud(); setOnline(true);
  return code;
}
// ربط بمطعم موجود: نتأكد أن الرمز صحيح قبل حفظه
async function cloudJoin(raw){
  const code=normCode(raw);
  if(code.length<20) return 'short';
  const r=await rpc('rms_pull',{p_code:code,p_version:-1,p_after:0});
  if(!r.exists) return 'missing';
  lsSet(CKEY,code); location.reload(); return 'ok';
}
function cloudLeave(){lsSet(CKEY,null);lsSet(CCACHE,null);location.reload()}

// فحص التحديثات من الأجهزة الأخرى
setInterval(async()=>{
  if(MODE==='local'||putting||dirty||!S) return;
  try{
    if(MODE==='cloud'){await cloudPull(false);return}
    const r=await api('/api/version'); setOnline(true);
    if(r.version===V) return;
    const s=await api('/api/state');
    if(putting||dirty) return;
    S=s.state; V=s.version; migrate(); onRemote();
  }catch(e){setOnline(false)}
},2000);

// نفس منطق الخادم، للعمل بدون خادم
function applyOp(s,op){
  if(op.type==='order'){
    const o=op.order;
    if(s.orders.some(x=>x.uid===o.uid)) return;
    o.id=s.nextId++; s.orders.push(o);
    if(s.settings.autoDeduct) o.items.forEach(l=>{
      const m=s.menu.find(x=>x.id===l.id);
      Object.entries(m?.recipe||{}).forEach(([k,v])=>{const inv=s.inventory.find(i=>i.id===k);if(inv)inv.qty=Math.max(0,inv.qty-v*l.qty)});
    });
    if(o.table){const t=s.tables.find(t=>t.id===o.table);if(t&&t.status==='free')t.status='busy'}
  }else if(op.type==='status'){
    const o=s.orders.find(x=>x.uid===op.uid);
    if(o&&RANK[op.status]>RANK[o.status]) o.status=op.status;
  }else if(op.type==='table'){
    const t=s.tables.find(t=>t.id===op.id); if(t) t.status=op.status;
  }
}
const RANK={new:0,preparing:1,ready:2,done:3};

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
const num=n=>Math.round(n).toLocaleString('en-US');
const dec=n=>(+(+n).toFixed(2)).toLocaleString('en-US');
const fmt=n=>num(n)+' '+st().currency;
const timeStr=t=>new Date(t).toLocaleTimeString('ar-IQ-u-nu-latn',{hour:'2-digit',minute:'2-digit'});
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const item=id=>S.menu.find(m=>m.id===id);
const sub=o=>o.items.reduce((s,l)=>s+(item(l.id)?.price||0)*l.qty,0);
// تفصيل الفاتورة: خصم، خدمة (صالة فقط)، ضريبة، توصيل، ثم التقريب
function calc(o){
  const s=sub(o), d=s*(o.discount||0)/100, base=s-d;
  const sv=o.type==='صالة'?base*st().service/100:0, tx=base*(st().tax||0)/100;
  const fee=o.type==='توصيل'?(o.fee??st().deliveryFee):0;
  let t=base+sv+tx+fee; const r=+st().roundTo; if(r) t=Math.round(t/r)*r;
  return {s,d,sv,tx,fee,t};
}
const total=o=>calc(o).t;
const costOf=m=>Object.entries(m.recipe||{}).reduce((s,[k,v])=>s+(S.inventory.find(i=>i.id===k)?.cost||0)*v,0);
const canMake=m=>Object.entries(m.recipe||{}).every(([k,v])=>(S.inventory.find(i=>i.id===k)?.qty??Infinity)>=v);
const available=m=>m.on&&(st().sellOutOfStock||canMake(m));
const mins=t=>Math.floor((Date.now()-t)/60e3);
const isToday=t=>new Date(t).toDateString()===new Date().toDateString();
const pic=m=>m.img?`<img src="${m.img}" alt="">`:m.emo;
// مكان الطاولة: الطابق والقسم
function tablePlace(id){
  const t=S.tables.find(x=>x.id===id); if(!t) return null;
  for(const f of S.floors){const s=f.sections.find(s=>s.id===t.section);if(s)return{t,f,s}}
  return {t,f:null,s:null};
}
const tableName=id=>{const p=tablePlace(id);return p?.s?`طاولة ${id} · ${p.s.name}`:`طاولة ${id}`};
function toast(msg){const t=$('#toast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('show'),2400)}
function beep(f=880){try{const a=new(window.AudioContext||window.webkitAudioContext)(),o=a.createOscillator(),g=a.createGain();o.frequency.value=f;o.connect(g);g.connect(a.destination);g.gain.setValueAtTime(.15,a.currentTime);g.gain.exponentialRampToValueAtTime(.001,a.currentTime+.5);o.start();o.stop(a.currentTime+.5)}catch(e){}}
// الصلاحيات: المدير يرى كل شيء دائماً
const can=(role,k)=>role==='مدير'||!!S.perms[role]?.[k];

// تصغير صورة الطبق قبل حفظها (حتى تبقى البيانات خفيفة وسريعة المزامنة)
function resizeImage(file,max=360){
  return new Promise((ok,no)=>{
    const img=new Image(), url=URL.createObjectURL(file);
    img.onload=()=>{
      const k=Math.min(1,max/Math.max(img.width,img.height)), c=document.createElement('canvas');
      c.width=Math.round(img.width*k); c.height=Math.round(img.height*k);
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg',.8));
    };
    img.onerror=()=>{URL.revokeObjectURL(url);no()};
    img.src=url;
  });
}
