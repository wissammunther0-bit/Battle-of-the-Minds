// game/awards.js
// ============================================================
// 🧠 جوائز الذكاء — v11 (طلب المستخدم)
//
// متجر ظاهري في الصفحة الرئيسية: الجوائز (كارت رصيد، بطاقات
// جوجل بلاي…) يضيفها المطور من صفحة الإدارة في مجموعة awards:
//   { name, image(dataURL), price, conditions:[{type,value}],
//     order, active, createdAt }
//
// الشروط (كل جائزة منفصلة — لا يمكن ركوب شروط جائزة لجائزة أخرى):
//   avatarsOwned — عدد الأفاتار المشتراة (عدّاد قابل للتصفير)
//   toolUses     — مرات استخدام أدوات المساعدة
//   wins         — جولات فاز بها
//   roundsPlayed — جولات لعبها
//   level        — المستوى الحالي
//
// عند التبادل:
//   • يُخصم الثمن من جوائز الذكاء (تحقق مزدوج محليًا ثم معاملة)
//   • 🧹 تُصفَّر كل عدّادات الشروط (طلب المستخدم)
//   • 📨 يُنشأ طلب تبادل في awardClaims مع لقطة ملف اللاعب —
//     يراجعه المطور من صفحة الإدارة ويرسل الهدية بالبريد خلال 72 ساعة
// ============================================================

import { ensureAuth, db } from '../firebase-config.js';
import {
  doc, collection, getDocs, query, where, orderBy, limit,
  addDoc, updateDoc, runTransaction, serverTimestamp, Timestamp, increment,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { getPlayer, updatePlayer } from '../auth.js';
import { syncPlayerToFirestore } from '../firestore-sync.js';
import { evaluateConditions, isConditionMet, conditionLabel, resetAwardCounters } from '../store.js';
import { levelFromWins } from './levels.js';

let _awardsCache = null;
let _awardsUnsub = null;

/** 📥 تحميل الجوائز النشطة من قاعدة البيانات
 *  🔴 v32 — صارت لحظية: جائزة يضيفها المطور أو يعدل سعرها/شروطها/صورتها
 *  من لوحة الإدارة تصل للاعبين المفتوحين فورًا بلا تحديث الصفحة
 *  (كانت تُقرأ مرة واحدة وتُخزَّن، فالتعديلات لا تظهر إلا بعد إعادة
 *  الفتح — شكوى المستخدم «تحديث التغييرات غير ملحوظ»). */
export async function loadAwards(force = false) {
  if (_awardsCache && !force) return _awardsCache;
  try {
    await ensureAuth();
    const activeQ = query(collection(db, 'awards'), where('active', '==', true), limit(50));
    const snap = await getDocs(activeQ);
    const awards = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    _awardsCache = awards;
    // 🔴 v32 — مستمع لحظي واحد يبدأ مع أول تحميل: أي تغيير يحدّث الكاش
    //    ويطلق awards-changed لإعادة رسم متجر الجوائز إن كان ظاهرًا
    if (!_awardsUnsub) {
      _awardsUnsub = onSnapshot(activeQ, (s) => {
        _awardsCache = s.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.order || 0) - (b.order || 0));
        try { document.dispatchEvent(new CustomEvent('awards-changed')); } catch {}
      }, (e) => console.warn('[awards] live listener:', e?.message || e));
    }
    return awards;
  } catch (e) {
    console.warn('[awards] load failed:', e?.message || e);
    return _awardsCache || [];
  }
}

/** تقييم شروط جائزة على ملف اللاعب الحالي */
export function evaluateAwardConditions(award) {
  const conds = (award.conditions || []).map(c => ({
    ...c,
    label: conditionLabel(c),
    met: isConditionMet(c)
  }));
  const conditionsMet = evaluateConditions(award.conditions || [], 'all');
  const player = getPlayer() || {};
  const intel = player.intel || 0;
  const price = Number(award.price) || 0;
  return {
    conds,
    conditionsMet,
    intel,
    price,
    enoughIntel: intel >= price,
    claimable: conditionsMet && intel >= price
  };
}

/**
 * 📨 استلام الجائزة: خصم الثمن + تصفير العدّادات + إنشاء طلب التبادل
 * @returns {Promise<{ok:boolean, msg?:string, claimId?:string}>}
 */
