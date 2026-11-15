// game/history.js
// ============================================================
// 📜 سجل الجولات — أسبوع كامل من المباريات لكل لاعب
//
//  كل جهاز يكتب سجلّه الخاص (كاتب واحد لكل مستند — بلا تصادم)
//  في players/{uid}/history/{roundId} — معرف الجولة يجعل الكتابة
//  المتكررة آمنة (تُستبدل بنفس المحتوى).
// ============================================================

import { ensureAuth, db } from '../firebase-config.js';
import {
  doc, setDoc, getDocs, collection, query, where, orderBy, limit,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

/**
 * 💾 حفظ نتيجة مباراة في سجلّي
 * @param {object} entry { roundId, result:'win'|'loss', myScore, oppScore,
 *                         reason, opponent:{uid,name,country,isBot,level} }
 */
export async function saveMatchResult(entry) {
  try {
    const u = await ensureAuth();
    await setDoc(doc(db, 'players', u.uid, 'history', entry.roundId), {
      roundId: entry.roundId,
      result: entry.result,
      myScore: entry.myScore || 0,
      oppScore: entry.oppScore || 0,
      reason: entry.reason || null,
      opponent: entry.opponent || null,
      at: serverTimestamp()
    });
  } catch (e) {
    console.warn('[history] save:', e?.message || e);
  }
}

/** 📜 سجل آخر `days` يومًا (الأحدث أولًا) */
export async function getWeekHistory(days = 7) {
  try {
    const u = await ensureAuth();
    const since = new Date(Date.now() - days * 86400000);
    const snap = await getDocs(query(
      collection(db, 'players', u.uid, 'history'),
      where('at', '>=', since),
      orderBy('at', 'desc'),
      limit(60)
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[history] load (fallback بلا فلتر زمني):', e?.message || e);
    // احتياط: بلا فلتر زمني (إن لم تكن الفهارس جاهزة بعد)
    try {
      const u = await ensureAuth();
      const snap = await getDocs(query(
        collection(db, 'players', u.uid, 'history'),
        limit(60)
      ));
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.at?.toMillis?.() || 0) - (a.at?.toMillis?.() || 0));
    } catch { return []; }
  }
}
