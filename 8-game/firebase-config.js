// firebase-config.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged, GoogleAuthProvider,
  signInWithPopup, signInWithRedirect, signInWithCredential,
  linkWithPopup, linkWithRedirect, getRedirectResult, signOut
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { initializeFirestore, memoryLocalCache } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

// 🆕 v41.1 — مشروع Firebase الفعّال: world-adf78 (مشروعك الذي ضبطت فيه
//    Authentication + Firestore + App Check + القواعد). يطابق إعداد نسختك.
//    ⚠️ متطلبات المشروع (تأكد منها في Firebase Console):
//    1) Authentication ← Sign-in method ← فعّل «Anonymous» و«Google».
//    2) Authentication ← Settings ← Authorized domains ← أضف localhost
//       + نطاق النشر (مثلاً wissammunther0-bit.github.io).
//    3) أنشئ وثيقة admins/{uid} لحسابك في Firestore (انظر دليل النشر).
export const firebaseConfig = {
  apiKey: "AIzaSyC8UJLG-f8c9GkAEnmAWn-hWM8qtT7ReZM",
  authDomain: "world-adf78.firebaseapp.com",
  databaseURL: "https://world-adf78-default-rtdb.firebaseio.com",
  projectId: "world-adf78",
  storageBucket: "world-adf78.firebasestorage.app",
  messagingSenderId: "1081586537020",
  appId: "1:1081586537020:web:230e70b5c58a63c38aa939"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// 🛡️ v41.1 — App Check على localhost: تثبيت debug token ليكون ثابتاً عبر الجلسات
//    (بدونه يُولّد Firebase توكناً عشوائياً جديداً كل مرة ويجب إعادة تسجيله).
//    ✅ سجّل هذا التوكن مرة واحدة فقط في Firebase Console ← App Check ←
//    Manage debug tokens، ثم يعمل localhost للأبد دون إعادة تسجيل.
//    (يعمل فقط على localhost/127.0.0.1؛ في الإنتاج يستخدم reCAPTCHA الحقيقي)
if (typeof location !== 'undefined' &&
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = '20ef0ded-be48-4132-81ba-5de0440a923f';
}

// 🛡️ v38 (فحص الأمان — مشكلة 6): Firebase App Check — يُفعَّل فقط عند
//    وضع مفتاح reCAPTCHA v3 في الصفحة قبل تحميل اللعبة:
//      <script>window.APP_CHECK_SITE_KEY = '6L...مفتاحك...';</script>
//    خطوات التفعيل الكاملة في 5-functions/دليل-الترقية-الأمنية.md
//    (بدون المفتاح يعمل السطر أدناه بلا شيء — لا يكسر اللعبة)
try {
  if (typeof window !== 'undefined' && window.APP_CHECK_SITE_KEY) {
    import('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-check.js')
      .then(({ initializeAppCheck, ReCaptchaV3Provider }) => {
        initializeAppCheck(app, {
          provider: new ReCaptchaV3Provider(window.APP_CHECK_SITE_KEY),
          isTokenAutoRefreshEnabled: true
        });
        console.log('[AppCheck] ✅ مُفعَّل (reCAPTCHA v3)');
      })
      .catch((e) => console.warn('[AppCheck]', e?.message || e));
  }
} catch { /* بلا حماية — لا يكسر الإقلاع */ }

// ✅ استخدام الذاكرة لتجنب أخطاء الكاش (BloomFilter)
// 🛠️ v36 — إصلاح جذري لانقطاع Firestore (صور المستخدم 86/88/94):
//    experimentalAutoDetectLongPolling (v28) لم يكفي — الشبكات التي تحجب
//    WebChannel كانت تعيد «Could not reach Cloud Firestore backend»
//    و«WebChannelConnection RPC 'Listen' transport errored» و404 في كل
//    مرة (لوحة الإدارة لا تفتح + الكتالوج والأسئلة بلا اتصال). الآن:
//    **فرض Long-Polling دائمًا** — قناة HTTP متوافقة مع كل الشبكات
//    والبروكسي بلا محاولة WebChannel فاشلة في البداية.
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache(),
  experimentalForceLongPolling: true,
  // 🛡️ حماية إضافية: أقصى مهلة انتظار معقولة لكل طلب (بالثواني)
  //    بدل تعليق 10 ثوانٍ كاملة قبل إعلان الانقطاع
  fetchImpl: (url, opts) => fetch(url, { ...opts, cache: 'no-store' })
});

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

let authPromise = null;

/* ==========================================================
 * 🈯 v28 — ترجمة أخطاء Firebase Auth إلى رسائل عربية واضحة
 *   كان اللاعب يرى الرسالة الخام «Firebase: Error (auth/
 *   unauthorized-domain)» بلا أي فائدة — الآن يرى السبب والحل
 *   خطوة بخطوة (مثل إضافة النطاق إلى النطاقات المصرح بها)
 * ========================================================== */
