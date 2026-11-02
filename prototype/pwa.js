/* pwa.js — تثبيت البرنامج كتطبيق على الموبايل والكمبيوتر، وحفظه ليفتح بدون إنترنت
 * يعمل فقط على https (مثل GitHub Pages) أو localhost — المتصفحات لا تسمح به على http عادي.
 */
(function () {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
  // عند وصول نسخة جديدة من البرنامج: نحدّث الصفحة مرة واحدة لتظهر التعديلات
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !navigator.serviceWorker.controller) return;
    reloaded = true;
    const a = document.activeElement;
    if (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return;   // لا نقطع على المستخدم كتابته
    location.reload();
  });
})();
