// game/economy.js
// ============================================================
// 🏦 الخزان الرئيسي للاقتصاد — v23 (طلب المستخدم)
//
//  • gameMeta/tank وثيقة واحدة في Firebase هي المصدر الرئيسي للعبة:
//      - tankTokens: مخزون علامات الانتصار (يضيفه المطور من الإدارة)
//      - tankGems  : مخزون الجواهر — يُحسب تلقائيًا (كل 5 علامات = 1 جوهرة)
//      - tankIntel : مخزون جوائز الذكاء — يُحسب تلقائيًا (كل 100 جوهرة = 1)
//  • كل حركة اقتصادية تسجّل نفسها هنا (زيادات ذرّية increment):
//      صندوق المكافآت · قرص الحظ · إعلان المضاعفة · شراء الأدوات ·
//      الربط بجوجل · اللاعبون الافتراضيون · التبادل · الإعلانات · التسجيل.
//  • الكتابات "أفضل محاولة" — فشل الشبكة لا يعطل اللعب أبدًا.
// ============================================================

import { db } from '../firebase-config.js';
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp, increment
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const TANK_REF = 'gameMeta/tank';

/** 📅 مفتاح اليوم المحلي — للعدادات اليومية (سحب/استرداد/إعلانات) */
function _dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 🧾 كتابة سجل يومي رخيص — gameMeta/{log}/days/{date} (أفضل محاولة) */
async function _bumpLog(root, field, n) {
  try {
    await setDoc(doc(db, 'gameMeta', root, 'days', _dayKey()),
      { [field]: increment(n), updatedAt: serverTimestamp() },
      { merge: true });
  } catch {}
}

/** 🧮 تحويلات الاقتصاد الثابتة */
export const TANK_TOKENS_PER_GEM = 5;    // كل 5 علامات = 1 جوهرة (v24 — طلب المستخدم)
export const TANK_GEMS_PER_INTEL = 100;  // كل 100 جوهرة = 1 جائزة ذكاء

/**
 * ⚛️ زيادة ذرّية لحقول الوثيقة — أفضل محاولة (بلا رمي أخطاء).
 * @param {Record<string, number>} fields { fieldName: delta }
 */
