// net-watch.js — v28 (طلب المستخدم)
// ============================================================
// 📡 شاشة انقطاع الإنترنت التفاعلية — بديل شاشات المتصفح الافتراضية
//
//  • تظهر فورًا عند انقطاع الشبكة (حدث offline / فشل فحص الخادم)
//  • لا تختفي حتى يعود الإنترنت فعليًا (فحص حقيقي لخادم حقيقي —
//    لا يكفي navigator.onLine وحده)
//  • زر «إعادة المحاولة»: يفحص الاتصال — إن وُجد انضمت الشاشة
//    وعادت اللعبة، وإن لم يوجد بقيت الشاشة مع رسالة واضحة
//  • فحص دوري تلقائي كل 8 ثوانٍ — العودة للعبة تحدث من تلقاء نفسها
//    دون الحاجة للضغط (الزر لمحاولة فورية)
//  • تصميم احترافي متوافق مع هوية اللعبة (عربي/إنجليزي)
//
//  🔧 v28 — إصلاح رسائل 404 المتكررة في الكونسول:
//    كان الفحص يضرب https://firestore.googleapis.com/ مباشرة —
//    جذر هذا الخادم يرجع 404 دائمًا حتى مع وجود الإنترنت، فيكتب
//    المتصفح خطأ GET … 404 في الكونسول كل فحص. الآن الفحص عبر
//    نقاط generate_204 الرسمية المخصصة لهذا الغرض (ترجع 204
//    نظيفة بلا أي خطأ في الكونسول) — نفس الموثوقية، صفر ضجيج.
// ============================================================

// نقاط فحص الاتصال الرسمية (خوادم Google نفسها التي يعتمد عليها
// «فايبراس») — أول نقطة تنجح تكفي. أي رد HTTP = الشبكة موجودة.
const PING_URLS = [
  'https://www.gstatic.com/generate_204',
  'https://www.google.com/generate_204'
];
const PING_TIMEOUT = 6000;      // مهلة الفحص الواحد
const AUTO_CHECK_MS = 8000;     // الفحص الدوري أثناء ظهور الشاشة

const T = {
  ar: {
    title: 'انقطع الاتصال بالإنترنت',
    sub: 'لا تقلق — قد تتأخر المزامنة قليلًا وستُستكمل تلقائيًا بمجرد عودة الشبكة.',
    idle: '📡 جاري مراقبة الاتصال…',
    checking: '⏳ جاري التحقق من وجود إنترنت…',
    fail: '⛔ لا يوجد إنترنت بعد — تأكد من الشبكة ثم حاول مجددًا',
    ok: '✅ عاد الاتصال — أهلًا بك مجددًا',
    retry: 'إعادة المحاولة'
  },
  en: {
    title: 'Internet connection lost',
    sub: "Don't worry — your progress is safely saved. The game resumes automatically once you're back online.",
    idle: '📡 Monitoring connection…',
    checking: '⏳ Checking for internet…',
    fail: '⛔ Still offline — check your network and try again',
    ok: '✅ Back online — welcome back',
    retry: 'Retry'
  }
};

let shown = false;
let checking = false;
let autoTimer = null;

function L() {
  try { return (localStorage.getItem('bqa_lang') || 'ar') === 'en' ? 'en' : 'ar'; }
  catch { return 'ar'; }
}
function el(id) { return document.getElementById(id); }
function txt(key) { return T[L()][key] || T.ar[key]; }

/** 🧪 فحص حقيقي للاتصال: طلب صامت لنقطة generate_204 الرسمية.
 *  أي رد HTTP = الشبكة موجودة — الفشل/المهلة = لا إنترنت.
 *  v28: تُجرَّب النقاط بالتتابع (الأولى تكفي) — وبلا أي رسالة
 *  404 في الكونسول لأن نقاط generate_204 مصممة للفحص نفسها. */
function fetchOnce(url) {
  return new Promise((resolve) => {
    let done = false;
    let ctrl = null;
    try { ctrl = new AbortController(); } catch {}
    const to = setTimeout(() => {
      if (!done) { done = true; try { ctrl && ctrl.abort(); } catch {} resolve(false); }
    }, PING_TIMEOUT);
    fetch(url, {
      method: 'GET',
      mode: 'no-cors',          // لا يهم محتوى الرد — يكفي نجاح الشبكة نفسها
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    }).then(() => {
      if (!done) { done = true; clearTimeout(to); resolve(true); }
    }).catch(() => {
      if (!done) { done = true; clearTimeout(to); resolve(false); }
    });
  });
}

