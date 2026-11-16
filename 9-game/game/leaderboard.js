// game/leaderboard.js
// ============================================================
// 🏆 قائمة أعلى 100 لاعب — v23 حقيقية 100% (طلب المستخدم)
//
//  - 🚫 لا بوتات مزروعة ولا قوائم عشوائية — الحقيقيون (مجموعة
//    players) واللاعبون الافتراضيون (مجموعة virtualPlayers) معًا،
//    مرتبين بالمستوى ثم الانتصارات — ويعرض كل لاعب اسمه وصورته
//    ومستواه ونسبة ذكائه وعدد انتصاراته وخسائره.
//  - التحديث لحظي حسب الجولات: مستويات وإحصائيات الافتراضيين
//    تتحدث من جهاز المضيف عند كل نهاية جولة، واللاعبون الحقيقيون
//    يتحدثون مع مزامنة ملفاتهم.
// ============================================================

import { db } from '../firebase-config.js';
import {
  collection, getDocs, query, orderBy, limit
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { getPlayer } from '../auth.js';
import { levelFromWins } from './levels.js';
import { intelligenceOf } from './virtualPlayers.js';

/** 🧠 نسبة ذكاء معروضة (null أثناء فترة قياس أول 20 جولة) */
function iqEntry(wins, losses) {
  const iq = intelligenceOf(wins, losses);
  return iq.testing ? null : iq.value;
}

/**
 * 🏆 جلب قائمة أفضل 100 (حقيقيون + افتراضيون) + ترتيبي أنا
 * @returns {Promise<{entries: Array, myRank: number|null}>}
 */
export async function fetchLeaderboard() {
  const entries = [];

  // 👥 اللاعبون الحقيقيون
  try {
    const snap = await getDocs(query(
      collection(db, 'players'),
      orderBy('level', 'desc'),
      limit(150)
    ));
    snap.docs.forEach(d => {
      const p = d.data();
      if (!p?.name) return;
      const wins = p.wins || 0;
      const losses = p.losses || 0;
      entries.push({
        uid: d.id,
        name: p.name,
        country: p.country || 'SA',
        level: p.level || levelFromWins(wins),
        wins,
        losses,
        totalVictories: p.totalVictories || 0,
        intelligence: iqEntry(wins, losses),
        isVirtual: false
      });
    });
  } catch (e) {
    console.warn('[leaderboard] فشل جلب اللاعبين الحقيقيين:', e?.message || e);
  }

  // 🤖 اللاعبون الافتراضيون (من إدارة اللعبة — حقيقيون في القائمة)
  try {
    const snap = await getDocs(query(
      collection(db, 'virtualPlayers'),
      orderBy('level', 'desc'),
      limit(150)
    ));
    snap.docs.forEach(d => {
      const p = d.data();
      if (!p?.name) return;
      const level = Number(p.level) || 1;
      const wins = Number(p.wins) || 0;
      const losses = Number(p.losses) || 0;
      entries.push({
        uid: 'vp_' + d.id,
        name: p.name,
        country: p.country || 'SA',
        level,
        wins,
        losses,
        totalVictories: p.totalVictories || 0,
        intelligence: iqEntry(wins, losses),
        isVirtual: true
      });
    });
  } catch (e) {
    console.warn('[leaderboard] فشل جلب اللاعبين الافتراضيين:', e?.message || e);
  }

  entries.sort((a, b) =>
    (b.level - a.level) ||
    (b.wins - a.wins) ||
    (a.name || '').localeCompare(b.name || ''));

  const merged = entries.slice(0, 100);

  const me = getPlayer();
  const myIdx = merged.findIndex(x => x.uid === me?.id);
  return { entries: merged, myRank: myIdx >= 0 ? myIdx + 1 : null };
}
