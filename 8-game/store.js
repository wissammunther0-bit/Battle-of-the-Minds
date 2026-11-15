// store.js — v14
// ============================================================
// 💎 الاقتصاد — محلي أولًا ثم مزامنة Firestore
//
// الجديد في v14 (طلبات المستخدم):
//  • 🧩 توحيد الشخصيات والأفاتار: هما الشيء نفسه (صورة بروفايل
//    تُشرى بالجواهر). buyCharacter يشتري من كتالوج الإدارة
//    (type=character أو avatar القديمة) ويجهّزها تلقائيًا،
//    وbuyAvatar/equipAvatar أصبحا اسمين بديلين لنفس المسار.
//  • 🔴 الشخصيات كلها من قاعدة البيانات — لا شخصية تُشترى إن لم
//    يضفها المطور من صفحة الإدارة.
//
// الجديد في v11 (طلبات المستخدم):
//  • التحويل: كل 10 علامات انتصار = 1 جوهرة (كانت 5)
//  • 🧠 جوائز الذكاء (intel): كل 100 جوهرة = 1 جائزة ذكاء —
//    مع شروط فتح يحددها المطور (أفاتارات مشتراة/استخدام أدوات…)
//    حتى لا يسهل على اللاعب التحويل دون استخدام المتجر والأدوات
//  • 🧮 عدّادات شروط الجوائز (awardCounters): تُصفَّر كاملة عند
//    استلام جائزة — لا يمكن ركوب نفس الاستخدام لجائزة أخرى
//  • 🗑️ حُذف المساعدون (المعالج/الحامي) — لا ضرر في اللعبة إطلاقًا
//  • ✏️ أداة تغيير الاسم: استهلاكية تتجاوز قفل الـ60 يومًا
// ============================================================

import { getPlayer, updatePlayer, noteBagConsumed } from './auth.js';
import { syncPlayerToFirestore } from './firestore-sync.js';
// 🐞 إصلاح v17: getEconomyConfig كان يُستدعى في isIntelConvertUnlocked()
// دون استيراده — كان يرمي ReferenceError عند فتح المتجر (store.js:87)
import { getStoreItems, getEconomyConfig } from './store-catalog.js';
// 🏦 v23 — الخزان الرئيسي (كل حركة اقتصادية تُسجّل في gameMeta/tank)
import {
  tankExchangeGems, tankExchangeIntel, tankLinkGems,
  tankToolPurchaseTokens, tankCharacterGems, tankNewPlayerCost
} from './game/economy.js';

/** كل 5 علامات انتصار = 1 جوهرة (v24 — طلب المستخدم) */
export const TOKENS_PER_GEM = 5;
/** كل 100 جوهرة = 1 جائزة ذكاء (طلب المستخدم) */
export const GEMS_PER_INTEL = 100;

/**
 * 💎 تحويل علامات الانتصار إلى جواهر (كل 10 علامات = 1 جوهرة)
 * @param {number|null} tokensToConvert عدد العلامات المطلوب — null = تحويل الكل
 */
export function convertTokensToGems(tokensToConvert = null) {
  const player = getPlayer();
  if (!player || player.tokens < TOKENS_PER_GEM) {
    return { ok: false, msg: `تحتاج ${TOKENS_PER_GEM} علامة انتصار على الأقل` };
  }
  const maxGems = Math.floor(player.tokens / TOKENS_PER_GEM);
  const gems = (typeof tokensToConvert === 'number' && tokensToConvert > 0)
    ? Math.min(Math.floor(tokensToConvert), maxGems)
    : maxGems;
  if (gems < 1) return { ok: false, msg: `تحتاج ${TOKENS_PER_GEM} علامة انتصار على الأقل` };
  const updated = updatePlayer({
    tokens: player.tokens - gems * TOKENS_PER_GEM,
    gems: player.gems + gems
  });
  tankExchangeGems(gems);          // 💱 عدّاد التبادل (جواهر من التبادل)
  return { ok: true, msg: `تم تحويل ${gems * TOKENS_PER_GEM} علامة إلى ${gems} جوهرة`, player: updated, gems };
}

