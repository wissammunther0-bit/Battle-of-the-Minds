// game/rewards.js — v14 (جديد)
// ============================================================
// 🎁 صندوق المكافآت + 🎡 قرص الحظ — المحرك المشترك (طلب المستخدم)
//
//  • الاثنان يعملان بنفس الآلية: لا يمكن الاستفادة كل لحظة —
//    وقت الإتاحة يحدده المطور من صفحة الإدارة (كل نصف ساعة/ساعة/
//    ساعتين/…/24 ساعة) ويُخزَّن في storeMeta/box و storeMeta/wheel.
//
//  • 🎬 الإعلانات: للاعب لا يستطيع فتح الصندوق ولا استلام جائزة
//    القرص إلا بمشاهدة إعلان. الإعلانات الحقيقية لن تُضاف إلا بعد
//    اكتمال تطوير اللعبة — لذلك جهّزنا البيئة كاملة عبر
//    playAdStub() (نافذة إعلان تجريبية 3 ثوانٍ). عند الربط لاحقًا
//    يُستبدل جسدها الداخلي _playAdPlatformOnly() باستدعاء SDK
//    الإعلانات الحقيقي في مكان واحد فقط دون تغيير أي شيء آخر.
//
//  • 🎡 قرص الحظ: 10 خانات يوزّع عليها المطور الجوائز ولكل خانة
//    "نسبة الحصول": مستحيلة (0%) / نادرة جدًا (1%) / صعبة (30%) /
//    متوسطة (50%) / سهلة (80%) / مضمونة (100%) — اختيار الخانة
//    الفائزة يتم بالوزن قبل بدء الدوران ثم يدور القرص لتتوقف
//    إبرته عليها (دوران مشوق حقيقي).
//
//  • الجوائز: جواهر 💎 / علامات انتصار 🏆 / جوائز ذكاء 🧠 /
//    أدوات مساعدة 🧰 (تغيير اسم، تخطي، تبديل، تجميد) — تُضاف
//    مباشرة إلى حساب اللاعب وتظهر في حقيبتي 🎒.
// ============================================================

import { getPlayer, updatePlayer } from '../auth.js';
import { getStoreItems, getBoxConfig, getWheelConfig } from '../store-catalog.js';
import { syncPlayerToFirestore } from '../firestore-sync.js';
// 🏦 v23 — الخزان الرئيسي: كل مكافأة تُسحب من مصدر اللعبة وتُحتسب
//    (v31: عدّاد الإعلانات tankAdViewed صار يُكتب من game/ads.js نفسه)
import {
  tankBoxTokens, tankWheelTokens, tankBoxGems, tankWheelGems,
  tankWheelSpinToday, tankBoxOpenToday
} from './economy.js';
import { notify } from '../ui/helpers.js';
import { t } from '../i18n.js';

/* ==========================================================
 * ⏰ حالة الإتاحة — الوقت المشترك للصندوق والقرص
 * ========================================================== */

/** 🎁 متى يصبح الصندوق متاحًا مجددًا؟ (ms epoch) — 0 = متاح الآن */
export function boxReadyAtMs() {
  const cfg = getBoxConfig();
  const p = getPlayer() || {};
  // ⚙️ بلا إعدادات من الإدارة = مفعّل تلقائيًا (ساعة واحدة افتراضيًا)
  //    ويُعطّل فقط عندما يوقفه المطور صراحةً من لوحة الإدارة
  if (cfg && cfg.enabled === false) return -1;
  const intervalMs = Math.max(1, Number(cfg?.intervalMinutes) || 60) * 60000;
  const last = Number(p.lastBoxAt) || 0;
  if (!last) return 0;                                     // أول مرة — متاح
  return last + intervalMs;
}

/** 🎡 متى يصبح القرص متاحًا مجددًا؟ (ms epoch) — 0 = متاح الآن */
export function wheelReadyAtMs() {
  const cfg = getWheelConfig();
  const p = getPlayer() || {};
  if (cfg && cfg.enabled === false) return -1;             // أوقفه المطور صراحةً
  const intervalMs = Math.max(1, Number(cfg?.intervalMinutes) || 60) * 60000;
  const last = Number(p.lastWheelAt) || 0;
  if (!last) return 0;
  return last + intervalMs;
}

/** { available, readyAt, remainingMs } للحالتين */
export function availabilityState(readyAtMs) {
  if (readyAtMs < 0) return { available: false, disabled: true, readyAt: 0, remainingMs: 0 };
  const now = Date.now();
  const remaining = Math.max(0, readyAtMs - now);
  return { available: remaining <= 0, disabled: false, readyAt: readyAtMs, remainingMs: remaining };
}