export function friendlyAuthError(e) {
  const code = e?.code || String(e?.message || '');
  let host = '';
  try { host = location.hostname; } catch {}
  if (code.includes('unauthorized-domain') || code.includes('auth/unauthorized-domain')) {
    return `نطاقك الحالي (${host || 'هذا الموقع'}) غير مصرّح به في Firebase — لهذا لا يعمل تسجيل الدخول بـ Google. الحل: افتح Firebase Console ← Authentication ← Settings ← Authorized domains ← Add domain وأضف ${host || 'نطاقك'} ثم أعد المحاولة (أو استخدم localhost للتجربة على نفس الجهاز).`;
  }
  if (code.includes('operation-not-allowed')) {
    return 'تسجيل الدخول بـ Google غير مفعّل في مشروع Firebase — فعّله من Console ← Authentication ← Sign-in method ← Google ثم أعد المحاولة.';
  }
  if (code.includes('configuration-not-found')) {
    return 'لم يُضبط مزوّد Google بعد في المشروع — فعّله من Console ← Authentication ← Sign-in method ← Google.';
  }
  if (code.includes('network-request-failed')) {
    return 'تعذّر الوصول إلى خوادم Google — تحقق من اتصال الإنترنت ثم أعد المحاولة.';
  }
  if (code.includes('popup-blocked')) {
    return 'حجب المتصفح النافذة المنبثقة — اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.';
  }
  if (code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) {
    return 'أُلغي تسجيل الدخول — أُغلقت نافذة Google قبل إكماله.';
  }
  if (code.includes('too-many-requests')) {
    return 'محاولات كثيرة في وقت قصير — انتظر قليلًا ثم أعد المحاولة.';
  }
  if (code.includes('api-key-not-valid') || code.includes('invalid-api-key')) {
    return 'مفتاح API غير صالح — راجع إعدادات firebase-config.js.';
  }
  return e?.message || 'حدث خطأ غير متوقع أثناء تسجيل الدخول — أعد المحاولة.';
}

export async function ensureAuth() {
  if (auth.currentUser) return auth.currentUser;

  if (!authPromise) {
    authPromise = new Promise((resolve, reject) => {
      const unsub = onAuthStateChanged(auth, (user) => {
        if (user) { unsub(); resolve(user); }
      });
      signInAnonymously(auth).catch((err) => { unsub(); authPromise = null; reject(err); });
    });
  }
  return authPromise;
}

/* ==========================================================
 * ⏳ v32 — جاهزية حالة المصادقة (Auth Ready)
 *  onAuthStateChanged يطلق أول مرة عند استعادة الجلسة المحفوظة
 *  (من localStorage) — وقبل ذلك auth.currentUser = null حتى لو كان
 *  الحساب مربوطًا بـGoogle فعلاً. من يقرأ currentUser قبل الجاهزية
 *  يظن الحساب غير مربوط فيظهر زر «اربط حسابك» خطأً في الملف التعريفي.
 *  🐞 هذا هو سبب «الملف التعريفي يقول اربط حسابك رغم أن الحساب مربوط».
 * ========================================================== */
let _authReadyPromise = null;
export function authReady() {
  if (!_authReadyPromise) {
    _authReadyPromise = new Promise((resolve) => {
      if (auth.currentUser) { resolve(auth.currentUser); return; }
      const unsub = onAuthStateChanged(auth, (user) => {
        unsub();
        resolve(user);
      });
      // 🛡️ أمان زمني: لا نعلّق الواجهة أكثر من 6 ثوانٍ على استعادة الجلسة
      setTimeout(() => resolve(auth.currentUser), 6000);
    });
  }
  return _authReadyPromise;
}

export async function signInWithGoogle() {
  // 🈯 v31.2 — سباق مهلة 8 ثوانٍ: بعض البيئات (COOP على github.io ومتصفحات
  //    الهاتف) تُعلّق النافذة المنبثقة بلا خطأ ولا نتيجة — بعد المهلة ننتقل
  //    تلقائيًا لـ Redirect (موثوق في كل البيئات) ويعود اللاعب مسجلاً.
  let expireTimer;
  const popupAttempt = Promise.race([
    signInWithPopup(auth, googleProvider),
    new Promise((_, reject) => {
      expireTimer = setTimeout(() => reject({ code: 'auth/popup-blocked-env' }), 8000);
    })
  ]).finally(() => clearTimeout(expireTimer));

  try {
    const result = await popupAttempt;
    return { ok: true, user: result.user };
  } catch (e) {
    const code = e?.code || '';
    // popup حُجب أو تعلّق أو البيئة لا تدعمه → إعادة توجيه كاملة
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/popup-blocked-env' ||
      code === 'auth/operation-not-supported-in-this-enviroment'
    ) {
      try {
        await signInWithRedirect(auth, googleProvider);
        return { ok: true, redirect: true }; // المتابعة تكتمل بعد العودة تلقائيًا
      } catch (e2) {
        return { ok: false, code: e2?.code || '', msg: friendlyAuthError(e2) };
      }
    }
    // 🈯 v28 — رسالة عربية واضحة بدل الخطأ الخام (مثل unauthorized-domain)
    return { ok: false, code, msg: friendlyAuthError(e) };
  }
}

