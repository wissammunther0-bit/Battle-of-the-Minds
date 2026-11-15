// firebase-config.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged, GoogleAuthProvider,
  signInWithPopup, signInWithRedirect, linkWithPopup, linkWithRedirect, getRedirectResult, signOut
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { initializeFirestore, memoryLocalCache } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

// 🆕 v31 — مشروع Firebase الجديد الرسمي «معركة العقول» (Battle of the Minds)
//    انتقلنا من مشروع التجربة (world-adf78) إلى مشروعك الشخصي النهائي.
//    ⚠️ مهم بعد التبديل:
//    1) من Firebase Console ← Authentication فعّل «تسجيل الدخول المجهول»
//       (Anonymous) و«Google» — وإلا لن يعمل الدخول إطلاقًا.
//    2) أضف النطاقات المصرح بها: localhost + wissammunther0-bit.github.io
//       (Authentication ← Settings ← Authorized domains).
//    3) أنشئ وثيقة admins/{uid} لحسابك من Firestore (انظر دليل النشر).
export const firebaseConfig = {
  apiKey: "AIzaSyBYtXV74wCtZBfKmXDpbWXch66MABx2egQ",
  authDomain: "battle-of-the-minds.firebaseapp.com",
  projectId: "battle-of-the-minds",
  storageBucket: "battle-of-the-minds.firebasestorage.app",
  messagingSenderId: "208728870791",
  appId: "1:208728870791:web:9498c610ecbb01df354d22"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// ✅ استخدام الذاكرة لتجنب أخطاء الكاش (BloomFilter)
// 🔧 v28 — experimentalAutoDetectLongPolling: بعض الشبكات/البروكسي
//    تحجب قناة WebChannel المباشرة فتتكرر في الكونسول أخطاء
//    «WebChannelConnection RPC 'Listen' transport errored» و 404.
//    الكشف التلقائي ينتقل للوضع المتوافق (long-polling) عند الحاجة —
//    نفس البيانات اللحظية، واتصال أكثر استقرارًا على الشبكات الصعبة.
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache(),
  experimentalAutoDetectLongPolling: true
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
 * 🔗 ربط الحساب السريع (Anonymous) بحساب Google
 *    — يحافظ على نفس UID وكل تقدم اللاعب
 *    — Popup أولاً، وإن حُجب أو تعلّق (بيئات COOP التي تمنع
 *      قراءة window.closed فتبقى النافذة معلّقة بلا نتيجة)
 *      ننتقل تلقائيًا لـ Redirect
 * ========================================================== */
export async function linkAccountWithGoogle() {
  const user = auth.currentUser;
  if (!user) return { ok: false, msg: 'no user' };

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
    // حساب Google مربوط مسبقاً بحساب آخر / popup حُجب أو تعلّق /
    // بيئة لا تدعم النوافذ المنبثقة / المستخدم أغلق النافذة
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/popup-blocked-env' ||
      code === 'auth/operation-not-supported-in-this-enviroment'
    ) {
      try {
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

/** إكمال نتيجة Redirect عند العودة (إذا كان الربط عبر إعادة تحميل) */
export async function finishGoogleRedirect() {
  try {
    const result = await getRedirectResult(auth);
    return result; // null إن لم يكن هناك redirect
  } catch { return null; }
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