async function ping() {
  try { if (navigator.onLine === false) return false; } catch {}
  for (const url of PING_URLS) {
    if (await fetchOnce(url)) return true;
  }
  return false;
}

function setStatus(mode) {
  const st = el('nw-status');
  const btn = el('nw-retry');
  const ico = el('nw-retry-ico');
  if (st) st.textContent = txt(mode === 'checking' ? 'checking' : (mode === 'fail' ? 'fail' : 'idle'));
  st && (st.className = 'nw-status' + (mode === 'fail' ? ' nw-fail' : ''));
  if (btn) btn.disabled = (mode === 'checking');
  if (ico) ico.classList.toggle('nw-spin', mode === 'checking');
}

/** 📺 إظهار الشاشة التفاعلية */
function showNetWatch() {
  const box = el('net-watch');
  if (!box || shown) return;
  shown = true;
  box.classList.remove('hidden');
  try { document.body.classList.add('netwatch-lock'); } catch {}
  applyTexts();
  setStatus('idle');
  if (!autoTimer) {
    autoTimer = setInterval(() => { if (shown) autoCheck(); }, AUTO_CHECK_MS);
  }
}

/** 🎮 إخفاء الشاشة والعودة للعبة */
function hideNetWatch(okMsg) {
  const box = el('net-watch');
  if (!box) return;
  shown = false;
  checking = false;
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  try { document.body.classList.remove('netwatch-lock'); } catch {}
  box.classList.add('hidden');
  if (okMsg) {
    // 🔔 إشعار قصير بعد العودة — عبر وحدة إشعارات اللعبة إن وُجدت
    try {
      import('./ui/helpers.js').then(m => m.notify && m.notify(okMsg)).catch(() => {});
    } catch {}
  }
}

function applyTexts() {
  const t = el('nw-title'); if (t) t.textContent = txt('title');
  const s = el('nw-sub'); if (s) s.textContent = txt('sub');
  const r = el('nw-retry-txt'); if (r) r.textContent = txt('retry');
}

/** 🔁 الفحص التلقائي الدوري — يعيد اللعبة فور عودة الشبكة */
async function autoCheck() {
  if (!shown || checking) return;
  checking = true;
  const ok = await ping();
  checking = false;
  if (ok && shown) hideNetWatch(txt('ok'));
}

/** 👆 زر «إعادة المحاولة» — فحص فوري بأثر مرئي (طلب المستخدم) */
async function retryNow() {
  if (checking) return;
  checking = true;
  setStatus('checking');
  const ok = await ping();
  checking = false;
  if (ok) {
    hideNetWatch(txt('ok'));
  } else {
    // لا إنترنت بعد → الشاشة التفاعلية تبقى وتعود برسالة واضحة
    setStatus('fail');
    const box = el('nw-box');
    if (box) {
      box.classList.remove('nw-shake');
      void box.offsetWidth;        // إعادة تشغيل الأنيميشن
      box.classList.add('nw-shake');
      setTimeout(() => box.classList.remove('nw-shake'), 600);
    }
    // نعود لوضع المراقبة بعد ثوانٍ — الفحص الدوري مستمر
    setTimeout(() => { if (shown) setStatus('idle'); }, 4000);
  }
}

/** 🚀 التهيئة — تُستدعى مرة عند إقلاع اللعبة */
export function initNetWatch() {
  const box = el('net-watch');
  if (!box) return;
  applyTexts();
  const btn = el('nw-retry');
  if (btn) btn.onclick = retryNow;

  // انقطاع فوري (حدث المتصفح)
  window.addEventListener('offline', () => showNetWatch());

  // عودة الشبكة (حدث المتصفح) — نتحقق فعليًا قبل إخفاء الشاشة
  window.addEventListener('online', async () => {
    if (!shown) return;
    checking = true;
    setStatus('checking');
    const ok = await ping();
    checking = false;
    if (ok) hideNetWatch(txt('ok'));
    else { setStatus('fail'); setTimeout(() => { if (shown) setStatus('idle'); }, 4000); }
  });

  // 🕵️ مراقبة نشطة: بعض الأجهزة لا تُطلق حدث offline فورًا
  //    (مثال: قطع المودم والإبقاء على Wi-Fi موصولًا) — الفحص الدوري
  //    الصامت يكتشف الانقطاع ويظهر الشاشة
  setInterval(async () => {
    if (checking) return;
    if (shown) { autoCheck(); return; }
    // فحص خفيف دوري حتى والشاشة مخفية (كل 20 ثانية)
    if ((Date.now() - (initNetWatch._last || 0)) < 20000) return;
    initNetWatch._last = Date.now();
    const ok = await ping();
    if (!ok) showNetWatch();
  }, 4000);
}