export async function bumpTank(fields) {
  if (!fields || !Object.keys(fields).length) return false;
  try {
    const patch = {};
    Object.entries(fields).forEach(([k, v]) => {
      patch[k] = increment(Number(v) || 0);
    });
    patch.updatedAt = serverTimestamp();
    await updateDoc(doc(db, TANK_REF), patch);
    return true;
  } catch (e) {
    // الوثيقة غير موجودة (أول حركة) — أنشئها بالقيم المطلقة
    try {
      const snap = await getDoc(doc(db, TANK_REF));
      if (!snap.exists()) {
        const init = { ...fields, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
        Object.keys(init).forEach(k => { init[k] = Math.max(0, Number(init[k]) || 0); });
        await setDoc(doc(db, TANK_REF), init);
        return true;
      }
      const retry = {};
      Object.entries(fields).forEach(([k, v]) => { retry[k] = increment(Number(v) || 0); });
      retry.updatedAt = serverTimestamp();
      await updateDoc(doc(db, TANK_REF), retry);
      return true;
    } catch (e2) {
      console.warn('[economy] bumpTank failed:', e2?.message || e2);
      return false;
    }
  }
}

/* ---------------- حركات اقتصادية جاهزة ----------------
   🛠️ v25 إصلاح حرج: كل هذه الدوال أصبحت async تُعيد Promise دائمًا —
   كانت النسخ السابقة تُعيد undefined (أسهم دالة بأقواس {}) فينهار
   كل مستدٍ يربط .catch() على نتيجتها (شاشة نهاية الجولة تتجمد
   عند فوز اللاعب الافتراضي — أخطر موضع كان في game/endGame.js). */

/** 🎁 علامات انتصار سُحبت من الخزان لصندوق المكافآت */
export async function tankBoxTokens(n) {
  const p = bumpTank({ boxTokens: n, tankTokens: -n }); _noteDrawn(n); return p;
}

/** 🎡 علامات انتصار سُحبت من الخزان لعجلة المكافآت */
export async function tankWheelTokens(n) {
  const p = bumpTank({ wheelTokens: n, tankTokens: -n }); _noteDrawn(n); return p;
}

/** 💎 جواهر سُحبت من الخزان لصندوق المكافآت (كل جوهرة = 5 علامات من المخزون) */
export async function tankBoxGems(n) {
  const p = bumpTank({ boxGems: n, tankTokens: -(n * TANK_TOKENS_PER_GEM) }); _noteDrawn(n * TANK_TOKENS_PER_GEM); return p;
}

/** 💎 جواهر سُحبت من الخزان لعجلة المكافآت */
export async function tankWheelGems(n) {
  const p = bumpTank({ wheelGems: n, tankTokens: -(n * TANK_TOKENS_PER_GEM) }); _noteDrawn(n * TANK_TOKENS_PER_GEM); return p;
}

/** 🎬 علامات المضاعفة بعد إعلان نهاية الجولة (سُحبت من الخزان) */
export async function tankAdDoubleTokens(n) {
  const p = bumpTank({ adDoubleTokens: n, tankTokens: -n }); _noteDrawn(n); return p;
}

/** 🛒 علامات أُنفققت على شراء أدوات مساعدة (تعود إلى الخزان) */
export async function tankToolPurchaseTokens(n) {
  const p = bumpTank({ toolPurchaseTokens: n, tankTokens: n }); _noteRecovered(n); return p;
}

/** 💎 جواهر أُنفققت على شراء شخصيات (تعود إلى الخزان كعلامات) */
export async function tankCharacterGems(n) {
  const p = bumpTank({ characterGems: n, tankTokens: n * TANK_TOKENS_PER_GEM }); _noteRecovered(n * TANK_TOKENS_PER_GEM); return p;
}

/** 🔗 جواهر سُحبت من الخزان بسبب ربط الحساب بحساب جوجل */
export async function tankLinkGems(n) {
  return bumpTank({ linkGems: n, tankTokens: -(n * TANK_TOKENS_PER_GEM) });
}

/** 🆕 تكلفة إنشاء لاعب جديد (5 علامات من الخزان) */
export async function tankNewPlayerCost(n = 5) {
  const p = bumpTank({ newPlayerTokens: n, tankTokens: -n }); _noteDrawn(n); return p;
}

/** 🤖 اللاعب الافتراضي خسر: سُحبت علامات من الخزان وأُعطيت للاعب الحقيقي */
export async function tankVirtualDraw(n) {
  const p = bumpTank({ virtualDrawnTokens: n, tankTokens: -n }); _noteDrawn(n); return p;
}

/** 🤖 اللاعب الافتراضي ربح: علامة اللاعب الحقيقي عادت إلى الخزان */
export async function tankVirtualReturn(n) {
  const p = bumpTank({ virtualReturnedTokens: n, tankTokens: n }); _noteRecovered(n); return p;
}

/** 🗑️ v29 (طلب المستخدم) — حذف لاعب حقيقي: علامات الانتصار والجواهر وغيرها
 *  تعود إلى الخزان الرئيسي (وتُسجَّل كحركة استرداد في سجل الخزان).
 *  @param {number} n مجموع العلامات المعادة بعد التحويل
 *  (الجواهر ×5 وجوائز الذكاء ×500 — نفس تحويلات الخزان المعتمدة) */
export async function tankPlayerDeleted(n) {
  const p = bumpTank({ playerDeletedTokens: n, tankTokens: n }); _noteRecovered(n); return p;
}

/** 💱 جواهر نتجت عن التبادل (علامات ← جواهر) */
export async function tankExchangeGems(n) {
  return bumpTank({ exchangeGems: n });
}

/** 🧠 جوائز ذكاء نتجت عن التبادل (جواهر ← جوائز) */
export async function tankExchangeIntel(n) {
  return bumpTank({ exchangeIntel: n });
}

/** 🎬 v24 — عدّاد الإعلانات لكل مرحلة: النوع + اليوم + الدولة (طلب المستخدم)
 *  @param {number} n عدد المشاهدات
 *  @param {string} kind wheel | box | double | prize | extra
 *  @param {string} country رمز دولة اللاعب (SA/EG/…)
 */
export async function tankAdViewed(n = 1, kind = 'other', country = '') {
  const todayPatch = {};
  // خريطة اليوم تُصفَّر تلقائيًا عندما يتغيّر التاريخ (يقرأ الأدمن date)
  todayPatch['adsToday.date'] = _dayKey();
  todayPatch['adsToday.total'] = increment(n);
  todayPatch[`adsToday.${kind}`] = increment(n);
  const patch = {
    adsViewed: increment(n),
    [`adsByKind.${kind}`]: increment(n),
    ...todayPatch
  };
  if (country) patch[`adsByCountry.${country}`] = increment(n);
  await bumpTank(patch);
  await _bumpLog('adsLog', 'total', n);
  await _bumpLog('adsLog', 'kinds.' + kind, n);
}

/** 📤 حركة سحب من الخزان (تغذي عدّاد اليوم وسجل الفترات) */
function _noteDrawn(n) {
  if (n > 0) {
    bumpTank({ 'outToday.date': _dayKey(), 'outToday.amount': increment(n) }).catch(() => {});
    _bumpLog('ecoLog', 'drawn', n).catch(() => {});
  }
}

/** 📥 حركة استرداد إلى الخزان (أدوات/فوز افتراضي) */
function _noteRecovered(n) {
  if (n > 0) {
    bumpTank({ 'recToday.date': _dayKey(), 'recToday.amount': increment(n) }).catch(() => {});
    _bumpLog('ecoLog', 'recovered', n).catch(() => {});
  }
}

/** 📊 جولة لُعبت (لإحصاءات النشاط) */
export async function tankRoundPlayed(n = 1) {
  return bumpTank({ roundsPlayed: n });
}

/** 🎡 v24 — عدّاد تحريك العجلة اليومي (للأدمن: كم مرة حُرّكت اليوم/بفترة) */
export async function tankWheelSpinToday() {
  await bumpTank({ 'wheelSpinsToday.date': _dayKey(), 'wheelSpinsToday.count': increment(1) });
  await _bumpLog('ecoLog', 'wheelSpins', 1);
}

/** 🎁 v24 — عدّاد فتح الصندوق اليومي */
export async function tankBoxOpenToday() {
  await bumpTank({ 'boxOpensToday.date': _dayKey(), 'boxOpensToday.count': increment(1) });
  await _bumpLog('ecoLog', 'boxOpens', 1);
}

/** 🧠 v24 — استرداد جوائز الذكاء إلى الخزان (استبدلها اللاعب بهدية حقيقية) */
export async function tankIntelRecovered(n) {
  // جائزة واحدة = 100 جوهرة = 500 علامة من مخزون اللعبة
  const p = bumpTank({ intelRecovered: n, tankTokens: n * TANK_GEMS_PER_INTEL * TANK_TOKENS_PER_GEM });
  _noteRecovered(n * TANK_GEMS_PER_INTEL * TANK_TOKENS_PER_GEM);
  return p;
}

/** قراءة الخزان مرة واحدة (للإدارة) */
export async function readTank() {
  try {
    const snap = await getDoc(doc(db, TANK_REF));
    return snap.exists() ? snap.data() : null;
  } catch { return null; }
}

/** 💰 حساب المخزونات المشتقة تلقائيًا من الخزان الرئيسي */
export function deriveTanks(tankTokens = 0) {
  const t = Math.max(0, Math.floor(Number(tankTokens) || 0));
  const gems = Math.floor(t / TANK_TOKENS_PER_GEM);
  const intel = Math.floor(gems / TANK_GEMS_PER_INTEL);
  return { tankTokens: t, tankGems: gems, tankIntel: intel };
}
