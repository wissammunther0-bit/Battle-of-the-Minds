// game/virtualPlayers.js
// ============================================================
// 🤖 اللاعبون الافتراضيون — v23 (طلب المستخدم)
//
//  • اللاعبون الافتراضيون يُنشؤهم المطور من لوحة الإدارة (مجموعة
//    virtualPlayers في Firebase) بدل اللاعبين العشوائيين، ولكل واحد:
//    صورة من شخصيات المتجر + علم + مستوى (1→200) + قائمة أسماء (حتى
//    200 اسم) يختار منها اسمًا عشوائيًا في كل جولة.
//  • كلما زاد المستوى زادت نسبة الذكاء → سرعة إجابة أعلى ودقة أعلى.
//  • المطابقة ليست عشوائية: اللاعب الحقيقي مستواه 5 يدخل مع افتراضي
//    مستواه 7 (+2 دائمًا، وبسقف 200 للمستوى الأخير).
//  • يمكن للاعب الافتراضي الدخول في أكثر من جولة في نفس الوقت
//    (الاختيار نسخة من القالب — لا قفل ولا حجز).
//  • طلبات الصداقة تُرفض بعد 5 دقائق تلقائيًا مع إشعار للاعب الحقيقي.
//  • سجل جولات كل لاعب افتراضي يُكتب في virtualPlayers/{id}/history
//    ويُفرَّز بالأحدث، ويُتفريغ تلقائيًا وفق مدة يحددها المطور.
// ============================================================

import { db } from '../firebase-config.js';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, collection, query, limit,
  serverTimestamp, increment
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { botSkillForLevel } from './levels.js';
import { mulberry32, hashSeed } from './bots.js';
import { getStoreItems } from '../store-catalog.js';

/** 🧮 نسبة الذكاء من الفوز/الخسارة — قيد القياس حتى 20 جولة */
export const IQ_TEST_ROUNDS = 20;

/**
 * 🧠 حساب نسبة الذكاء.
 * @returns {{ value:number|null, testing:boolean, played:number, remaining:number }}
 *   value = نسبة مئوية 0..100 أو null أثناء فترة القياس (أول 20 جولة)
 */
export function intelligenceOf(wins = 0, losses = 0) {
  const w = Math.max(0, Number(wins) || 0);
  const l = Math.max(0, Number(losses) || 0);
  const played = w + l;
  if (played < IQ_TEST_ROUNDS) {
    return { value: null, testing: true, played, remaining: IQ_TEST_ROUNDS - played };
  }
  const value = Math.round((w / Math.max(1, played)) * 100);
  return { value, testing: false, played, remaining: 0 };
}

/* ---------------- الكتالوج المخبأ ---------------- */

const state = {
  list: [],            // كل اللاعبين الافتراضيين من Firebase
  fetchedAt: 0,
  fetching: null
};

/** 📥 جلب اللاعبين الافتراضيين من Firebase (كاش 45 ثانية — يكفي لكل الجولات) */
export async function fetchVirtualPlayers(force = false) {
  const now = Date.now();
  if (!force && state.fetchedAt && (now - state.fetchedAt) < 45000) return state.list;
  if (state.fetching) return state.fetching;
  state.fetching = (async () => {
    try {
      const snap = await getDocs(query(collection(db, 'virtualPlayers'), limit(300)));
      state.list = snap.docs.map(d => ({ vpId: d.id, ...d.data() }));
      state.fetchedAt = Date.now();
    } catch (e) {
      console.warn('[virtualPlayers] fetch failed:', e?.message || e);
    } finally {
      state.fetching = null;
    }
    return state.list;
  })();
  return state.fetching;
}

/** اسم عشوائي من قائمة أسماء اللاعب الافتراضي (أو الاسم الأساسي) */
export function pickVpName(vp, seedStr) {
  const names = Array.isArray(vp?.names) ? vp.names.filter(Boolean) : [];
  if (!names.length) return vp?.name || 'لاعب';
  const rng = mulberry32(hashSeed(seedStr || String(Date.now() + Math.random())));
  return names[Math.floor(rng() * names.length)];
}

/** تحويل قالب لاعب افتراضي إلى مشارك جولة (نسخة مستقلة لكل جولة)
 *  🎚️ v24 (طلب المستخدم): شريطان لكل لاعب افتراضي —
 *    نافذة الإجابة (من أي ثانية إلى أي ثانية) + دقة الإجابة %،
 *    وشخصية/اسم عشوائيان كل جولة من قوائمه.
 */
