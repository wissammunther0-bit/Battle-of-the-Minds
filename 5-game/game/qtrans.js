// game/qtrans.js — v12 (جديد)
// ============================================================
// 🌐 الترجمة التلقائية للأسئلة — طلب المستخدم
//
//  • المطور يضيف السؤال بالعربية فقط من صفحة الإدارة.
//  • كل لاعب يرى السؤال وخياراته بلغته التي اختارها تلقائيًا
//    (لغة المتصفح أول مرة، ثم من الإعدادات في الملف الشخصي).
//
//  الهندسة (احترافية — سريعة ورخيصة):
//   1) ذاكرة الجلسة (Map) — الصفر زمن لأي نص مترجم سابقًا.
//   2) ذاكرة مشتركة في Firestore (collection: qtrans) — يترجم كل
//      نص مرة واحدة فقط لكل لغة على مستوى اللعبة كلها، ثم يقرأه
//      كل اللاعبين من قاعدة البيانات بلا أي استدعاء خارجي.
//   3) مزود الترجمة: بوابة Google Translate العامة (gtx).
//   4) أي فشل شبكي → يعاد النص العربي الأصلي (لا تعطل السؤال أبدًا).
//   5) الترجمات المتزامنة (السؤال + كل الخيارات معًا) بـ Promise.all
//      فلا ينتظر اللاعب إلا رحلة واحدة.
// ============================================================

import { db, ensureAuth } from '../firebase-config.js';
import { getLang } from '../i18n.js';
import {
  doc, getDoc, setDoc
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

/** 🧠 ذاكرة الجلسة: "لغة|نص" → الترجمة */
const mem = new Map();
/** الرحلات الجارية (منع الطلبات المكررة لنفس النص) */
const inflight = new Map();

/** هاش قصير لمعرّف وثيقة الترجمة (Firestore id آمن) */
function hashId(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36) + String(s.length).toString(36);
}

/** 🌍 استدعاء بوابة الترجمة العامة (بلا مفتاح) */
async function gtx(text, tl) {
  const url = 'https://translate.googleapis.com/translate_a/single'
    + '?client=gtx&sl=ar&tl=' + encodeURIComponent(tl)
    + '&dt=t&q=' + encodeURIComponent(text);
  const res = await fetch(url);
  if (!res.ok) throw new Error('gtx ' + res.status);
  const data = await res.json();
  const out = (Array.isArray(data?.[0]) ? data[0] : [])
    .map(seg => seg?.[0] || '').join('').trim();
  return out || text;
}

/**
 * 🈯 ترجمة نص واحد إلى لغة الهدف مع التخزين المؤقت الثلاثي:
 *   الذاكرة → Firestore (مشتركة بين كل اللاعبين) → البوابة
 */
async function translateText(text, lang) {
  const src = String(text ?? '');
  if (!src || lang === 'ar') return src;

  const key = lang + '|' + src;
  if (mem.has(key)) return mem.get(key);
  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    let out = src;
    try {
      await ensureAuth();
      const ref = doc(db, 'qtrans', hashId(key));
      const snap = await getDoc(ref);
      if (snap.exists() && snap.data()?.dst) {
        out = snap.data().dst;                       // 🎯 مشتركة — بلا استدعاء خارجي
      } else {
        out = await gtx(src, lang);
        // 📝 تخزين مشترك — fire & forget
        setDoc(ref, { src, lang, dst: out, at: Date.now() }).catch(() => {});
      }
    } catch {
      // 🌐 تعذّرت قاعدة البيانات؟ جرّب البوابة مباشرة قبل الاستسلام
      try { out = await gtx(src, lang); } catch { out = src; }
    }
    mem.set(key, out);
    return out;
  })();

  inflight.set(key, job);
  try { return await job; }
  finally { inflight.delete(key); }
}

/**
 * 🧩 تعريب سؤال كامل (نصه + خياراته) للغة اللاعب الحالية.
 *   الترتيب محفوظ حرفيًا — فمعرّف الإجابة الصحيحة (correct) لا يتأثر.
 *   العربية تعود كما هي فورًا (المصدر) — وأي فشل يعيد الأصل.
 */
export async function localizeQuestionForMe(q) {
  const lang = getLang();
  if (!q || lang === 'ar') return q;
  const options = Array.isArray(q.options) ? q.options : [];
  try {
    const [qText, ...optTexts] = await Promise.all([
      translateText(q.q, lang),
      ...options.map(o => translateText(o, lang))
    ]);
    if (!qText) return q;
    return {
      ...q,
      q: qText,
      options: options.map((o, i) => optTexts[i] ?? o)
    };
  } catch {
    return q;   // 🛡️ لا تعطل السؤال أبدًا — اعرض العربية
  }
}
