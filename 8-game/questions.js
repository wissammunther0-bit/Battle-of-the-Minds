// questions.js — v41
// ============================================================
// 🧠 بنك الأسئلة — v41 (نسخة مجانية بلا جوائز)
//
//  • المصدر الأساسي: Firestore (collection: questions) — يُديره الأدمن.
//  • ✅ نوع واحد فقط: حُذفت تصنيفات سهل/متوسط/صعب كليًا.
//  • ✅ لغتان فقط (ar/en): كل سؤال يُدخل بالعربية والإنجليزية يدويًا
//    من الإدارة — لا ترجمة آلية (حُذف qtrans بالكامل).
//  • 🆕 v41 — بنك احتياطي مدمج (EMERGENCY_QUESTIONS): 40 سؤالاً
//    عربياً + إنجليزياً يُحمَّل من الكود فقط حين يفشل Firestore أو
//    حين البنك السحابي فارغ. هذا يضمن أن اللعبة تبدأ دائمًا حتى بلا شبكة.
//  • 🔄 دورة "بلا تكرار" لكل لاعب: السؤال لا يتكرر حتى تُعرض جميع
//    الأسئلة — الذاكرة في وثيقة اللاعب (askedQuestionIds).
//  • 💡 زر «استيراد البنك الاحتياطي» في لوحة الإدارة يرفع
//    EMERGENCY_QUESTIONS إلى Firestore دفعة واحدة لبدء سريع.
// ============================================================

/** البنك المسطّح — نوع واحد بلا صعوبات (يُملأ من Firestore) */
export const QUESTIONS = [];

/* ==========================================================
 * 🆘 v41 — البنك الاحتياطي المدمج (40 سؤالاً عربياً + إنجليزياً)
 *    يُحمَّل من الكود فقط حين يفشل Firestore أو البنك السحابي فارغ.
 *    مراجَع ومتنوع: علوم، تاريخ، جغرافيا، رياضيات، قانون، ثقافة عامة.
 *    يمكن للأدمن رفعه إلى Firestore عبر زر «استيراد البنك الاحتياطي».
 * ========================================================== */
