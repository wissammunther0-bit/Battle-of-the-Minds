// i18n.js
// ==========================================================
// 🌍 نظام الترجمة الشامل
// - يدعم 28 لغة عالمية
// - يكتشف لغة المتصفح تلقائياً
// - يحفظ اللغة في localStorage
// - يطبق الاتجاه (RTL/LTR)
// - يترجم عناصر data-i18n
// ==========================================================

import { TRANSLATIONS, SUPPORTED_LANGS, LANG_META } from './translations.js';

const STORAGE_KEY = 'bqa_lang';
const DEFAULT_LANG = 'ar';

let currentLang = DEFAULT_LANG;
let initialized = false;

/* ==========================================================
 * 🌐 تجاوزات الترجمة من Firestore (يديرها المطور من صفحة الأدمن)
 *    translations/{lang} → { overrides: { key: value } }
 * ========================================================== */
const langOverrides = {}; // { [lang]: { key: value } }

/** تحميل تجاوزات لغة معينة من Firestore (أفضل محاولة — لا يفشل أبداً) */
export async function loadLangOverrides(lang = currentLang) {
  if (!lang || langOverrides[lang]) return;
  try {
    const [{ db }, FS] = await Promise.all([
      import('./firebase-config.js'),
      import('https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js')
    ]);
    const snap = await FS.getDoc(FS.doc(db, 'translations', lang));
    if (snap.exists()) {
      langOverrides[lang] = snap.data().overrides || {};
    } else {
      langOverrides[lang] = {};
    }
  } catch {
    langOverrides[lang] = {}; // بلا اتصال — نكمل بالقواميس المدمجة
  }
}

/* ==========================================================
 * الكشف عن اللغة
 * ========================================================== */
function detectLang() {
  // 1) من التخزين المحلي
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED_LANGS.includes(stored)) {
      return stored;
    }
  } catch (e) {
    // localStorage قد يكون معطلاً
  }

  // 2) من لغة المتصفح
  const navLangs = Array.isArray(navigator.languages)
    ? navigator.languages
    : [navigator.language || DEFAULT_LANG];

  for (const full of navLangs) {
    const short = (full || '').split('-')[0].toLowerCase();
    if (SUPPORTED_LANGS.includes(short)) return short;
  }

  // 3) الافتراضي
  return DEFAULT_LANG;
}

/* ==========================================================
 * التهيئة
 * ========================================================== */
export function initI18n() {
  if (initialized) {
    applyDirection();
    return currentLang;
  }
  currentLang = detectLang();
  initialized = true;
  applyDirection();
  // 🌐 تجاوزات الأدمن — عند وصولها يعاد ترجمة الصفحة تلقائياً
  loadLangOverrides(currentLang).then(() => translateDOM()).catch(() => {});
  return currentLang;
}

/* ==========================================================
 * تعيين اللغة
 * ========================================================== */
export function setLang(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) {
    console.warn('[i18n] لغة غير مدعومة:', lang);
    return false;
  }
  currentLang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch (e) {
    // تجاهل
  }
  applyDirection();

  // 🌐 اجلب تجاوزات الأدمن لهذه اللغة — تُطبق فور وصولها (إعادة ترجمة الصفحة)
  loadLangOverrides(lang).then(() => translateDOM()).catch(() => {});

  // أبلغ كل الصفحة بالتغيير
  window.dispatchEvent(new CustomEvent('langchange', {
    detail: { lang, dir: getDirection() }
  }));
  return true;
}

/* ==========================================================
 * قراءة اللغة الحالية
 * ========================================================== */
export function getLang() {
  return currentLang;
}

/* ==========================================================
 * اتجاه اللغة (RTL/LTR)
 * ========================================================== */
export function getDirection() {
  return LANG_META[currentLang]?.dir || 'ltr';
}

export function isRTL() {
  return getDirection() === 'rtl';
}

/* ==========================================================
 * الترجمة
 * ========================================================== */
export function t(key, fallback = '') {
  if (!key) return fallback;

  // 0) تجاوزات الأدمن من Firestore (الأعلى أولوية)
  const ov = langOverrides[currentLang];
  if (ov && ov[key] != null) return ov[key];

  const dict = TRANSLATIONS[currentLang] || TRANSLATIONS[DEFAULT_LANG];

  // 1) من اللغة الحالية
  if (dict && dict[key] != null) return dict[key];

  // 2) للغات غير العربية: الإنجليزية قبل العربية (القوائم الجديدة لا تبقى عربية)
  if (currentLang !== DEFAULT_LANG) {
    const ovEn = langOverrides['en'];
    if (ovEn && ovEn[key] != null) return ovEn[key];
    const enDict = TRANSLATIONS['en'];
    if (enDict && enDict[key] != null) return enDict[key];
  }

  // 3) من اللغة الافتراضية (العربية)
  const defaultDict = TRANSLATIONS[DEFAULT_LANG];
  if (defaultDict && defaultDict[key] != null) return defaultDict[key];

  // 4) من الإنجليزية
  const enDict = TRANSLATIONS['en'];
  if (enDict && enDict[key] != null) return enDict[key];

  // 5) المفتاح نفسه
  return fallback || key;
}

/* ==========================================================
 * تطبيق الاتجاه على <html>
 * ========================================================== */
function applyDirection() {
  const dir = getDirection();
  document.documentElement.dir = dir;
  document.documentElement.lang = currentLang;
  // إضافة class للتحكم بالتصميم
  document.documentElement.classList.toggle('rtl', dir === 'rtl');
  document.documentElement.classList.toggle('ltr', dir === 'ltr');
}

/* ==========================================================
 * ترجمة كل عناصر DOM
 * ========================================================== */
export function translateDOM() {
  // data-i18n → textContent
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });

  // data-i18n-placeholder → placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.placeholder = t(key);
  });

  // data-i18n-title → title
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.title = t(key);
  });

  // data-i18n-html → innerHTML (لحالات تحتاج HTML)
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    if (key) el.innerHTML = t(key);
  });

  // data-i18n-value → value (لأزرار الإرسال)
  document.querySelectorAll('[data-i18n-value]').forEach(el => {
    const key = el.getAttribute('data-i18n-value');
    if (key) el.value = t(key);
  });
}

/* ==========================================================
 * معلومات اللغة الحالية
 * ========================================================== */
export function getLangMeta(lang = currentLang) {
  return LANG_META[lang] || {
    name: lang.toUpperCase(),
    flag: '🏳️',
    dir: 'ltr'
  };
}

/* ==========================================================
 * هل اللغة مدعومة؟
 * ========================================================== */
export function isSupported(lang) {
  return SUPPORTED_LANGS.includes(lang);
}

/* ==========================================================
 * إعادة تصدير بيانات اللغات (للاستخدام في شاشة الاختيار)
 * ========================================================== */
export { SUPPORTED_LANGS, LANG_META };