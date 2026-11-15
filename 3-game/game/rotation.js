// game/rotation.js
// ============================================================
// 🔄 ذاكرة دورة الأسئلة — v11 (طلب المستخدم)
//
// القاعدة: "السؤال الواحد لا يُعرض مجددًا حتى تُعرض جميع الأسئلة
// على اللاعب" — آلية لكل لاعب حتى لا يستطيع حفظ الأسئلة.
//
// التنفيذ:
//  • وثيقة اللاعب تحمل askedQuestionIds: معرفات الأسئلة المعروضة
//    عليه (بحد أقصى ROTATION_CAP — أقدمها يُحذف عند الامتلاء)
//  • عند بدء الجولة: تُدمج ذاكرة كل المشاركين البشر في مجموعة
//    واحدة (rotationMemory) — المضيف يختار أسئلة خارجها للجميع
//  • عند نهاية الجولة: كل لاعب يضيف أسئلة هذه الجولة إلى ذاكرته
//  • عند استعراض كل الأسئلة: تبدأ دورة جديدة تلقائيًا
// ============================================================

import { db, ensureAuth } from '../firebase-config.js';
import {
  doc, getDoc, updateDoc, arrayUnion, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

/** أقصى عدد معرفات تُحفظ في ذاكرة اللاعب (تغطي مئات الجولات) */
export const ROTATION_CAP = 500;

/**
 * 📥 تحميل ذاكرة الدورة لكل المشاركين البشر في الجولة ودمجها
 * في engine.rotationMemory — تُستدعى عند mount المحرك.
 */
export async function loadRotationMemory(engine) {
  try {
    const user = await ensureAuth();
    // 🛠️ v25 إصلاح: ذاكرتي تُقرأ من وثيقة معرّف Firebase (uid) — كانت
    //    تُقرأ من معرّف اللاعب المحلي (p_xxx) فلم تُحمّل الذاكرة أبدًا.
    const snap = await getDoc(doc(db, 'players', user.uid));
    const ids = snap.exists() ? (snap.data().askedQuestionIds || []) : [];
    ids.forEach(id => engine.rotationMemory.add(id));
    // توافق: أضف ذاكرة أي وثيقة تطابق معرفات المتحكمين البشر (إن وُجدت)
    const humanIds = new Set();
    engine.characters.forEach(c => (c.controllers || []).forEach(p => {
      if (!p.isBot && p.id && p.id !== user.uid) humanIds.add(p.id);
    }));
    await Promise.all([...humanIds].map(async (uid) => {
      try {
        const s2 = await getDoc(doc(db, 'players', uid));
        (s2.exists() ? (s2.data().askedQuestionIds || []) : []).forEach(id => engine.rotationMemory.add(id));
      } catch { /* لاعب ناقص — تجاهل */ }
    }));
    console.info('[rotation] 🔄 ذاكرة الدورة:', engine.rotationMemory.size, 'سؤالًا معروضًا');
  } catch (e) {
    console.warn('[rotation] فشل تحميل الذاكرة:', e?.message || e);
  }
}

/**
 * 💾 حفظ أسئلة الجولة في ذاكرة اللاعب (تُستدعى من شاشة النهاية).
 * @param {string[]} servedIds معرفات أسئلة الجولة
 */
export async function saveRotationMemory(servedIds) {
  const list = (servedIds || []).filter(Boolean);
  console.info('[rotation] 💾 حفظ الذاكرة:', list.length, 'سؤالًا من هذه الجولة');
  if (!list.length) return;
  try {
    // 🛠️ v25 إصلاح: المعرّف من نتيجة ensureAuth مباشرة (نفس نمط
    //    firestore-sync) — كان يُقرأ من auth.currentUser وهو قد يكون
    //    فارغًا لحظيًا فتفشل الكتابة ولا تُحفظ ذاكرة الدورة أبدًا.
    const user = await ensureAuth();
    const uid = user?.uid || '';
    if (!uid) return;
    await updateDoc(doc(db, 'players', uid), {
      askedQuestionIds: arrayUnion(...servedIds),
      updatedAt: serverTimestamp()
    });
  } catch (e) {
    console.warn('[rotation] فشل حفظ الذاكرة:', e?.message || e);
  }
}