/* ==========================================================
 * 🧠 شروط فتح تحويل الجواهر ← جوائز الذكاء
 *    (الإعدادات من صفحة الإدارة — storeMeta/economy)
 * ========================================================== */

/** قيمة عدّاد الشرط الحالية للاعب */
function counterValue(player, type) {
  const c = player.awardCounters || {};
  switch (type) {
    case 'avatarsOwned': return (player.ownedAvatars || []).length;
    case 'toolUses':     return c.toolUses || 0;
    case 'wins':         return c.wins || 0;
    case 'roundsPlayed': return c.roundsPlayed || 0;
    case 'level':        return player.level || 1;
    default:             return 0;
  }
}

/** هل الشرط مستوفى؟ */
export function isConditionMet(cond) {
  const player = getPlayer();
  if (!player || !cond?.type) return false;
  return counterValue(player, cond.type) >= (Number(cond.value) || 0);
}

/** تقييم قائمة شروط وفق النمط (all = كل الشروط / any = أي شرط) */
export function evaluateConditions(conditions = [], mode = 'all') {
  if (!conditions.length) return true; // بلا شروط = مفتوح دائمًا
  const met = conditions.map(isConditionMet);
  return mode === 'any' ? met.some(Boolean) : met.every(Boolean);
}

/** 🧠 هل تحويل الجواهر إلى جوائز ذكاء مفتوح للاعب الآن؟ */
export function isIntelConvertUnlocked() {
  const cfg = getEconomyConfig();
  return evaluateConditions(cfg?.convertConditions || [], cfg?.convertMode || 'any');
}

/** وصف نصي للشرط (للعرض في الواجهات) */
export function conditionLabel(cond) {
  const NAMES = {
    avatarsOwned: 'امتلاك أفاتار',
    toolUses: 'استخدام أدوات مساعدة',
    wins: 'فوز بجولة',
    roundsPlayed: 'لعب جولة',
    level: 'الوصول للمستوى'
  };
  return `${NAMES[cond.type] || cond.type}: ${cond.value}`;
}

/**
 * 🧠 تحويل جواهر → جوائز ذكاء (كل 100 جوهرة = 1 جائزة)
 * مفتوح فقط بعد استيفاء شروط الفتح المحددة من الإدارة.
 */
export function convertGemsToIntel(intelToConvert = null) {
  const player = getPlayer();
  if (!player) return { ok: false, msg: 'لا يوجد لاعب' };
  if (!isIntelConvertUnlocked()) {
    return { ok: false, locked: true, msg: 'التحويل مقفل — استوفِ شروط الاستخدام أولًا' };
  }
  if (player.gems < GEMS_PER_INTEL) {
    return { ok: false, msg: `تحتاج ${GEMS_PER_INTEL} جوهرة على الأقل` };
  }
  const maxIntel = Math.floor(player.gems / GEMS_PER_INTEL);
  const intel = (typeof intelToConvert === 'number' && intelToConvert > 0)
    ? Math.min(Math.floor(intelToConvert), maxIntel)
    : maxIntel;
  if (intel < 1) return { ok: false, msg: `تحتاج ${GEMS_PER_INTEL} جوهرة على الأقل` };
  const updated = updatePlayer({
    gems: player.gems - intel * GEMS_PER_INTEL,
    intel: (player.intel || 0) + intel
  });
  tankExchangeIntel(intel);        // 💱 عدّاد التبادل (جوائز ذكاء من التبادل)
  return { ok: true, msg: `تم تحويل ${intel * GEMS_PER_INTEL} جوهرة إلى ${intel} جائزة ذكاء`, player: updated, intel };
}

/* ==========================================================
 * 🧮 عدّادات شروط الجوائز — تُصفَّر عند استلام جائزة
 * ========================================================== */

