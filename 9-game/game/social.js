// game/social.js
// ============================================================
// 👥 نظام الأصدقاء الحقيقي — Firestore
//
//  - البحث عن اللاعبين في مجموعة players (بالاسم المُطبَّع)
//  - طلبات صداقة حقيقية تصل للاعب الآخر على أجهزته لحظيًا
//  - 🤖 طلبات الصداقة للبوتات تُرفض تلقائيًا بعد دقيقتين
//    (autoRejectAt + ماسح دوري على جهاز المُرسل — بلا خادم)
//    فيبقى إحساس أن الطرف الآخر لاعب حقيقي رفض الإضافة.
// ============================================================

import { ensureAuth, db } from '../firebase-config.js';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
  collection, query, where, limit, getDocs, onSnapshot, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { getPlayer } from '../auth.js';
import { isPlayerBlocked } from '../firestore-sync.js';
import { levelFromWins } from './levels.js';
import { isBotUid, getBotProfile } from './bots.js';
import { isVirtualUid, getVirtualProfile } from './virtualPlayers.js';

/** 🪪 تسجيل/تحديث بطاقتي في دليل اللاعبين (للبحث والملفات والمتصدرين) */
export async function registerMe(player) {
  try {
    const u = await ensureAuth();
    const ref = doc(db, 'players', u.uid);
    const snap = await getDoc(ref);

    // 🚫 v26: لاعب محذوف من الإدارة؟ لا تُعِد إنشاء بطاقته أبدًا
    if (!snap.exists() && await isPlayerBlocked(u.uid)) {
      console.warn('[social] player blocked (deleted) — registerMe cancelled');
      return;
    }

    const base = {
      uid: u.uid,
      name: player.name || 'لاعب',
      nameLower: (player.name || 'لاعب').trim().toLowerCase(),
      country: player.country || 'SA',
      wins: player.wins || 0,
      losses: player.losses || 0,
      totalVictories: player.totalVictories || 0,
      level: levelFromWins(player.wins || 0),
      equippedCharacter: player.equippedCharacter || null,
      equippedAvatar: player.equippedAvatar || null,
      lastSeen: serverTimestamp()
    };
    if (!snap.exists()) {
      await setDoc(ref, { ...base, createdAt: serverTimestamp() });
    } else {
      await setDoc(ref, base, { merge: true });
    }
  } catch (e) {
    console.warn('[social] registerMe:', e?.message || e);
  }
}

/** 🔍 البحث عن لاعبين حقيقيين بالاسم */
export async function searchPlayers(text) {
  const q = (text || '').trim().toLowerCase();
  if (q.length < 2) return [];
  try {
    const me = getPlayer();
    const snap = await getDocs(query(
      collection(db, 'players'),
      where('nameLower', '==', q),
      limit(20)
    ));
    return snap.docs
      .map(d => ({ uid: d.id, ...d.data() }))
      .filter(p => p.uid !== me?.id);
  } catch (e) {
    console.warn('[social] search:', e?.message || e);
    return [];
  }
}