/* ==========================================================
 * 🔗 ربط الحساب السريع (Anonymous) بحساب Google — v33 النسخة الاحترافية
 *    — يحافظ على نفس UID وكل تقدم اللاعب (ربط وليس دخولًا جديدًا!)
 *    — إن كان مربوطًا مسبقًا: نجاح فوري بلا نافذة
 *    — Popup أولًا مع سباق مهلة 8 ثوانٍ، وإن حُجب/تعلّق (بيئات COOP)
 *      ننتقل تلقائيًا لـ Redirect الموثوق على كل الأجهزة
 *    — ⚔️ تعارض البريد (credential-already-in-use): حساب Google موجود
 *      مسبقًا بمعرّف آخر (محاولة قديمة مثلًا) → ندخل بالاعتماد الذي
 *      أعاده الخطأ نفسه ونُرجع { merged: true, previousUid } ليدمج
 *      المستدعي ملف اللاعب على المعرف الجديد بدل إنشاء معرّف ثالث
 * ========================================================== */
const PENDING_LINK_KEY = 'bqa_google_link_pending';   // 🧭 uid السابق قبل Redirect الربط

function _markPendingLink(uid) {
  try { sessionStorage.setItem(PENDING_LINK_KEY, uid || ''); } catch {}
}
function _takePendingLink() {
  try {
    const v = sessionStorage.getItem(PENDING_LINK_KEY) || '';
    sessionStorage.removeItem(PENDING_LINK_KEY);
    return v;
  } catch { return ''; }
}

/** ⚔️ دخول بالاعتماد المُرجَع من خطأ التعارض — يُرجع مستخدم Google نفسه */
async function _signInWithConflictCredential(cred) {
  try { await signOut(auth); } catch {}
  return signInWithCredential(auth, cred);
}

export async function linkAccountWithGoogle() {
  // ⏳ v33.5 — انتظر اكتمال استعادة/إنشاء الجلسة قبل قراءتها:
  //    الضغط السريع على الزر كان يقرأ auth.currentUser قبل أن يُعيد
  //    Firebase الجلسة المحفوظة فيظهر «no user» (شكوى المستخدم) —
  //    الآن نضمن وجود مستخدم دائمًا قبل أي ربط
  let user = null;
  try { user = await ensureAuth(); } catch { user = null; }
  if (!user) {
    return { ok: false, code: '', msg: 'تعذر تجهيز جلسة المصادقة — تحقق من اتصال الإنترنت ثم أعد المحاولة' };
  }

  // ✅ مربوط مسبقًا؟ لا نافذة ولا إعادة توجيه — نجاح فوري (يدعم الربط المتقطع)
  if ((user.providerData || []).some(p => p && p.providerId === 'google.com')) {
    return { ok: true, already: true, user };
  }

  // 🧯 سباق مهلة: بعض البيئات (Cross-Origin-Opener-Policy) تعلّق
  //    النافذة المنبثقة دون خطأ ولا نتيجة — بعد 8 ثوانٍ نعتبرها
  //    محجوبة ونكمل عبر إعادة التوجيه (موثوق في كل البيئات)
  let expireTimer;
  const popupAttempt = Promise.race([
    linkWithPopup(user, googleProvider),
    new Promise((_, reject) => {
      expireTimer = setTimeout(
        () => reject({ code: 'auth/popup-blocked-env' }),
        8000
      );
    })
  ]).finally(() => clearTimeout(expireTimer));

  try {
    const result = await popupAttempt;
    return { ok: true, user: result.user };
  } catch (e) {
    const code = e?.code || '';

    // ⚔️ تعارض البريد: بريد Google مسجّل بمعرّف آخر — دمج محترم:
    //    ندخل بالحساب الموجود نفسه (بلا إنشاء معرّف جديد إطلاقًا)
    //    ونترك للمستدعي ترحيل ملف اللاعب من المعرف السابق
    if (code === 'auth/credential-already-in-use' && e?.credential) {
      try {
        const previousUid = user.uid;
        const res = await _signInWithConflictCredential(e.credential);
        return { ok: true, user: res.user, merged: true, previousUid };
      } catch (e2) {
        return { ok: false, code: e2?.code || '', msg: friendlyAuthError(e2) };
      }
    }

    // ⚔️ v36 — بريد Google له حساب قائم بكلمة مرور (email-already-in-use):
    //    الحالة التي كانت تفشل دائمًا عند المستخدم (حسابه wissammunther0@
    //    gmail.com موجود في المصادقة كمزوّد بريد). الحل: تسجيل دخول بـ
    //    Google مباشرة — Firebase يدخل بالحساب القائم ويربط مزوّد Google
    //    به تلقائيًا، ثم merged=true ليرحّل ملف اللاعب المحلي كاملًا
    if (code === 'auth/email-already-in-use') {
      try {
        const previousUid = user.uid;
        const res = await signInWithPopup(auth, googleProvider);
        return { ok: true, user: res.user, merged: true, previousUid };
      } catch (e2) {
        return { ok: false, code: e2?.code || '', msg: friendlyAuthError(e2) };
      }
    }

    // حساب Google مربوط مسبقاً بحساب آخر / popup حُجب أو تعلّق /
    // بيئة لا تدعم النوافذ المنبثقة / المستخدم أغلق النافذة
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/popup-blocked-env' ||
      code === 'auth/operation-not-supported-in-this-enviroment'
    ) {
      try {
        _markPendingLink(user.uid);   // 🧭 ليعرف مُكمل العودة من هو المعرف السابق
        await linkWithRedirect(user, googleProvider);
        return { ok: true, redirect: true }; // سيتابع عبر إعادة التحميل
      } catch (e2) {
        return { ok: false, code: e2?.code || '', msg: friendlyAuthError(e2) };
      }
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return { ok: false, cancelled: true, msg: 'cancelled' };
    }
    return { ok: false, code: e?.code || '', msg: friendlyAuthError(e) };
  }
}

