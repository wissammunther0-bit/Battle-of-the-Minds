// questions.js — v12
// ============================================================
// 🧠 بنك الأسئلة — من قاعدة البيانات فقط (طلب المستخدم)
//
//  • لا أسئلة داخل ملفات الكود إطلاقًا: كل الأسئلة تُدخلها من
//    صفحة الإدارة وتُخزَّن في Firestore (collection: questions)
//  • ✅ نوع واحد فقط (v12 — طلب المستخدم): حُذفت تصنيفات
//    سهل/متوسط/صعب كليًا — كل الأسئلة في بنك واحد مسطّح
//  • ✅ العربية مصدر واحد (v12): يضيف المطور السؤال بالعربية فقط،
//    والترجمة لكل لاعب تتم تلقائيًا عبر game/qtrans.js — لا حاجة
//    لإدخال السؤال بكل اللغات
//  • إن لم يُضف المطور أي سؤال → لا توجد أسئلة ولا تبدأ الجولة
//    (تظهر رسالة واضحة للاعب)
//  • 🔄 دورة "بلا تكرار" لكل لاعب (طلب المستخدم): السؤال لا يتكرر
//    حتى تُعرض جميع الأسئلة على اللاعب — الذاكرة تُحفظ في وثيقة
//    اللاعب (askedQuestionIds) فلا يستطيع حفظ الأسئلة، وحين تُعرض
//    كلها تبدأ دورة جديدة تلقائيًا
// ============================================================

/** البنك المسطّح — نوع واحد بلا صعوبات */
export const QUESTIONS = [];

/** إجمالي الأسئلة المتاحة حاليًا */
export function getQuestionPoolCount() {
  return QUESTIONS.length;
}

/**
 * 🧹 توحيد صيغ وثيقة السؤال (توافق كامل مع الوثائق القديمة):
 *   q: "نص" | { ar:"...", en:"..." } → النص العربي
 *   options: ["أ","ب"] | { ar:["أ","ب"], en:[...] } → مصفوفة عربية
 *   difficulty: يُتجاهل كليًا (نوع واحد — طلب المستخدم)
 */
function normalizeQuestion(raw) {
  const qText = typeof raw.q === 'string' ? raw.q : (raw.q?.ar ?? raw.q?.en ?? '');
  const opts = Array.isArray(raw.options) ? raw.options
    : (Array.isArray(raw.options?.ar) ? raw.options.ar : null);
  if (!qText || !opts || opts.length < 2) return null;
  if (typeof raw.correct !== 'number' || raw.correct < 0 || raw.correct >= opts.length) return null;
  return {
    q: qText,
    options: opts,
    correct: raw.correct,
    // 🔄 معرّف قاعدة البيانات — لتتبع "ما عُرض عليّ سابقًا"
    dbId: raw.dbId || null
  };
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
          QUESTIONS.length = 0;
          snap.docs.forEach(d => {
            const n = normalizeQuestion({ ...d.data(), dbId: d.id });
            if (n) QUESTIONS.push(n);
          });
          console.log('[questions] pool rebuilt (live):', getQuestionPoolCount());
          clearTimeout(timer);
          finish();
        },
        (e) => {
          console.warn('[questions] live listener failed:', e?.message || e);
          clearTimeout(timer);
          finish();
        }
      );
    });

    return getQuestionPoolCount();
  } catch (e) {
    console.warn('[questions] loadAdminQuestions failed:', e?.message || e);
    return 0;
  }
}