/** 👤 جلب ملف لاعب (حقيقي من Firestore أو لاعب افتراضي أو بوت مولّد حتميًا) */
export async function getPlayerProfile(uid) {
  if (isVirtualUid(uid)) {
    const vp = await getVirtualProfile(uid).catch(() => null);
    if (vp) return vp;
  }
  if (isBotUid(uid)) return getBotProfile(uid);
  try {
    const snap = await getDoc(doc(db, 'players', uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      uid,
      name: d.name || 'لاعب',
      country: d.country || 'SA',
      wins: d.wins || 0,
      losses: d.losses || 0,
      totalVictories: d.totalVictories || 0,
      level: d.level || levelFromWins(d.wins || 0),
      equippedCharacter: d.equippedCharacter || null,
      equippedAvatar: d.equippedAvatar || null,
      isBot: false
    };
  } catch { return null; }
}

/** ➕ إرسال طلب صداقة (لإنسان أو بوت — البوت يرفض بعد دقيقتين) */
export async function sendFriendRequest(target) {
  try {
    const u = await ensureAuth();
    const me = getPlayer();
    if (!target || !target.uid) return { ok: false, msg: 'هدف غير صالح' };
    if (target.uid === u.uid) return { ok: false, msg: 'لا يمكنك إضافة نفسك' };
    if (await isFriend(u.uid, target.uid)) return { ok: false, msg: 'صديق بالفعل' };

    // لا تكرار: طلب معلق سابق لنفس الهدف
    const dup = await getDocs(query(
      collection(db, 'friendRequests'),
      where('from', '==', u.uid),
      where('to', '==', target.uid),
      where('status', '==', 'pending'),
      limit(1)
    ));
    if (!dup.empty) return { ok: false, msg: 'الطلب مرسل بالفعل' };

    const isBot = !!target.isBot || isBotUid(target.uid);
    await setDoc(doc(collection(db, 'friendRequests')), {
      from: u.uid,
      fromName: me?.name || 'لاعب',
      fromCountry: me?.country || 'SA',
      fromLevel: levelFromWins(me?.wins || 0),
      to: target.uid,
      toName: target.name || 'لاعب',
      toCountry: target.country || 'SA',
      toIsBot: isBot,
      // 🤖 v23 (طلب المستخدم): رفض تلقائي بعد 5 دقائق مع إشعار واضح
      autoRejectAt: isBot ? (Date.now() + 300000) : null,
      status: 'pending',
      createdAt: serverTimestamp()
    });
    return { ok: true, msg: 'تم إرسال طلب الصداقة ✈️' };
  } catch (e) {
    return { ok: false, msg: e?.message || 'فشل إرسال الطلب' };
  }
}

async function isFriend(myUid, otherUid) {
  try {
    const s = await getDoc(doc(db, 'players', myUid, 'friends', otherUid));
    return s.exists();
  } catch { return false; }
}

/** 🤖 الماسح: رفض طلبات البوتات/الافتراضيين المنتهية (5 دقائق) + إشعار المُرسل */
export async function sweepBotFriendRequests() {
  try {
    const u = await ensureAuth();
    const snap = await getDocs(query(
      collection(db, 'friendRequests'),
      where('from', '==', u.uid),
      where('status', '==', 'pending'),
      where('toIsBot', '==', true)
    ));
    const now = Date.now();
    const expired = snap.docs.filter(d => (d.data().autoRejectAt || 0) <= now);
    if (!expired.length) return;
    await Promise.all(expired.map(d => updateDoc(d.ref, {
      status: 'rejected',
      respondedAt: serverTimestamp()
    }).catch(() => {})));
    // 🔔 إشعار واضح للاعب الحقيقي (طلب المستخدم v23)
    try {
      const { notify } = await import('../ui/helpers.js');
      const { t } = await import('../i18n.js');
      notify('🚫 ' + t('friendRejectedTitle', 'تم رفض طلب الصداقة'), 'warn');
    } catch {}
  } catch {}
}

/** 📩 الاستماع اللحظي للطلبات الواردة — يعيد قائمة الطلبات عند كل تغيير */
export function listenIncomingRequests(cb) {
  let unsub = null;
  ensureAuth().then(u => {
    unsub = onSnapshot(query(
      collection(db, 'friendRequests'),
      where('to', '==', u.uid),
      where('status', '==', 'pending')
    ), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), () => {});
  }).catch(() => {});
  return () => { try { unsub && unsub(); } catch {} };
}

/** ✈️ طلباتي المرسلة (الأحدث أولًا — الترتيب محلي بلا فهارس إضافية) */
export async function getSentRequests() {
  try {
    const u = await ensureAuth();
    const snap = await getDocs(query(
      collection(db, 'friendRequests'),
      where('from', '==', u.uid),
      limit(30)
    ));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  } catch { return []; }
}

/** ✅ قبول طلب صداقة — يضيف الطرفين لقائمة بعضهما
 *
 *  🔁 v24 (طلب المستخدم): عند القبول يُعالج تلقائيًا أي طلب معلّق
 *     أرسلته أنا لنفس الشخص (المشكلة: طلبي المرسل يبقى معلقًا
 *     رغم أننا صديقان) — يُوسَم matched فيختفي من الطلبات المرسلة.
 */
export async function acceptFriendRequest(req) {
  try {
    const u = await ensureAuth();
    const me = getPlayer();
    const batch = writeBatch(db);
    batch.update(doc(db, 'friendRequests', req.id), {
      status: 'accepted',
      respondedAt: serverTimestamp()
    });
    batch.set(doc(db, 'players', u.uid, 'friends', req.from), {
      uid: req.from,
      name: req.fromName || 'لاعب',
      country: req.fromCountry || 'SA',
      level: req.fromLevel || 1,
      since: serverTimestamp()
    });
    batch.set(doc(db, 'players', req.from, 'friends', u.uid), {
      uid: u.uid,
      name: me?.name || 'لاعب',
      country: me?.country || 'SA',
      level: levelFromWins(me?.wins || 0),
      since: serverTimestamp()
    });
    await batch.commit();

    // 🔁 طلب معلّق مني لنفس الشخص؟ صرنا صديقين — أغلق الطلب تلقائيًا
    try {
      const dup = await getDocs(query(
        collection(db, 'friendRequests'),
        where('from', '==', u.uid),
        where('to', '==', req.from),
        where('status', '==', 'pending'),
        limit(10)
      ));
      await Promise.all(dup.docs.map(d => updateDoc(d.ref, {
        status: 'matched',
        respondedAt: serverTimestamp()
      }).catch(() => {})));
    } catch {}

    return { ok: true, msg: 'تمت إضافة الصديق ✅' };
  } catch (e) {
    return { ok: false, msg: e?.message || 'فشل القبول' };
  }
}