/** زيادة عدّاد شرط (avatarsBought/wins/roundsPlayed/toolUses) */
export function bumpAwardCounter(key, n = 1) {
  const player = getPlayer();
  if (!player) return;
  const c = { ...(player.awardCounters || { toolUses: 0, wins: 0, roundsPlayed: 0 }) };
  c[key] = (c[key] || 0) + n;
  updatePlayer({ awardCounters: c });
}

/** 🧹 تصفير كل العدّادات — تُستدعى عند استلام جائزة ذكاء */
export function resetAwardCounters() {
  updatePlayer({ awardCounters: { toolUses: 0, wins: 0, roundsPlayed: 0 } });
}

export function buyCharacter(charId) {
  const player = getPlayer();
  // 🧩 الشخصية من كتالوج الإدارة (شخصيات/أفاتار — شيء واحد)
  const char = getStoreItems('characters').find(c => c.id === charId);
  if (!char) return { ok: false, msg: 'غير متوفرة حاليًا — يضيفها مطوّر اللعبة من لوحة الإدارة' };
  const owned = player.ownedCharacters.includes(charId) || (player.ownedAvatars || []).includes(charId);
  if (owned) return { ok: false, msg: 'تملكها بالفعل' };
  if (player.gems < (char.price || 0)) return { ok: false, msg: 'جواهر غير كافية' };

  // 🧮 عدّاد شرط "امتلاك أفاتار/شخصية" — يبقى أثره حتى تصفير الجوائز
  bumpAwardCounter('avatarsBought', 1);

  const updated = updatePlayer({
    gems: player.gems - (char.price || 0),
    ownedCharacters: [...(player.ownedCharacters || []), charId],
    equippedCharacter: charId,          // تجهيز تلقائي بعد الشراء
    equippedAvatar: charId              // 🧩 نفس الشيء — صورة البروفايل
  });
  tankCharacterGems(char.price || 0);   // 🏦 جواهر الشراء تعود للخزان
  // 🔴 v30 — شخصية جديدة في الحقيبة: لافتة «جديد» على بطاقة الحقيبة
  try { document.dispatchEvent(new CustomEvent('bagchange')); } catch {}
  // 📊 v24 — إحصائية الشراء لصفحة الإدارة (عدد المرات + مجموع الجواهر)
  import('./firestore-sync.js').then(async ({ bumpStoreItemStats }) => {
    await bumpStoreItemStats(charId, char.price || 0, 'gems');
  }).catch(() => {});
  return { ok: true, msg: `تم شراء ${typeof char.name === 'string' ? char.name : (char.name?.ar || 'الشخصية')} وتجهيزها!`, player: updated };
}

/**
 * 🧰 شراء أداة مساعدة — v23 (طلب المستخدم): الشراء بعلامات الانتثار
 * وليس بالجواهر — سعر الأداة يحدده المطور من لوحة الإدارة بعلامات.
 */
export function buyBooster(boosterId, quantity = 1) {
  const player = getPlayer();
  if (!player) return { ok: false, msg: 'لا يوجد لاعب' };
  // 🧰 الأدوات من كتالوج الإدارة (storeItems type=booster)
  const booster = getStoreItems('boosters').find(b => b.id === boosterId);
  if (!booster) return { ok: false, msg: 'غير متوفر حاليًا — يضيفها المطور من لوحة الإدارة' };
  const count = Number(quantity);
  if (!Number.isSafeInteger(count) || count < 1) return { ok: false, msg: 'أدخل كمية صحيحة' };
  const currentCount = Number((player.boosters || {})[booster.grants || boosterId]) || 0;
  if (!Number.isSafeInteger(currentCount + count)) return { ok: false, msg: 'الكمية أكبر من الحد المسموح' };
  const configuredPrice = Number(booster.price) || 0;
  const unitPrice = Number.isFinite(configuredPrice) ? Math.max(0, configuredPrice) : 0;
  const totalPrice = unitPrice * count;
  // 🏆 الدفع بعلامات الانتثار (وليس الجواهر — طلب المستخدم)
  if (!Number.isFinite(totalPrice) || totalPrice > (player.tokens || 0)) {
    return { ok: false, msg: 'علامات انتصار غير كافية' };
  }
  const boosters = {
    ...(player.boosters || {}),
    // 🧊 أدوات التجميد الثلاث منتجات مختلفة تُغذّي نفس مخزون 'freeze'
    [booster.grants || boosterId]: (player.boosters?.[booster.grants || boosterId] || 0) + count
  };
  const updated = updatePlayer({ tokens: (player.tokens || 0) - totalPrice, boosters });
  tankToolPurchaseTokens(totalPrice);   // 🏦 علامات الشراء تعود إلى الخزان
  // 🔴 v30 — أداة جديدة في الحقيبة: لافتة «جديد» على بطاقة الحقيبة
  try { document.dispatchEvent(new CustomEvent('bagchange')); } catch {}
  // 📊 v24 — إحصائية الشراء للأدمن (عدد المرات + مجموع العلامات)
  import('./firestore-sync.js').then(async ({ bumpStoreItemStats }) => {
    await bumpStoreItemStats(booster.id, totalPrice, 'tokens');
  }).catch(() => {});
  const name = typeof booster.name === 'string' ? booster.name : (booster.name?.ar || 'الأداة');
  return { ok: true, msg: `تم شراء ${count} من ${name}`, player: updated };
}