export function vpToMatchPlayer(vp, seedStr) {
  const level = Number(vp.level) || 1;
  // 🖼️ الشخصية: عشوائية من قائمة شخصياته (إن اختار الأدمن أكثر من واحدة)
  const charList = Array.isArray(vp.characterIds) ? vp.characterIds.filter(Boolean) : [];
  let characterId = vp.characterId || null;
  if (charList.length) {
    const rng = mulberry32(hashSeed('ch|' + (seedStr || '') + '|' + vp.vpId + '|' + Math.floor(Math.random() * 1e9)));
    characterId = charList[Math.floor(rng() * charList.length)] || characterId;
  }
  const accCfg = Number(vp.accuracy);                 // 🎯 دقة الإجابة %
  const win = vp.answerWindow || {};                  // ⏱️ نافذة الإجابة بالثواني
  return {
    id: 'vp_' + vp.vpId,
    vpId: vp.vpId,
    name: pickVpName(vp, seedStr + '|' + vp.vpId),
    country: vp.country || 'SA',
    isBot: true,                 // 🤖 علامة المحرك الداخلية
    isVirtual: true,             // 🏷️ لاعب افتراضي مُدار من الإدارة
    level,
    skill: botSkillForLevel(level),
    // 🎚️ إعدادات الأدمن — تتغلب على المستوى عند وجودها
    accuracy: Number.isFinite(accCfg) && accCfg > 0 ? Math.min(1, accCfg / 100) : botSkillForLevel(level),
    answerWindow: (Number.isFinite(Number(win.min)) || Number.isFinite(Number(win.max)))
      ? { min: Number(win.min) || 0, max: Number(win.max) || 11 }
      : null,
    characterId,
    equippedCharacter: characterId,
    assistId: 'none'
  };
}

/**
 * 🎯 اختيار لاعبين افتراضيين حسب المستوى — ليس عشوائيًا:
 * الهدف = مستوى اللاعب الحقيقي + 2 (بسقف 200). نرتب القائمة حسب
 * القرب من المستوى المستهدف ونختار الأقرب أولًا (بدون تكرار).
 */
export function pickVirtualOpponents(playerLevel, count, seedStr) {
  const list = state.list;
  if (!list.length || count <= 0) return [];
  const target = Math.min(200, (Math.floor(playerLevel) || 1) + 2);
  const sorted = [...list].sort((a, b) =>
    Math.abs((Number(a.level) || 1) - target) - Math.abs((Number(b.level) || 1) - target));
  // 🎲 خلط بسيط ضمن الأقرب كي لا يكون الاختيار ميكانيكيًا
  const head = sorted.slice(0, Math.max(count * 2, 6));
  for (let i = head.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [head[i], head[j]] = [head[j], head[i]];
  }
  const chosen = [];
  const used = new Set();
  for (const vp of [...head, ...sorted]) {
    if (chosen.length >= count) break;
    if (used.has(vp.vpId)) continue;
    used.add(vp.vpId);
    chosen.push(vpToMatchPlayer(vp, seedStr || String(Date.now())));
  }
  return chosen;
}

/* ---------------- ملف اللاعب الافتراضي ---------------- */

/** هل المعرف لاعب افتراضي؟ */
export function isVirtualUid(uid) {
  return typeof uid === 'string' && uid.startsWith('vp_');
}

/** 👤 ملف لاعب افتراضي — 📊 v25: إحصائيات حقيقية فقط (لا اشتقاق من المستوى) */
export async function getVirtualProfile(uid) {
  const vpId = String(uid).slice(3);
  try {
    const snap = await getDoc(doc(db, 'virtualPlayers', vpId));
    if (!snap.exists()) return null;
    const d = snap.data();
    const level = Number(d.level) || 1;
    // 📊 v25 (طلب المستخدم): الأرقام المعروضة هي ما لُعب فعلًا فقط —
    //   كانت النسخة السابقة تشتق فوزًا/جولات وهمية من winsToReach(level)
    //   فتظهر أرقام عشوائية لا علاقة لها بالجولات الحقيقية.
    const wins = Math.max(0, Number(d.wins) || 0);
    const losses = Math.max(0, Number(d.losses) || 0);
    const tokens = Math.max(0, Number(d.vaultTokens ?? d.tokensEarned) || 0);
    const gems = Math.floor(tokens / 5);   // 💎 كل 5 علامات = 1 جوهرة (v24)
    const intel = Math.floor(gems / 100);
    return {
      uid,
      vpId,
      name: d.name || 'لاعب',
      country: d.country || 'SA',
      level,
      wins,
      losses,
      totalVictories: Math.max(0, Number(d.totalVictories) || 0),
      roundsPlayed: Math.max(0, Number(d.roundsPlayed) || 0),
      tokensEarned: tokens,
      tokens,
      gems,
      intel,
      intelligence: intelligenceOf(wins, losses).value,
      equippedCharacter: d.characterId || null,
      equippedAvatar: d.characterId || null,
      isBot: true,
      isVirtual: true
    };
  } catch (e) {
    console.warn('[virtualPlayers] profile failed:', e?.message || e);
    return null;
  }
}