export async function claimAward(award, email) {
  const player = getPlayer();
  if (!player) return { ok: false, msg: 'لا يوجد لاعب' };

  const ev = evaluateAwardConditions(award);
  if (!ev.claimable) {
    return { ok: false, msg: 'استوفِ جميع الشروط وتأكد من رصيد جوائز الذكاء أولًا' };
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
    return { ok: false, msg: 'أدخل بريدًا إلكترونيًا صحيحًا لاستلام الجائزة' };
  }

  try {
    await ensureAuth();

    // 💰 خصم الثمن + 🧹 تصفير العدّادات — معاملة على وثيقة اللاعب
    //    (تمنع التبادل المزدوج حتى لو ضُغط مرتين بسرعة)
    const ref = doc(db, 'players', player.id);
    const price = ev.price;
    const newIntel = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('player-doc-missing');
      const balance = Number(snap.data().intel) || 0;
      if (balance < price) throw new Error('insufficient-intel');
      tx.update(ref, {
        intel: balance - price,
        awardCounters: { toolUses: 0, wins: 0, roundsPlayed: 0, avatarsBought: 0 }
      });
      return balance - price;
    });

    // 🖥️ انعكاس محلي فوري
    updatePlayer({ intel: newIntel });
    resetAwardCounters();

    // 🧠 v24 — جوائز الذكاء المستردة إلى الخزان + عدّاد استلام الجائزة
    //    (استبدل اللاعب جوائزه بهدية حقيقية → تعود للخزنة تلقائيًا)
    try {
      const economy = await import('./economy.js');
      economy.tankIntelRecovered(price);
      await updateDoc(doc(db, 'awards', award.id), { claims: increment(Number(price) || 0) });
    } catch {}

    // 📨 طلب التبادل — يظهر في صفحة الإدارة للمراجعة (72 ساعة)
    const fresh = getPlayer();
    const claimRef = await addDoc(collection(db, 'awardClaims'), {
      uid: player.id,
      name: fresh.name || '',
      email: String(email).trim(),
      awardId: award.id,
      awardName: award.name || '',
      awardPrice: price,
      awardImage: award.image || '',
      playerSnapshot: {
        name: fresh.name || '',
        level: levelFromWins(fresh.wins || 0),
        wins: fresh.wins || 0,
        losses: fresh.losses || 0,
        roundsPlayed: fresh.roundsPlayed || 0,
        correctAnswers: fresh.correctAnswers || 0,
        wrongAnswers: fresh.wrongAnswers || 0,
        tokens: fresh.tokens || 0,
        gems: fresh.gems || 0,
        intel: newIntel,
        ownedAvatars: (fresh.ownedAvatars || []).length
      },
      status: 'pending',
      createdAt: serverTimestamp()
    });

    return { ok: true, claimId: claimRef.id, msg: 'تم إرسال طلب التبادل بنجاح!' };
  } catch (e) {
    const m = e?.message || '';
    if (m.includes('insufficient-intel')) return { ok: false, msg: 'رصيد جوائز الذكاء غير كافٍ' };
    console.warn('[awards] claim failed:', e);
    return { ok: false, msg: 'تعذر إرسال الطلب — حاول مجددًا' };
  }
}

/* ==========================================================
 * 🏆 دورة استلام الجائزة — v19 (طلب المستخدم)
 *  • الضغط على «استلام الجائزة» لا يتم إلا بعد مشاهدة إعلان
 *  • بعد المشاهدة يُرسل الطلب إلى صفحة المطور (awardClaims)
 *  • يظهر زر «استلام الجائزة» الشفاف التفاعلي ويظهر أسفله
 *    عدّاد 96 ساعة — وعند انتهائه يتفعل الزر
 *  • الضغط على الزر المفعّل: شاشة تفاعلية «مبروك حصولك على الجائزة»
 *    ثم الانتقال إلى نافذة حقيبتي ويُجد الجائزة هناك
 *  • الضغط على الجائزة داخل الحقيبة يعرض بيانات استلامها
 *  • تختفي من الحقيبة بعد 30 يومًا وتعود بطاقة الجائزة في
 *    متجر الجوائز بحالتها الأولى (نفس الشروط — عدادات مصفّرة)
 * ========================================================== */

/** ⏲️ مدة تجهيز الجائزة قبل السماح بالاستلام النهائي (96 ساعة) */
export const PRIZE_READY_MS = 96 * 60 * 60 * 1000;
/** 📆 عمر الجائزة في الحقيبة قبل اختفائها (30 يومًا) */
export const PRIZE_BAG_MS = 30 * 24 * 60 * 60 * 1000;