export function equipCharacter(charId) {
  const player = getPlayer();
  const owned = (player.ownedCharacters || []).includes(charId)
    || (player.ownedAvatars || []).includes(charId);
  if (!owned) return { ok: false, msg: 'لا تملكها' };
  updatePlayer({ equippedCharacter: charId, equippedAvatar: charId });
  return { ok: true };
}

/* ==========================================================
 * 🧩 توحيد v14: الأفاتار والشخصية شيء واحد —
 *    buyAvatar/equipAvatar بديلان يمرّران على مسار الشخصيات.
 * ========================================================== */
export function buyAvatar(avatarId) {
  return buyCharacter(avatarId);
}

export function equipAvatar(avatarId) {
  if (!avatarId) {
    updatePlayer({ equippedCharacter: null, equippedAvatar: null });
    return { ok: true };
  }
  return equipCharacter(avatarId);
}

/* ==========================================================
 * 🎁 هدية ربط Google (+5 جواهر — مرة واحدة فقط، v23)
 * ========================================================== */
export function claimGoogleGift() {
  const player = getPlayer();
  if (!player || player.googleGiftClaimed) return { ok: false, msg: 'مستلمة سابقاً' };
  const updated = updatePlayer({
    gems: (player.gems || 0) + 5,
    googleGiftClaimed: true
  });
  tankLinkGems(5);                    // 🏦 جواهر الهدية من الخزان الرئيسي
  return { ok: true, msg: '🎁 +5 جواهر', player: updated };
}

export function consumeBooster(boosterId) {
  const player = getPlayer();
  if (!player.boosters[boosterId] || player.boosters[boosterId] <= 0) return false;
  const boosters = { ...player.boosters, [boosterId]: player.boosters[boosterId] - 1 };
  updatePlayer({ boosters });
  // 🎒 v32 — الاستهلاك يخفي وصول الأداة غير المشاهد + يعيد تقييم شارة
  //    الحقيبة فورًا (كانت تظل مضاءة رغم أن الأداة استُهلكت = تنبيه وهمي)
  noteBagConsumed(1);
  try { document.dispatchEvent(new CustomEvent('bagchange')); } catch {}
  return true;
}

/**
 * 🏆 مكافأة نهاية التحدي — v23 (طلب المستخدم: نظام الوقود):
 * اللاعب دفع وقودًا (علامة) عند الدخول، والفائز يأخذ كل الوقود:
 *   فردي = علامته + علامة الخصم (2) · رباعي = 4 · 8ضد8 = 8
 * وليس +5 علامات عشوائية كما كان سابقًا.
 * @param {number} pot عدد علامات الوقود الكلية في الجولة
 */
export function addVictoryReward(pot = 2) {
  const player = getPlayer();
  const gain = Math.max(1, Number(pot) || 2);
  const updated = updatePlayer({
    tokens: (player.tokens || 0) + gain,
    wins: (player.wins || 0) + 1
  });
  return updated;
}