export const EMERGENCY_QUESTIONS = [
  { q: { ar: "ما هو أكبر كوكب في المجموعة الشمسية؟", en: "What is the largest planet in the solar system?" },
    options: { ar: ["المشتري", "زحل", "الأرض", "المريخ"], en: ["Jupiter", "Saturn", "Earth", "Mars"] }, correct: 0 },
  { q: { ar: "كم عدد أرجل العنكبوت؟", en: "How many legs does a spider have?" },
    options: { ar: ["6", "8", "10", "4"], en: ["6", "8", "10", "4"] }, correct: 1 },
  { q: { ar: "ما عاصمة المملكة العربية السعودية؟", en: "What is the capital of Saudi Arabia?" },
    options: { ar: ["جدة", "الرياض", "مكة", "الدمام"], en: ["Jeddah", "Riyadh", "Mecca", "Dammam"] }, correct: 1 },
  { q: { ar: "في أي عام بدأت الحرب العالمية الأولى؟", en: "In which year did World War I begin?" },
    options: { ar: ["1912", "1914", "1916", "1918"], en: ["1912", "1914", "1916", "1918"] }, correct: 1 },
  { q: { ar: "ما العنصر الكيميائي رمزه Au؟", en: "What chemical element has the symbol Au?" },
    options: { ar: ["الفضة", "الذهب", "النحاس", "الألمنيوم"], en: ["Silver", "Gold", "Copper", "Aluminum"] }, correct: 1 },
  { q: { ar: "كم عدد أضلاع المثلث؟", en: "How many sides does a triangle have?" },
    options: { ar: ["2", "3", "4", "5"], en: ["2", "3", "4", "5"] }, correct: 1 },
  { q: { ar: "ما أطول نهر في العالم؟", en: "What is the longest river in the world?" },
    options: { ar: ["الأمازون", "النيل", "اليانغتسي", "المسيسيبي"], en: ["Amazon", "Nile", "Yangtze", "Mississippi"] }, correct: 1 },
  { q: { ar: "من مؤلف رواية «البؤساء»؟", en: "Who wrote 'Les Misérables'?" },
    options: { ar: ["شكسبير", "فيكتور هوغو", "تولستوي", "ديكنز"], en: ["Shakespeare", "Victor Hugo", "Tolstoy", "Dickens"] }, correct: 1 },
  { q: { ar: "ما سرعة الضوء تقريباً؟", en: "What is the approximate speed of light?" },
    options: { ar: ["300 ألف كم/ث", "150 ألف كم/ث", "3 آلاف كم/ث", "30 ألف كم/ث"], en: ["300,000 km/s", "150,000 km/s", "3,000 km/s", "30,000 km/s"] }, correct: 0 },
  { q: { ar: "كم عدد قارات العالم؟", en: "How many continents are there in the world?" },
    options: { ar: ["5", "6", "7", "8"], en: ["5", "6", "7", "8"] }, correct: 2 },
  { q: { ar: "ما عاصمة فرنسا؟", en: "What is the capital of France?" },
    options: { ar: ["لندن", "باريس", "برلين", "مدريد"], en: ["London", "Paris", "Berlin", "Madrid"] }, correct: 1 },
  { q: { ar: "كم عدد لاعبي فريق كرة القدم؟", en: "How many players are on a soccer team?" },
    options: { ar: ["9", "10", "11", "12"], en: ["9", "10", "11", "12"] }, correct: 2 },
  { q: { ar: "ما الغاز الذي نتنفسه للحياة؟", en: "Which gas do we breathe to live?" },
    options: { ar: ["النيتروجين", "الأكسجين", "الهيدروجين", "ثاني أكسيد الكربون"], en: ["Nitrogen", "Oxygen", "Hydrogen", "Carbon dioxide"] }, correct: 1 },
  { q: { ar: "في أي قارة تقع مصر؟", en: "On which continent is Egypt located?" },
    options: { ar: ["آسيا", "أفريقيا", "أوروبا", "أمريكا"], en: ["Asia", "Africa", "Europe", "America"] }, correct: 1 },
  { q: { ar: "كم عدد أسنان الإنسان البالغ؟", en: "How many teeth does an adult human have?" },
    options: { ar: ["28", "30", "32", "34"], en: ["28", "30", "32", "34"] }, correct: 2 },
  { q: { ar: "ما أكبر محيط في العالم؟", en: "What is the largest ocean in the world?" },
    options: { ar: ["الأطلسي", "الهندي", "الهادئ", "المتجمد"], en: ["Atlantic", "Indian", "Pacific", "Arctic"] }, correct: 2 },
  { q: { ar: "من مكتشف قانون الجاذبية؟", en: "Who discovered the law of gravity?" },
    options: { ar: ["أينشتاين", "نيوتن", "غاليليو", "تسلا"], en: ["Einstein", "Newton", "Galileo", "Tesla"] }, correct: 1 },
  { q: { ar: "ما ناتج 7 × 8؟", en: "What is 7 × 8?" },
    options: { ar: ["54", "56", "58", "64"], en: ["54", "56", "58", "64"] }, correct: 1 },
  { q: { ar: "كم عدد سور القرآن الكريم؟", en: "How many surahs are in the Quran?" },
    options: { ar: ["110", "114", "120", "124"], en: ["110", "114", "120", "124"] }, correct: 1 },
  { q: { ar: "ما عاصمة اليابان؟", en: "What is the capital of Japan?" },
    options: { ar: ["بكين", "سيول", "طوكيو", "بانكوك"], en: ["Beijing", "Seoul", "Tokyo", "Bangkok"] }, correct: 2 },
  { q: { ar: "ما أكبر حيوان على الأرض؟", en: "What is the largest animal on Earth?" },
    options: { ar: ["الفيل", "الحوت الأزرق", "الزرافة", "القرش"], en: ["Elephant", "Blue whale", "Giraffe", "Shark"] }, correct: 1 },
  { q: { ar: "في أي عام هبط الإنسان على القمر؟", en: "In which year did humans land on the moon?" },
    options: { ar: ["1965", "1969", "1972", "1975"], en: ["1965", "1969", "1972", "1975"] }, correct: 1 },
  { q: { ar: "ما عملة المملكة المتحدة؟", en: "What is the currency of the United Kingdom?" },
    options: { ar: ["اليورو", "الدولار", "الجنيه الإسترليني", "الفرنك"], en: ["Euro", "Dollar", "Pound sterling", "Franc"] }, correct: 2 },
  { q: { ar: "كم عدد عظام جسم الإنسان البالغ؟", en: "How many bones are in the adult human body?" },
    options: { ar: ["196", "206", "216", "226"], en: ["196", "206", "216", "226"] }, correct: 1 },
  { q: { ar: "ما لون الدم في الشرايين؟", en: "What color is blood in arteries?" },
    options: { ar: ["أزرق", "أحمر فاتح", "أحمر داكن", "بنفسجي"], en: ["Blue", "Bright red", "Dark red", "Purple"] }, correct: 1 },
  { q: { ar: "ما عاصمة إيطاليا؟", en: "What is the capital of Italy?" },
    options: { ar: ["باريس", "روما", "مدريد", "لشبونة"], en: ["Paris", "Rome", "Madrid", "Lisbon"] }, correct: 1 },
  { q: { ar: "كم ثانية في الساعة؟", en: "How many seconds are in an hour?" },
    options: { ar: ["600", "1200", "3600", "7200"], en: ["600", "1200", "3600", "7200"] }, correct: 2 },
  { q: { ar: "ما المعدن السائل في درجة حرارة الغرفة؟", en: "Which metal is liquid at room temperature?" },
    options: { ar: ["الزئبق", "الرصاص", "الزنك", "الحديد"], en: ["Mercury", "Lead", "Zinc", "Iron"] }, correct: 0 },
  { q: { ar: "كم عدد الكواكب في المجموعة الشمسية؟", en: "How many planets are in the solar system?" },
    options: { ar: ["7", "8", "9", "10"], en: ["7", "8", "9", "10"] }, correct: 1 },
  { q: { ar: "ما عاصمة كندا؟", en: "What is the capital of Canada?" },
    options: { ar: ["تورنتو", "أوتاوا", "فانكوفر", "مونتريال"], en: ["Toronto", "Ottawa", "Vancouver", "Montreal"] }, correct: 1 },
  { q: { ar: "من رسم لوحة الموناليزا؟", en: "Who painted the Mona Lisa?" },
    options: { ar: ["فان جوخ", "دافنشي", "بيكاسو", "مايكل أنجلو"], en: ["Van Gogh", "Da Vinci", "Picasso", "Michelangelo"] }, correct: 1 },
  { q: { ar: "كم عدد ركعات صلاة الفجر؟", en: "How many rak'ahs is the Fajr prayer?" },
    options: { ar: ["2", "3", "4", "5"], en: ["2", "3", "4", "5"] }, correct: 0 },
  { q: { ar: "ما أكبر صحراء في العالم؟", en: "What is the largest desert in the world?" },
    options: { ar: ["الصحراء الكبرى", "صحراء غوبي", "أنتاركتيكا", "صحراء كالاهاري"], en: ["Sahara", "Gobi", "Antarctica", "Kalahari"] }, correct: 2 },
  { q: { ar: "كم عدد نقاط المباراة في كرة السلة (تقريباً)؟", en: "How many points is a basketball game (approx)?" },
    options: { ar: ["50", "80", "100", "200"], en: ["50", "80", "100", "200"] }, correct: 2 },
  { q: { ar: "ما العاصمة الإدارية لمصر القديمة؟", en: "What was the administrative capital of ancient Egypt?" },
    options: { ar: ["الأقصر", "منف", "طيبة", "أسوان"], en: ["Luxor", "Memphis", "Thebes", "Aswan"] }, correct: 1 },
  { q: { ar: "كم عدد أحرف اللغة العربية؟", en: "How many letters are in the Arabic alphabet?" },
    options: { ar: ["26", "28", "30", "32"], en: ["26", "28", "30", "32"] }, correct: 1 },
  { q: { ar: "ما العنصر الأكثر وفرة في الكون؟", en: "What is the most abundant element in the universe?" },
    options: { ar: ["الأكسجين", "الهيدروجين", "الهيليوم", "الكربون"], en: ["Oxygen", "Hydrogen", "Helium", "Carbon"] }, correct: 1 },
  { q: { ar: "كم عدد جزر اليابان الرئيسية؟", en: "How many main islands does Japan have?" },
    options: { ar: ["3", "4", "5", "6"], en: ["3", "4", "5", "6"] }, correct: 1 },
  { q: { ar: "ما أعلى جبل في العالم؟", en: "What is the highest mountain in the world?" },
    options: { ar: ["K2", "إيفرست", "كليمنجارو", "مونت بلان"], en: ["K2", "Everest", "Kilimanjaro", "Mont Blanc"] }, correct: 1 },
  { q: { ar: "كم عدد اللاعبين في فريق كرة السلة على أرض الملعب؟", en: "How many basketball players are on the court per team?" },
    options: { ar: ["4", "5", "6", "7"], en: ["4", "5", "6", "7"] }, correct: 1 }
];