/* ---------------- سجل الجولات والإحصائيات ---------------- */

/**
 * 📜 تسجيل نتيجة جولة اللاعب الافتراضي (يستدعيه جهاز المضيف عند نهاية
 * الجولة): تحديث الإحصائيات + كتابة سجل الجولة في مجلده الفرعي.
 */
export async function recordVirtualRound(vpId, { won, myScore, oppScore, opponent }) {
  if (!vpId) return;
  try {
    const ref = doc(db, 'virtualPlayers', vpId);
    // 💰 v24 — الخزنة الصغيرة: سقف يحدده الأدمن، والفائض يعود للخزان الرئيسي
    //    الجواهر مشتقة تلقائيًا (كل 5 علامات = 1 جوهرة)
    let overflow = 0;
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const d = snap.data();
        const cap = Math.max(1, Number(d.vaultCap) || 40);
        let vault = Number(d.vaultTokens ?? d.tokensEarned) || 0;
        vault = won ? vault + 1 : Math.max(0, vault - 1);
        if (vault > cap) { overflow = vault - cap; vault = cap; }
        const patch = {
          vaultTokens: vault,
          vaultGems: Math.floor(vault / 5),       // 💎 مشتقة من علامات خزنته
          tokensEarned: increment(won ? 1 : -1),
          roundsPlayed: increment(1),
          totalVictories: increment(myScore || 0)
        };
        if (won) patch.wins = increment(1);
        else patch.losses = increment(1);
        await setDoc(ref, patch, { merge: true });
      } else {
        const patch = {
          tokensEarned: increment(won ? 1 : -1),
          roundsPlayed: increment(1),
          totalVictories: increment(myScore || 0)
        };
        if (won) patch.wins = increment(1);
        else patch.losses = increment(1);
        await setDoc(ref, patch, { merge: true });
      }
    } catch {}
    if (overflow > 0) {
      // 🏦 الفائض فوق السقف يعود إلى الخزان الرئيسي (طلب المستخدم)
      try {
        const { bumpTank } = await import('./economy.js');
        await bumpTank({ tankTokens: overflow });
      } catch {}
    }
    // 📜 سجل الجولة — مرتب بالأحدث عند العرض (at)
    await setDoc(doc(collection(db, 'virtualPlayers', vpId, 'history')), {
      result: won ? 'win' : 'loss',
      myScore: myScore || 0,
      oppScore: oppScore || 0,
      opponent: opponent || null,
      at: serverTimestamp()
    });
  } catch (e) {
    console.warn('[virtualPlayers] record round failed:', e?.message || e);
  }
}

/**
 * 🧹 تفريغ سجل جولات اللاعبين الافتراضيين الأقدم من `days` (0 = الكل).
 * تُستدعى من لوحة الإدارة وفق اختيار المطور (يوم/أسبوع/شهر/3 أشهر/أبدًا).
 */
export async function purgeVirtualHistory(days) {
  try {
    const { where, deleteDoc, orderBy } = await import(
      'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js');
    const since = days > 0 ? new Date(Date.now() - days * 86400000) : new Date(8640000000000000);
    const vps = await getDocs(collection(db, 'virtualPlayers'));
    let deleted = 0;
    for (const vp of vps.docs) {
      let q = query(collection(db, 'virtualPlayers', vp.id, 'history'), limit(400));
      if (days > 0) {
        q = query(collection(db, 'virtualPlayers', vp.id, 'history'),
          where('at', '<', since), limit(400));
      } else {
        // ⏱️ "حذف الكل": نحتاج فهرس at — نستخدم ترتيبًا بسيطًا بديلًا
        q = query(collection(db, 'virtualPlayers', vp.id, 'history'), limit(400));
      }
      const snap = await getDocs(q).catch(() => null);
      if (!snap) continue;
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref).catch(() => {})));
      deleted += snap.docs.length;
    }
    return deleted;
  } catch (e) {
    console.warn('[virtualPlayers] purge failed:', e?.message || e);
    return 0;
  }
}

/** صورة الشخصية من كتالوج المتجر (للاستخدام في قوائم الإدارة) */
export function vpAvatarUrl(characterId) {
  if (!characterId) return '';
  const item = getStoreItems('characters').find(c => c.id === characterId);
  return item?.image || '';
}