export function addLoss() {
  const player = getPlayer();
  return updatePlayer({
    losses: (player.losses || 0) + 1,
    wins: Math.max(0, (player.wins || 0) - 1)
  });
}

/* ==========================================================
 * 🏆 اقتصاد علامات الانتصار — v19 (طلب المستخدم)
 *  • لا يمكن بدء جولة دون علامة انتصار واحدة على الأقل
 *  • الدخول للجولة يستهلك علامة واحدة (شاشة تفاعلية بالخصم)
 *  • الخسارة = خسارة علامة الدخول (لا استرجاع)
 *  • الفوز = +5 علامات انتصار
 *  • النفاد = لوحة «شاهد إعلانًا لمحاولة لعب واحدة» (+1)
 *  • مضاعفة نتيجة الجولة المنتصرة بمشاهدة إعلان (+5 إضافية)
 * ========================================================== */

/** هل يملك اللاعب علامة واحدة على الأقل لبدء جولة؟ */
export function hasPlayBadge() {
  const player = getPlayer();
  return (player?.tokens || 0) >= 1;
}

/**
 * 🎟️ استقطاع علامة انتصار عند دخول الجولة (-1)
 * @returns {{ok:boolean, tokens:number}}
 */
export function spendRoundBadge() {
  const player = getPlayer();
  if (!player || (player.tokens || 0) < 1) return { ok: false, tokens: player?.tokens || 0 };
  const updated = updatePlayer({ tokens: (player.tokens || 0) - 1 });
  syncPlayerToFirestore(updated).catch(() => {});
  return { ok: true, tokens: updated.tokens };
}

/** ↩️ إرجاع علامة الدخول عند إلغاء البحث قبل بدء الجولة */
export function refundRoundBadge() {
  const player = getPlayer();
  if (!player) return;
  const updated = updatePlayer({ tokens: (player.tokens || 0) + 1 });
  syncPlayerToFirestore(updated).catch(() => {});
  return updated;
}

/** 🎬 محاولة اللعب الإضافية بعد مشاهدة الإعلان (+1) */
export function grantExtraPlayAttempt() {
  const player = getPlayer();
  if (!player) return null;
  const updated = updatePlayer({ tokens: (player.tokens || 0) + 1 });
  syncPlayerToFirestore(updated).catch(() => {});
  return updated;
}

/**
 * ✖️2 مضاعفة الناتج الكلي بعد مشاهدة الفيديو — v24 (طلب المستخدم):
 * المضاعفة تشمل النتيجة كلها وليس نصفها:
 *   فردي: 2 → 4 · رباعي: 4 → 8 · 8ضد8: 8 → 16
 * أي أن الإضافة = نفس ناتج الفوز الأساسي (pot)، وتُسحب من الخزان الرئيسي.
 * @param {string} roundId معرف الجولة — يمنع المضاعفة مرتين لنفس الجولة
 * @param {number} pot ناتج التحدي الأساسي للنمط (2/4/8)
 */
export function doubleWinReward(roundId, pot = 2) {
  const player = getPlayer();
  if (!player) return { ok: false, msg: 'لا يوجد لاعب' };
  const key = 'dbl_' + String(roundId || '');
  const done = player.doubledRounds || [];
  if (done.includes(key)) return { ok: false, msg: 'تمت المضاعفة سابقًا' };
  const extra = Math.max(1, Number(pot) || 2);   // ✖️2 = مضاعفة كاملة للناتج
  const updated = updatePlayer({
    tokens: (player.tokens || 0) + extra,
    doubledRounds: [...done.slice(-20), key]
  });
  // 🏦 المضاعفة تُسحب من الخزان الرئيسي (مصدر مكافآت اللعبة)
  import('./game/economy.js').then(m => m.tankAdDoubleTokens(extra)).catch(() => {});
  syncPlayerToFirestore(updated).catch(() => {});
  return { ok: true, tokens: updated.tokens, extra };
}