/** هل البنك السحابي فارغ حالياً؟ (يُستخدم لقرار الرجوع للبنك الاحتياطي) */
export function isPoolEmpty() {
  return QUESTIONS.length === 0;
}

/* ==========================================================
 * ⚡ v33.5 — كاش فوري للبنك (sessionStorage):
 *   شكوى المستخدم: «الأسئلة تتأخر في التحميل عند الدخول» — السبب:
 *   البنك لا يتوفر إلا بعد أول لقطة onSnapshot من الشبكة (ثوانٍ على
 *   الشبكات البطيئة)، فتتأخر بداية الجولة. الآن:
 *   1) عند كل إعادة بناء نحفظ نسخة مصغّرة في sessionStorage.
 *   2) عند فتح اللعبة نستعيدها فورًا (بلا شبكة) → الجولة تبدأ لحظيًا،
 *      ثم يحدّثها الاستماع اللحظي بصمت عند وصول البيانات الطازجة.
 * ========================================================== */
const QPOOL_CACHE_KEY = 'bqa_qpool_v1';
// 🏷️ v37 — إصدار البنك المخزّن (من gameMeta/questionsMeta): أساس علامة
//    الإصدار التي تمنع إعادة بناء ~1000 سؤال في كل جلسة (حارق الحصة)
let _cachedVer = null;