const _esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** 🧹 إزالة الجوائز المنتهية من ملف اللاعب (تُستدعى عند العرض) */
export function purgeExpiredPrizes() {
  const player = getPlayer();
  if (!player || !Array.isArray(player.prizeClaims) || !player.prizeClaims.length) return;
  const now = Date.now();
  const fresh = player.prizeClaims.filter(c => !(c.collectedAt && now - c.collectedAt > PRIZE_BAG_MS));
  if (fresh.length !== player.prizeClaims.length) updatePlayer({ prizeClaims: fresh });
}

/** 📋 كل طلبات جوائزي (مع التطهير) */
export function getPrizeClaims() {
  purgeExpiredPrizes();
  const player = getPlayer() || {};
  return Array.isArray(player.prizeClaims) ? player.prizeClaims : [];
}

/** 📦 الطلب النشط لجائزة معينة (أُرسل ولم يُستلم نهائيًا بعد) */
export function activeClaimFor(awardId) {
  return getPrizeClaims().find(c => c.awardId === awardId && !c.collectedAt) || null;
}

/** 🎒 الجوائز المستلمة داخل مدة الثلاثين يومًا (تظهر في حقيبتي) */
export function bagPrizes() {
  return getPrizeClaims()
    .filter(c => c.collectedAt && Date.now() - c.collectedAt <= PRIZE_BAG_MS)
    .sort((a, b) => (b.collectedAt || 0) - (a.collectedAt || 0));
}

/**
 * 📨 إرسال طلب الجائزة بعد مشاهدة الإعلان:
 * نفس مسار claimAward (خصم + تصفير العدّادات + طلب للإدارة)
 * ويزيد عليه سجل «طلبات جوائزي» مع عدّاد الـ96 ساعة.
 * @returns {Promise<{ok:boolean, msg?:string}>}
 */
export async function sendPrizeRequest(award, email) {
  const res = await claimAward(award, email);
  if (!res.ok) return res;

  const player = getPlayer();
  if (!player) return res;

  // 🚫 سجل واحد نشط لكل جائزة
  const others = (player.prizeClaims || []).filter(
    c => !(c.awardId === award.id && !c.collectedAt));
  const entry = {
    id: res.claimId || ('pz_' + Date.now().toString(36)),
    awardId: award.id,
    awardName: award.name || '',
    awardImage: award.image || '',
    awardPrice: Number(award.price) || 0,
    email: String(email || '').trim(),
    requestedAt: Date.now(),
    readyAt: Date.now() + PRIZE_READY_MS,   // ⏲️ عدّاد 96 ساعة
    collectedAt: null,                       // يُضبط عند الاستلام النهائي
    expireAt: null                           // يُضبط عند الاستلام (+30 يومًا)
  };
  const updated = updatePlayer({ prizeClaims: [entry, ...others].slice(0, 12) });
  syncPlayerToFirestore(updated).catch(() => {});
  return { ok: true, msg: res.msg };
}

/**
 * 🎉 الاستلام النهائي بعد انتهاء عدّاد الـ96 ساعة:
 * يفعّل عمر الثلاثين يومًا في الحقيبة ثم تُعرض شاشة التهنئة.
 */
export function collectPrize(claimId) {
  const player = getPlayer();
  if (!player) return { ok: false, msg: 'لا يوجد لاعب' };
  const claims = Array.isArray(player.prizeClaims) ? [...player.prizeClaims] : [];
  const i = claims.findIndex(c => c.id === claimId);
  if (i < 0) return { ok: false, msg: 'الطلب غير موجود' };
  const c = claims[i];
  if (c.collectedAt) return { ok: false, msg: 'مستلمة سابقًا' };
  if (Date.now() < (c.readyAt || 0)) return { ok: false, msg: 'لم ينته عدّاد التجهيز بعد' };

  claims[i] = { ...c, collectedAt: Date.now(), expireAt: Date.now() + PRIZE_BAG_MS };
  const updated = updatePlayer({ prizeClaims: claims });
  syncPlayerToFirestore(updated).catch(() => {});
  // 🔴 v30 — جائزة جديدة وصلت الحقيبة: لافتة «جديد» على بطاقة الحقيبة
  try { document.dispatchEvent(new CustomEvent('bagchange')); } catch {}
  return { ok: true, claim: claims[i] };
}