/** تنسيق المتبقي: 1س 23د 05ث */
export function fmtRemaining(ms) {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0) return `${h}س ${pad(m)}د ${pad(sec)}ث`;
  if (m > 0) return `${m}د ${pad(sec)}ث`;
  return `${sec}ث`;
}

/** تنسيق رقمي موحّد لعدادات الواجهة: MM:SS أو H:MM:SS */
export function fmtCountdown(ms) {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/* ==========================================================
 * 🎬 بيئة الإعلانات — v31: مربوطة بـ Google AdMob فعليًا
 *    المنطق الكامل في game/ads.js (SDK الحقيقي داخل التطبيق،
 *    إعلان تجريبي 3 ثوانٍ في المتصفح أثناء وضع الاختبار،
 *    بوابة تكرار: فاصل دقيقتين + حد يومي، والجائزة تُمنح فقط
 *    عند تأكيد الـSDK لاكتمال المشاهدة).
 * ========================================================== */

/** 🎬 مشاهدة إعلان — الواجهة الموحدة (تعيد true عند الإكمال)
 *  📊 v31: المسار الفعلي في game/ads.js — بوابة تكرار أولًا
 *    (فاصل + حد يومي) ثم SDK الحقيقي/الجسد التجريبي، والعدّاد
 *    في الخزان يُكتب من ads.js نفسه (منع ازدواج العدّ).
 *  @param {string} kind نوع موضع الإعلان:
 *    wheel (العجلة) · box (الصندوق) · double (المضاعفة) ·
 *    prize (جائزة نقدية) · extra (محاولة لعب واحدة)
 */
export async function playAd(kind = 'other') {
  try {
    const { showRewardedAd } = await import('./ads.js');
    return await showRewardedAd(kind);
  }
  catch { return false; }
}

/* ==========================================================
 * 🎒 سجل الحقيبة — آخر ما حصل عليه اللاعب (يظهر في حقيبتي)
 * ========================================================== */
function pushBagPrize(entry) {
  const p = getPlayer();
  if (!p) return;
  const list = [{ ...entry, at: Date.now() }, ...(p.bagPrizes || [])].slice(0, 30);
  updatePlayer({ bagPrizes: list });
}

/* ==========================================================
 * 🎁 صندوق المكافآت — مكافأة عشوائية يختارها المطور من القائمة
 *    (مثل قرص الحظ: نوع + مقدار + نسبة حصول لكل مكافأة)
 * ========================================================== */

/** 🔧 تطبيع مكافأة قديمة (type=reward جواهر فقط) إلى الصيغة الموحدة */
function _normLegacyReward(r) {
  const amount = Math.max(1, Math.floor(Number(r.gems) || 0));
  if (amount < 1) return null;
  return { kind: 'gems', amount, tier: 'easy', legacy: true, name: r.name };
}

/**
 * 🎯 مجمع مكافآت الصندوق:
 *  1) القائمة الجديدة من الإدارة (storeMeta/box.rewards) — اختيار النوع
 *     من القائمة (جواهر/علامات/ذكاء/أدوات) مع نسبة الحصول لكل واحدة.
 *  2) احتياطيًا: مكافآت storeItems القديمة (type=reward جواهر فقط).
 */
export function getBoxRewardPool() {
  const cfg = getBoxConfig();
  const fresh = Array.isArray(cfg?.rewards)
    ? cfg.rewards
        .map(_normSlot)                       // يقبل tool:x أيضًا
        .filter(s => s && s.kind !== 'none' &&
          (s.kind === 'tool' || Number(s.amount) > 0))
    : [];
  if (fresh.length) return fresh;
  return (getStoreItems('rewards') || [])
    .map(_normLegacyReward)
    .filter(Boolean);
}

/** 🎲 اختيار مكافأة الصندوق — احتياطي عشوائي بالوزن */
function pickRandomReward() {
  const pool = getBoxRewardPool();
  if (!pool.length) return null;
  const weighted = [];
  pool.forEach((s) => {
    const w = slotWeight(s);
    if (w > 0) weighted.push({ s, w });
  });
  if (!weighted.length) return null;
  const total = weighted.reduce((a, x) => a + x.w, 0);
  let r = Math.random() * total;
  for (const x of weighted) {
    r -= x.w;
    if (r <= 0) return x.s;
  }
  return weighted[weighted.length - 1].s;
}

/**
 * 🔢 v24 (طلب المستخدم): الصندوق يفتح أقسامه بالتسلسل —
 * كل فتح يأخذ القسم التالي (1 ← 2 ← … ← 10 ← يعيد من الأول)
 * بلا أي نسب — العداد محفوظ في ملف اللاعب (boxOpenCount).
 */
function pickSequentialReward() {
  const pool = getBoxRewardPool();
  if (!pool.length) return null;
  const p = getPlayer() || {};
  const idx = (Number(p.boxOpenCount) || 0) % pool.length;
  return pool[idx];
}

/**
 * 🎁 فتح الصندوق بعد مشاهدة الإعلان: مكافأة عشوائية (جواهر 💎 /
 * علامات 🏆 / جوائز ذكاء 🧠 / أداة مساعدة 🧰) تُضاف فورًا للحساب —
 * يُستدعى فقط بعد playAd() الناجحة، ويبدأ عدّاد الإتاحة التالية لحظة الفتح.
 */
export async function claimBoxReward() {
  const player = getPlayer();
  if (!player) return { ok: false, msg: t('noPlayer', 'لا يوجد لاعب') };

  const st = availabilityState(boxReadyAtMs());
  if (st.disabled) return { ok: false, msg: t('boxDisabled', 'الصندوق معطّل حاليًا') };
  if (!st.available) return { ok: false, msg: t('boxNotReady', 'الصندوق غير متاح بعد — انتظر انتهاء العدّاد') };

  const reward = pickSequentialReward();
  if (!reward) return { ok: false, msg: t('noRewardsYet', 'لم يضف مطوّر اللعبة مكافآت بعد') };

  const kind = reward.kind || 'gems';
  const amount = Math.max(0, Math.floor(Number(reward.amount) || 0));
  const patch = {};

  if (kind === 'gems')   patch.gems   = (player.gems   || 0) + amount;
  if (kind === 'tokens') patch.tokens = (player.tokens || 0) + amount;
  if (kind === 'intel')  patch.intel  = (player.intel  || 0) + amount;
  if (kind === 'tool') {
    const toolId = reward.toolId || 'rename';
    patch.boosters = { ...(player.boosters || {}), [toolId]: (player.boosters?.[toolId] || 0) + 1 };
  }

  // 🏦 تسجيل السحب من الخزان الرئيسي (مصدر مكافآت اللعبة)
  try {
    if (kind === 'gems') tankBoxGems(amount);
    else if (kind === 'tokens') tankBoxTokens(amount);
    else if (kind === 'intel') tankBoxGems(amount * 100); // جائزة = 100 جوهرة من المخزون
  } catch {}

  updatePlayer({
    ...patch,
    lastBoxAt: Date.now(),              // ⏲️ بدء عدّاد الإتاحة التالية
    boxOpenCount: (Number(player.boxOpenCount) || 0) + 1   // 🔢 تسلسل الأقسام
  });
  tankBoxOpenToday().catch(() => {});   // 📊 عدّاد الفتح اليومي (v24)
  pushBagPrize({ source: 'box', kind, amount, toolId: reward.toolId || '', label: prizeBagLabel(reward) });
  syncPlayerToFirestore(getPlayer()).catch(() => {});

  return { ok: true, kind, amount, label: prizeBagLabel(reward) };
}

/* ==========================================================
 * 🎡 قرص الحظ — الأوزان والاختيار والتطبيق
 * ========================================================== */

/** أوزان نسب الحصول (من إعدادات الإدارة) */
export const TIER_WEIGHTS = {
  impossible: 0,    // 🚫 مستحيلة — 0% (للجوائز القيّمة جدًا)
  rare: 1,          // 99% عدم الحصول
  hard: 30,         // 70% عدم الحصول
  medium: 50,       // 50% عدم الحصول
  easy: 80,         // 80% فرصة الحصول
  sure: 100         // ✅ مضمونة — 100%
};

export const TIER_LABELS = {
  impossible: 'مستحيلة (0%)',
  rare: 'نادرة جدًا (1%)',
  hard: 'صعبة (30%)',
  medium: 'متوسطة (50%)',
  easy: 'سهلة (80%)',
  sure: 'مضمونة (100%)'
};

/** خانات القرص الحالية من إعدادات الإدارة (مصفوفة آمنة + تطبيع tool:x) */
export function getWheelSlots() {
  const cfg = getWheelConfig();
  const slots = Array.isArray(cfg?.slots) ? cfg.slots : [];
  return slots
    .map(_normSlot)
    .filter(s => s && (Number(s.amount) > 0 || s.kind === 'tool' || s.kind === 'none'));
}

/** 🔧 تطبيع خانة: يقبل kind='tool:x' (صيغة الإدارة الخام) ويحوّلها للموحدة */
function _normSlot(s) {
  if (!s) return null;
  if (typeof s.kind === 'string' && s.kind.startsWith('tool:')) {
    return { ...s, kind: 'tool', toolId: s.kind.slice(5), amount: 1 };
  }
  return s;
}

/**
 * 🎯 اختيار الخانة الفائزة بالوزن (قبل بدء الدوران) — الخانة
 * "المستحيلة" وزنها 0 فلا تُختار أبدًا، وإذا كانت كل الأوزان صفرًا
 * يعيد null (لا جوائز قابلة للفوز).
 */
export function pickWheelSlot() {
  const slots = getWheelSlots();
  if (slots.length < 2) return null;
  const weighted = [];
  slots.forEach((s, i) => {
    const w = slotWeight(s);
    if (w > 0) weighted.push({ i, s, w });
  });
  if (!weighted.length) return null;
  const total = weighted.reduce((a, x) => a + x.w, 0);
  let r = Math.random() * total;
  for (const x of weighted) {
    r -= x.w;
    if (r <= 0) return { index: x.i, slot: x.s };
  }
  const last = weighted[weighted.length - 1];
  return { index: last.i, slot: last.s };
}

/** وسم الجائزة القصير للعرض داخل خانات القرص (يستعمل في القرص) */
export function prizeLabel(slot) {
  const kind = slot?.kind || 'gems';
  const amount = Math.max(0, Math.floor(Number(slot?.amount) || 0));
  switch (kind) {
    case 'gems':   return `💎 ${amount}`;
    case 'tokens': return `🏆 ${amount}`;
    case 'intel':  return `🧠 ${amount}`;
    case 'tool': {
      const names = {
        rename: '✏️', skip: '⏭️',
        swap: '🔄', freeze: '❄️', fifty: '✂️'
      };
      return names[slot?.toolId] || '🧰';
    }
    default: return '∅';
  }
}

/** تسمية عربية للتطبيق الفعلي (الحقيبة والنوافذ) */
function prizeBagLabel(slot) {
  const kind = slot?.kind || 'gems';
  const amount = Math.max(0, Math.floor(Number(slot?.amount) || 0));
  if (kind === 'gems') return `💎 ${amount} جوهرة`;
  if (kind === 'tokens') return `🏆 ${amount} علامة انتصار`;
  if (kind === 'intel') return `🧠 ${amount} جائزة ذكاء`;
  if (kind === 'tool') return prizeLabel(slot);
  return '—';
}

/**
 * 🎡 تطبيق جائزة القرص بعد مشاهدة الإعلان — تُضاف للحساب مباشرة:
 * جواهر/علامات/جوائز ذكاء/أداة مساعدة (مخزون +1).
 * ⏲️ عدّاد القرص بدأ لحظة الدوران (الفرصة تُستهلك بالدوران).
 */
export async function claimWheelPrize(slot) {
  const player = getPlayer();
  if (!player || !slot) return { ok: false, msg: t('error', 'خطأ') };

  const kind = slot.kind || 'gems';
  const amount = Math.max(0, Math.floor(Number(slot.amount) || 0));
  const patch = {};

  if (kind === 'gems')   patch.gems  = (player.gems  || 0) + amount;
  if (kind === 'tokens') patch.tokens = (player.tokens || 0) + amount;
  if (kind === 'intel')  patch.intel = (player.intel || 0) + amount;
  if (kind === 'tool') {
    const toolId = slot.toolId || 'rename';
    patch.boosters = { ...(player.boosters || {}), [toolId]: (player.boosters?.[toolId] || 0) + 1 };
  }

  // 🏦 تسجيل السحب من الخزان الرئيسي (مصدر جوائز القرص)
  try {
    if (kind === 'gems') tankWheelGems(amount);
    else if (kind === 'tokens') tankWheelTokens(amount);
    else if (kind === 'intel') tankWheelGems(amount * 100);
  } catch {}

  updatePlayer(patch);
  pushBagPrize({ source: 'wheel', kind, amount, toolId: slot.toolId || '', label: prizeBagLabel(slot) });
  syncPlayerToFirestore(getPlayer()).catch(() => {});

  return { ok: true, label: prizeBagLabel(slot) };
}

/**
 * ⏲️ تعليم لحظة الدوران (تُستهلك فرصة القرص حتى لو لم تُستلم الجائزة)
 * 📊 v24 (طلب المستخدم): كل تحريك للعجلة يُسجَّل في قاعدة بيانات اللاعب
 *    في Firebase (wheelSpins + آخر لحظة تحريك) — يعاد مع مزامنة الملف.
 */
export function markWheelSpinned() {
  const p = getPlayer();
  updatePlayer({
    lastWheelAt: Date.now(),
    wheelSpins: ((p && Number(p.wheelSpins)) || 0) + 1
  });
  tankWheelSpinToday().catch(() => {});   // 📊 عدّاد التحريك اليومي (v24)
  syncPlayerToFirestore(getPlayer()).catch(() => {});
}

/** 🔔 إشعار سريع موحّد */
export function rewardNotify(msg, type = 'success') {
  notify(msg, type);
}