function _hydratePoolFromCache() {
  try {
    // 🆕 v37 — localStorage بدل sessionStorage: الكاش يبقى عبر الجلسات
    //    والتبويبات ليخدم علامة الإصدار (كان يُمسح بكل إغلاق تبويب فتُعاد
    //    قراءة البنك كاملًا من جديد في كل مرة يفتح فيها اللاعب اللعبة)
    const raw = localStorage.getItem(QPOOL_CACHE_KEY);
    if (!raw) return 0;
    const obj = JSON.parse(raw);
    // التوافق مع الصيغة القديمة (مصفوفة sessionStorage) والجديدة ({ver,qs})
    const arr = Array.isArray(obj) ? obj : obj.qs;
    if (!Array.isArray(arr) || !arr.length) return 0;
    _cachedVer = (!Array.isArray(obj) && Number.isFinite(Number(obj.ver))) ? Number(obj.ver) : null;
    QUESTIONS.length = 0;
    let n = 0;
    for (const q of arr) { const v = normalizeQuestion(q); if (v) { QUESTIONS.push(v); n++; } }
    if (n) console.log('[questions] pool hydrated from cache (instant):', n);
    return n;
  } catch { return 0; }
}

function _savePoolToCache(ver = null) {
  try {
    // نسخة مصغّرة كافية للتوحيد لاحقًا (حد أمان 800 سؤال لحجم التخزين)
    const compact = QUESTIONS.slice(0, 800).map(q => ({ q: q.q, options: q.options, correct: q.correct, dbId: q.dbId }));
    localStorage.setItem(QPOOL_CACHE_KEY, JSON.stringify({ ver: ver, qs: compact }));
    _cachedVer = Number.isFinite(Number(ver)) ? Number(ver) : null;
  } catch {}
}