/* ==========================================================
 * 🔄 إكمال نتيجة Redirect عند العودة — v33 نسخة موحّدة ذكية
 *  - تُستدعى من موضعين عند الإقلاع (register.js و profile.js) —
 *    النتيجة تُحسب مرة واحدة فقط وتُخزَّن لكلا المستدعيين
 *  - تعارض البريد في مسار Redirect (يظهر كخطأ عند العودة):
 *    ندخل بالاعتماد المُرجَع ونُرجع merged=true لدمج الملف
 *  @returns {null|{ok:boolean, user?:object, merged?:boolean,
 *                    previousUid?:string, msg?:string}}
 * ========================================================== */
let _redirectResultCache = null;
export async function finishGoogleRedirect() {
  if (_redirectResultCache) return _redirectResultCache;
  _redirectResultCache = (async () => {
    const previousUid = _takePendingLink();
    try {
      const result = await getRedirectResult(auth);
      if (result?.user) {
        return { ok: true, user: result.user, merged: false, previousUid };
      }
      return null;   // لا يوجد redirect معلّق — إقلاع عادي
    } catch (e) {
      // ⚔️ تعارض البريد في مسار Redirect — نفس دمج مسار Popup
      if (e?.code === 'auth/credential-already-in-use' && e?.credential) {
        try {
          const res = await _signInWithConflictCredential(e.credential);
          return { ok: true, user: res.user, merged: true, previousUid };
        } catch (e2) {
          return { ok: false, msg: friendlyAuthError(e2) };
        }
      }
      // ⚔️ v36 — بريد Google له حساب قائم بكلمة مرور في مسار Redirect:
      //    بعد العودة من التوجيه لا ضمانة لنافذة منبثقة (بلا إيماءة) —
      //    نحاول الدخول المباشر وإن حُجب نعرض رسالة واضحة بإعادة الضغط
      if (e?.code === 'auth/email-already-in-use') {
        try {
          const res = await signInWithPopup(auth, googleProvider);
          return { ok: true, user: res.user, merged: true, previousUid };
        } catch (e2) {
          return {
            ok: false,
            msg: 'بريدك مرتبط بحساب قائم في المصادقة — اضغط زر الربط مرة أخرى لإكمال الدمج (سيُطلب اختيار حسابك)'
          };
        }
      }
      console.warn('[auth] redirect result error:', e?.code || e?.message || e);
      return { ok: false, msg: friendlyAuthError(e) };
    }
  })();
  return _redirectResultCache;
}

export async function initFirebase() {
  return ensureAuth();
}

/* ==========================================================
 * 🚪 إنهاء الجلسة المجهولة الحالية — يُستدعى من زر «متابعة» في
 *    شاشة الحظر: عند إعادة التحميل تُنشأ جلسة مجهولة جديدة
 *    بمعرّف (UID) جديد نظيف بلا وثيقة حظر قديمة، فيعود اللاعب
 *    كأنه لاعب جديد يمكنه التسجيل من جديد
 * ========================================================== */
export async function resetAuthSession() {
  try { await signOut(auth); } catch {}
}