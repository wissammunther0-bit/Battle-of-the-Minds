// game/presence.js
// ============================================================
// 🚪 حضور الجولات — قاعدة الانسحاب النهائي (v8)
//
//  1) claimActiveRound: تسجيل الجولة الحالية (محليًا + Firestore)
//     لكشف وجود جولة قائمة عند العودة.
//  2) markLeftRound: تسجيل لحظة المغادرة (للإحصاء فقط).
//  3) resumeOrForfeit: ❌ لا استئناف إطلاقًا — من انسحب من جولة
//     بدأت خسرها نهائيًا ولا يمكنه العودة إليها أبدًا (بناءً على
//     طلب صريح): أي جولة قائمة عند العودة تُحتسب انسحابًا وخسارة
//     رسمية تُسجل في السجل والتقدم، ويفوز الخصم بالجولة كاملة.
//  4) cleanupStaleWaitingRooms: حذف غرف الانتظار اليتيمة القديمة.
// ============================================================

import { ensureAuth, db } from '../firebase-config.js';
import {
  doc, getDoc, setDoc, deleteDoc, updateDoc, serverTimestamp,
  collection, query, where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { getPlayer, updatePlayer } from '../auth.js';
import { isPlayerBlocked } from '../firestore-sync.js';
import { serverNow } from './serverTime.js';
import { ROOM_TTL_MS } from './config.js';
import { saveMatchResult } from './history.js';

const CLAIM_KEY = 'bqa_active_round';

function readClaim() {
  try { return JSON.parse(localStorage.getItem(CLAIM_KEY) || 'null'); }
  catch { return null; }
}

function writeClaim(claim) {
  try {
    if (claim) localStorage.setItem(CLAIM_KEY, JSON.stringify(claim));
    else localStorage.removeItem(CLAIM_KEY);
  } catch {}
}

/** 📌 تسجيل الجولة الحالية (عند بدء المباراة) */
export async function claimActiveRound(roomId) {
  if (!roomId) return;
  writeClaim({ roomId, at: Date.now(), leftAt: null });
  try {
    const u = await ensureAuth();
    // 🚫 v26: لاعب محذوف؟ لا تُنشئ ملفه من جديد (شبح بعد الحذف)
    if (await isPlayerBlocked(u.uid)) return;
    await setDoc(doc(db, 'players', u.uid), {
      activeRoundId: roomId,
      activeRoundAt: serverTimestamp()
    }, { merge: true });
  } catch {}
}

/** 🚪 تسجيل لحظة مغادرة الجولة (للإحصاء — لا نافذة عودة بعد الآن) */
export async function markLeftRound(roomId) {
  const claim = readClaim();
  if (claim && (!roomId || claim.roomId === roomId)) {
    writeClaim({ ...claim, leftAt: Date.now() });
  }
  try {
    const u = await ensureAuth();
    // 🚫 v26: حاجز الحذف — الكتابة merge تُنشئ وثيقة إن لم تكن موجودة
    if (await isPlayerBlocked(u.uid)) return;
    await setDoc(doc(db, 'players', u.uid), {
      leftRoundAt: serverTimestamp()
    }, { merge: true });
  } catch {}
}

/** 🧹 مسح التسجيل — عند نهاية الجولة رسميًا */
export async function clearActiveRound(roomId = null) {
  const claim = readClaim();
  if (!claim || !roomId || claim.roomId === roomId) writeClaim(null);
  try {
    const u = await ensureAuth();
    // 🚫 v26: حاجز الحذف — لا شبح بعد الحذف
    if (await isPlayerBlocked(u.uid)) return;
    await setDoc(doc(db, 'players', u.uid), {
      activeRoundId: null
    }, { merge: true });
  } catch {}
}

async function fetchRoundDoc(roundId) {
  if (!roundId) return null;
  try {
    const snap = await getDoc(doc(db, 'gameStates', roundId));
    return snap.exists() ? { id: roundId, ...snap.data() } : null;
  } catch { return null; }
}

function myCharFromDoc(round, myUid) {
  return (round.characters || []).find(c =>
    (c.controllers || []).some(p => p.id === myUid));
}

function oppCharFromDoc(round, myUid) {
  return (round.characters || []).find(c =>
    !(c.controllers || []).some(p => p.id === myUid));
}

/**
 * 🔄 عند العودة (فتح التطبيق أو الضغط على "ابدأ جولة"):
 *  - none      → لا جولة قائمة
 *  - forfeited → ⚠️ جولة قائمة موجودة = انسحاب نهائي: خسارة رسمية
 *    فورية (بناءً على طلب المستخدم: من انسحب لا يعود للجولة أبدًا
 *    ويُعتبر خاسرًا) — الخصم يفوز بالجولة كاملة.
 */
export async function resumeOrForfeit() {
  const me = getPlayer();
  if (!me) return { action: 'none' };

  let claim = readClaim();
  let roundId = claim?.roomId || null;

  // 🔁 مصدر ثانٍ يعمل عبر الأجهزة: حقل activeRoundId في ملف اللاعب
  if (!roundId) {
    try {
      const u = await ensureAuth();
      const ps = await getDoc(doc(db, 'players', u.uid));
      roundId = ps.exists() ? (ps.data().activeRoundId || null) : null;
      if (roundId) claim = { roomId: roundId, at: Date.now(), leftAt: null };
    } catch {}
  }
  if (!roundId) return { action: 'none' };

  const round = await fetchRoundDoc(roundId);
  const isActive = round && (round.status === 'playing' || round.status === 'intro');
  if (!isActive) {
    // انتهت أثناء الغياب أو حُذفت — امسح التسجيل فقط
    await clearActiveRound(roundId);
    return { action: 'none' };
  }

  // ⚰️ لا عودة للجولات — الانسحاب نهائي: خسارة رسمية فورية
  await forfeitMyRound(round, me.id);
  return { action: 'forfeited', round };
}

/** 🏳️ خسارتي بالانسحاب: تعليم الجولة + تسجيل الخسارة في السجل والتقدم */
export async function forfeitMyRound(round, myUid) {
  const myChar = myCharFromDoc(round, myUid);
  const opp = oppCharFromDoc(round, myUid);
  try {
    await updateDoc(doc(db, 'gameStates', round.id), {
      status: 'ended',
      winnerCharId: opp?.id || null,
      forfeitBy: myUid,
      lastResult: { over: true, reason: 'forfeit', entries: {}, at: serverNow() },
      updatedAt: serverTimestamp()
    });
  } catch {}
  await clearActiveRound(round.id);
  const player = getPlayer();
  updatePlayer({ losses: (player.losses || 0) + 1 });
  await saveMatchResult({
    roundId: round.id,
    result: 'loss',
    myScore: myChar ? (round.wins?.[myChar.id] || 0) : 0,
    oppScore: opp ? (round.wins?.[opp.id] || 0) : 0,
    reason: 'forfeit',
    opponent: {
      uid: opp?.controllers?.[0]?.id || null,
      name: opp?.controllers?.[0]?.name || 'الخصم',
      country: opp?.controllers?.[0]?.country || '',
      isBot: !!opp?.controllers?.[0]?.isBot,
      level: opp?.controllers?.[0]?.level || null
    }
  });
}

/** 🧹 تنظيف غرف الانتظار اليتيمة القديمة (تخلفت عن تحديث الصفحة) */
export async function cleanupStaleWaitingRooms() {
  try {
    const me = getPlayer();
    if (!me) return;
    const snap = await getDocs(query(
      collection(db, 'matchmaking'),
      where('hostId', '==', me.id),
      where('status', '==', 'waiting')
    ));
    const now = Date.now();
    snap.docs.forEach(d => {
      const created = d.data().createdAt?.toMillis?.() || 0;
      if (!created || now - created > ROOM_TTL_MS) {
        deleteDoc(d.ref).catch(() => {});
      }
    });
  } catch {}
}