// 💡 استعادة فورية عند فتح اللعبة — قبل أي اتصال بالشبكة
_hydratePoolFromCache();

/** إجمالي الأسئلة المتاحة حاليًا */
export function getQuestionPoolCount() {
  return QUESTIONS.length;
}

/**
 * 🧹 توحيد صيغ وثيقة السؤال (توافق كامل مع الوثائق القديمة والجديدة):
 *   v41: كل سؤال له نص عربي وإنجليزي — نختار نص اللغة الحالية للاعب.
 *   q: "نص" | { ar:"...", en:"..." } → نص اللغة الحالية (fallback للعربية)
 *   options: ["أ","ب"] | { ar:["أ","ب"], en:[...] } → مصفوفة اللغة الحالية
 *   difficulty: يُتجاهل كليًا (نوع واحد)
 */
function normalizeQuestion(raw) {
  // v41: اقرأ اللغة الحالية ديناميكياً (تطبيق فوري عند تغيير اللغة)
  let lang = 'ar';
  try { lang = localStorage.getItem('bqa_lang') || 'ar'; } catch {}
  const langAlt = (lang === 'en') ? 'en' : 'ar';
  const qText = typeof raw.q === 'string' ? raw.q
    : (raw.q?.[langAlt] ?? raw.q?.ar ?? raw.q?.en ?? '');
  const opts = Array.isArray(raw.options) ? raw.options
    : (Array.isArray(raw.options?.[langAlt]) ? raw.options[langAlt]
       : (Array.isArray(raw.options?.ar) ? raw.options.ar : null));
  if (!qText || !opts || opts.length < 2) return null;
  if (typeof raw.correct !== 'number' || raw.correct < 0 || raw.correct >= opts.length) return null;
  return {
    q: qText,
    options: opts,
    correct: raw.correct,
    dbId: raw.dbId || null
  };
}

/** 🆘 v41 — ملء البنك من EMERGENCY_QUESTIONS (عند فشل الشبكة أو فراغ البنك السحابي) */
function hydrateFromEmergencyBank() {
  if (QUESTIONS.length > 0) return QUESTIONS.length;
  const fresh = [];
  EMERGENCY_QUESTIONS.forEach((q, i) => {
    const n = normalizeQuestion({ ...q, dbId: 'emg_' + i });
    if (n) fresh.push(n);
  });
  if (fresh.length) {
    QUESTIONS.length = 0;
    QUESTIONS.push(...fresh);
    console.log('[questions] 🆘 hydrated from EMERGENCY bank (offline/empty):', fresh.length);
  }
  return fresh.length;
}

/**
 * 🎲 اختيار سؤال عشوائي مع تجنّب المعروض سابقًا (exclude: Set من dbId).
 * وعند استعراض كل الأسئلة يعيد null (يُصفّر المتصرف الدورة ويبدأ من جديد).
 */
export function getRandomQuestion(exclude = null) {
  if (!QUESTIONS.length) return null;
  const fresh = exclude ? QUESTIONS.filter(q => !exclude.has(q.dbId)) : QUESTIONS;
  const src = fresh.length ? fresh : QUESTIONS;
  return src[Math.floor(Math.random() * src.length)];
}

/* ==========================================================
 * 🔥 v12 — تحميل بنك الأسئلة من Firestore (المصدر الوحيد)
 *    questions/{id}: { q:"عربي", options:["عربي",...], correct, active }
 *    (الصيغ القديمة متعددة اللغات تُقبل وتُطبَّع إلى العربية)
 *
 * 🛠️ v26 — إصلاح "الأسئلة القديمة تتكرر": كان البنك يُحمَّل مرة واحدة
 *    عند إقلاع اللعبة فقط (getDocs) — فإذا حذف المطور أسئلة وأضاف
 *    جديدة أثناء وجود اللاعب داخل اللعبة ظلّت الجولات تخدم البنك
 *    القديم المخزّن في الذاكرة حتى يعيد اللاعب تحميل الصفحة.
 *    الآن الاستماع لحظي (onSnapshot): أي إضافة/حذف/إخفاء من لوحة
 *    الإدارة يصل للاعبين فورًا ويُعاد بناء البنك تلقائيًا.
 * ========================================================== */