/** ❌ رفض طلب وارد */
export async function rejectFriendRequest(reqId) {
  try {
    await updateDoc(doc(db, 'friendRequests', reqId), {
      status: 'rejected',
      respondedAt: serverTimestamp()
    });
    return { ok: true, msg: 'تم الرفض' };
  } catch (e) {
    return { ok: false, msg: e?.message || 'فشل الرفض' };
  }
}

/** ↩️ إلغاء طلب مرسل */
export async function cancelSentRequest(reqId) {
  try {
    await updateDoc(doc(db, 'friendRequests', reqId), {
      status: 'cancelled',
      respondedAt: serverTimestamp()
    });
    return { ok: true, msg: 'تم إلغاء الطلب' };
  } catch (e) {
    return { ok: false, msg: e?.message || 'فشل الإلغاء' };
  }
}

/** 👥 قائمة أصدقائي */
export async function getFriendsList() {
  try {
    const u = await ensureAuth();
    const snap = await getDocs(collection(db, 'players', u.uid, 'friends'));
    return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  } catch { return []; }
}

/** 🗑️ إزالة صديق — من قائمتي ومن قائمته (أفضل محاولة)
 *  🧹 v24: يُغلق أيضًا أي طلبات معلّقة بين الطرفين حتى لا تعود للظهور */
export async function removeFriend(fUid) {
  try {
    const u = await ensureAuth();
    await deleteDoc(doc(db, 'players', u.uid, 'friends', fUid));
    deleteDoc(doc(db, 'players', fUid, 'friends', u.uid)).catch(() => {});
    // 🧹 تنظيف أي طلبات معلّقة بين الطرفين (منّي إليه أو منه إليّ)
    try {
      const [mine, theirs] = await Promise.all([
        getDocs(query(collection(db, 'friendRequests'),
          where('from', '==', u.uid), where('to', '==', fUid),
          where('status', '==', 'pending'), limit(10))),
        getDocs(query(collection(db, 'friendRequests'),
          where('from', '==', fUid), where('to', '==', u.uid),
          where('status', '==', 'pending'), limit(10)))
      ]);
      await Promise.all([...mine.docs, ...theirs.docs].map(d =>
        updateDoc(d.ref, { status: 'cancelled', respondedAt: serverTimestamp() })
          .catch(() => {})));
    } catch {}
    return { ok: true, msg: 'تمت إزالة الصديق' };
  } catch (e) {
    return { ok: false, msg: e?.message || 'فشل الإزالة' };
  }
}

/** 🔎 حالة العلاقة الكاملة مع لاعب
 *  none | pending_sent (أرسلت أنا) | pending_received (أرسل لي!) | friends
 *  عند pending_received يعيد أيضًا وثيقة الطلب لتُستخدم في القبول مباشرة */
export async function friendshipStatusEx(uid) {
  try {
    const u = await ensureAuth();
    if (await isFriend(u.uid, uid)) return { status: 'friends', request: null };

    // ✈️ طلب معلق أرسلته أنا
    const sent = await getDocs(query(
      collection(db, 'friendRequests'),
      where('from', '==', u.uid),
      where('to', '==', uid),
      where('status', '==', 'pending'),
      limit(1)
    ));
    if (!sent.empty) return { status: 'pending_sent', request: null };

    // 📩 طلب معلق أرسله هو لي — هو الذي يجب أن يظهر زر "قبول"!
    const inc = await getDocs(query(
      collection(db, 'friendRequests'),
      where('from', '==', uid),
      where('to', '==', u.uid),
      where('status', '==', 'pending'),
      limit(1)
    ));
    if (!inc.empty) {
      return { status: 'pending_received', request: { id: inc.docs[0].id, ...inc.docs[0].data() } };
    }
    return { status: 'none', request: null };
  } catch { return { status: 'none', request: null }; }
}

/** 🔎 حالة العلاقة المختصرة (توافق مع الاستدعاءات القديمة) */
export async function friendshipStatus(uid) {
  return (await friendshipStatusEx(uid)).status;
}

/** 📩 جلب الطلبات الواردة مرة واحدة — احتياط إذا تأخر المستمع اللحظي */
export async function getIncomingRequestsOnce() {
  try {
    const u = await ensureAuth();
    const snap = await getDocs(query(
      collection(db, 'friendRequests'),
      where('to', '==', u.uid),
      where('status', '==', 'pending')
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
}