let _questionsUnsub = null;

export async function loadAdminQuestions() {
  try {
    const [{ db }, FS] = await Promise.all([
      import('./firebase-config.js'),
      import('https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js')
    ]);

    // 🔁 ألغِ أي استماع سابق قبل إنشاء جديد (تفادي الاستماعات المتراكمة)
    if (_questionsUnsub) { try { _questionsUnsub(); } catch {} _questionsUnsub = null; }

    // 🏷️ v37 — علامة إصدار بنك الأسئلة (أكبر توفير في الحصة):
    //    قراءة وثيقة واحدة (gameMeta/questionsMeta) تكفي لمعرفة هل تغيّر
    //    البنك منذ آخر نسخة مخزّنة على الجهاز — وثيقة واحدة بدل ~1000
    //    قراءة لكل جلسة لاعب. لوحة الإدارة ترفع الإصدار مع كل إضافة/
    //    تعديل/حذف/استيراد للأسئلة (_bumpQuestionsVersion).
    let metaVersion = null;
    try {
      const meta = await FS.getDoc(FS.doc(db, 'gameMeta', 'questionsMeta'));
      if (meta.exists()) metaVersion = Number(meta.data().version) || 0;
    } catch (e) {
      console.warn('[questions] meta read failed (نكمل بالبناء الحي):', e?.message || e);
    }
    if (_cachedVer !== null && metaVersion !== null && metaVersion === _cachedVer) {
      console.log('[questions] cache fresh (إصدار ' + metaVersion + ') — تخطي البناء الحي: توفير ~1000 قراءة');
      return getQuestionPoolCount();
    }

    // 🎧 الاستماع اللحظي — onSnapshot يطلق اللقطة الأولى فورًا ثم كل تغيير
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      // مهلة أمان 8 ثوانٍ — لا نعطّل الإقلاع إن تأخرت الشبكة
      const timer = setTimeout(finish, 8000);

      _questionsUnsub = FS.onSnapshot(
        FS.query(
          FS.collection(db, 'questions'),
          FS.where('active', '==', true),
          FS.limit(1000)
        ),
        (snap) => {
          // 🛠️ v36 — بناء في مصفوفة مؤقتة ثم استبدال: لو فشل الاتصال
          //    بعد التفريغ لا يبقى البنك فارغًا (كان يصفر البنك المُستعاد
          //    من الكاش عند أي خطأ شبكة — «pool rebuilt (live): 0»)
          const fresh = [];
          snap.docs.forEach(d => {
            const n = normalizeQuestion({ ...d.data(), dbId: d.id });
            if (n) fresh.push(n);
          });
          if (fresh.length) {
            QUESTIONS.length = 0;
            QUESTIONS.push(...fresh);
            _savePoolToCache(metaVersion);   // ⚡ كاش للدخول الفوري القادم + تثبيت إصدار علامة الإصدار
          }
          console.log('[questions] pool rebuilt (live):', getQuestionPoolCount());
          clearTimeout(timer);
          finish();
        },
        (e) => {
          console.warn('[questions] live listener failed:', e?.message || e);
          // 🛠️ v36 — انقطاع شبكة والبنك فارغ؟ استعد من الكاش فورًا
          if (getQuestionPoolCount() === 0) _hydratePoolFromCache();
          clearTimeout(timer);
          finish();
        }
      );
    });

    // 🆘 v41 — إن بقي البنك فارغًا بعد المحاولة (شبكة فاشلة أو بنك سحابي فارغ)
    //    املأه من البنك الاحتياطي المدمج — اللعبة تبدأ دائمًا
    if (getQuestionPoolCount() === 0) {
      hydrateFromEmergencyBank();
    }
    return getQuestionPoolCount();
  } catch (e) {
    console.warn('[questions] loadAdminQuestions failed:', e?.message || e);
    // 🆘 v41 — فشل كامل؟ املأ من البنك الاحتياطي بدل إرجاع 0
    hydrateFromEmergencyBank();
    return getQuestionPoolCount();
  }
}
