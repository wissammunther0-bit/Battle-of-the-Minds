// game/bots.js
// ============================================================
// 🤖 مولّد البوتات — بوت شخصي لكل لاعب + سلّم المتصدرين المزروع
//
//  - البوت الشخصي: مستواه = مستوى اللاعب + 1 (يزداد مع ارتفاع
//    مستوى اللاعب)، ويظهر كل جولة بشخصية واسم وعلم مختلفين —
//    يبدو لاعبًا حقيقيًا تمامًا (لا شيء في الواجهة يكشفه).
//  - طلبات الصداقة المرسلة لأي بوت تُرفض تلقائيًا بعد دقيقتين
//    (autoRejectAt + ماسح دوري على جهاز المُرسل — بلا خادم).
//  - سلّم المتصدرين: 100 بوت بمستويات 70+ تتبدل بينها يوميًا
//    (بذرة التاريخ) ويختفون تدريجيًا عندما يتجاوزهم لاعبون
//    حقيقيون — حتى يسيطر الحقيقيون على القائمة كاملة.
// ============================================================

import { BOT_NAMES } from '../botNames.js';
import { getStoreItems } from '../store-catalog.js';
import { winsToReach, winsForLevel, botSkillForLevel } from './levels.js';

/* ---------- عشوائية حتمية (نفس البذرة = نفس النتيجة) ---------- */

export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BOT_COUNTRIES = [
  'SA', 'EG', 'AE', 'KW', 'QA', 'JO', 'MA', 'DZ', 'IQ', 'PS', 'LB', 'SD',
  'OM', 'BH', 'YE', 'TN', 'LY', 'US', 'GB', 'FR', 'DE', 'ES', 'IT', 'TR',
  'BR', 'MX', 'IN', 'PK', 'ID', 'MY', 'NG', 'KE', 'RU', 'UA', 'CN', 'JP',
  'KR', 'AU', 'CA'
];

function pickName(rng) {
  const pools = Object.values(BOT_NAMES);
  const pool = pools[Math.floor(rng() * pools.length)] || BOT_NAMES.en;
  const list = [...(pool.male || []), ...(pool.female || [])];
  return list[Math.floor(rng() * list.length)] || ('Player' + Math.floor(rng() * 9000 + 1000));
}

function pickCharacter(rng) {
  // 🧩 v14: البوتات تظهر بشخصيات المطور الحقيقية إن وُجدت —
  //    ولا شخصيات وهمية في الكود إطلاقًا (المعرّف نص فقط لبطاقات الملف)
  const chars = getStoreItems('characters');
  if (chars.length) return chars[Math.floor(rng() * chars.length)].id;
  return 'warrior';
}

/* ------------------- البوت الشخصي ------------------- */

/**
 * 🤖 بوت شخصي لمطابقة واحدة:
 *  - المستوى = مستوى اللاعب + 1 → المهارة وسرعة الإجابة أعلى قليلًا
 *  - هوية مختلفة كل جولة (اسم/علم/شخصية) عبر بذرة معرف الجولة
 *  - isBot: علامة داخلية للمحرك فقط — لا تُعرض في أي واجهة أبدًا
 */
export function createPersonalBot(playerLevel, seedStr) {
  const rng = mulberry32(hashSeed('bot|' + (seedStr || String(Date.now()))));
  // 🪜 أرضية المستوى 3: حتى المستوى الأول يواجه منافسًا من المستوى 3-4+
  const level = Math.max(3, (Math.floor(playerLevel) || 1) + 1);
  return {
    id: 'bot_' + Date.now().toString(36) + '_' + Math.floor(rng() * 1e6).toString(36),
    name: pickName(rng),
    country: BOT_COUNTRIES[Math.floor(rng() * BOT_COUNTRIES.length)],
    isBot: true,
    level,
    skill: botSkillForLevel(level),
    characterId: pickCharacter(rng),
    assistId: 'none'
  };
}

/* ------------------- طقم البوتات (7 لكل لاعب حقيقي) ------------------- */

/**
 * 🤖🤖 طقم بوتات كامل (7) مرتبط بمستوى اللاعب الحقيقي:
 *  - أرضية المستوى 3: أول لاعب مبتدئ يواجه بوتات من المستوى 3-4
 *    وما فوق (طلب المستخدم: "من المستوى الثالث أو الرابع") —
 *  - وكلما ارتفع مستوى اللاعب ارتفعت مستويات بوتاته تلقائيًا
 *    (p-1 … p+2) فتبقى الجولة تنافسية في كل المراحل.
 *  - يُبنى من بذرة معرف الجولة (يحمل طابعًا زمنيًا) → أسماء وأعلام
 *    وشخصيات مختلفة عشوائيًا في كل جولة جديدة — لا تكرار.
 *  - يُستخدم: 1v1 → خصم واحد عشوائي | 2v2 → زميل + خصمان |
 *    4v4 → 3 زملاء + 4 خصوم (الطقم كاملاً).
 */
export function createBotSquad(playerLevel, seedStr) {
  const rng = mulberry32(hashSeed('squad|' + (seedStr || String(Date.now()))));
  // 🪜 أرضية المستوى 3 + سقف 200
  const p = Math.max(3, Math.floor(playerLevel) || 3);
  // 🎯 v41 (فحص — مشكلة 21): إصلاح خطأ الإغلاق الذي كان يتجاهل قيم الإزاحة
  //    ويجعل كل الـ7 بوتات بنفس المستوى (level = p+2). الآن كل بوت يأخذ
  //    مستوى اللاعب + الإزاحة الخاصة به، فيتدرج الطقم تدرّجًا حقيقيًا.
  // 🎯 v41 (فحص — مشكلة 22): تدرّج متناظر حول مستوى اللاعب (±1 و ±2)
  //    بدل أن يكون الخصم دائمًا +2 — كسر التنبّه ومنح المبتدئ فرصة فوز.
  const offsets = [-1, -1, 0, 0, 1, 1, 2];
  const stamp = Date.now().toString(36);
  return offsets.map((offset) => {
    const level = Math.min(200, Math.max(1, p + offset));
    // 🎲 v41: مهارة البوت تتذبذب ±0.05 حول متوسطها لكسر التنبّه بتوقيت الإجابة
    const skillJitter = (rng() - 0.5) * 0.1;
    return {
      id: 'bot_' + stamp + '_' + Math.floor(rng() * 1e9).toString(36),
      name: pickName(rng),
      country: BOT_COUNTRIES[Math.floor(rng() * BOT_COUNTRIES.length)],
      isBot: true,
      level,
      skill: Math.max(0, botSkillForLevel(level) + skillJitter),
      characterId: pickCharacter(rng),
      assistId: 'none'
    };
  });
}

/**
 * ⚔️ v41 — التقاط بوتات مقاعد المباراة من الطقم:
 *  - زملاء الفريق: أدنى مستويات الطقم
 *  - الخصوم: اختيار عشوائي من النصف الأعلى (بدل أعلى مستوى دائمًا)
 *    → متوسط الفوز المتوقع ~50% بدل ميل منظم للخسارة
 */
export function pickSquadBots(squad, teammatesNeeded, opponentsNeeded) {
  const t = Math.max(0, teammatesNeeded | 0);
  const o = Math.max(0, opponentsNeeded | 0);
  const sorted = [...(squad || [])].sort((a, b) => a.level - b.level);
  const teammates = sorted.slice(0, t);
  // 🎯 v41: خصوم من النصف الأعلى عشوائيًا (بدل أعلى t+o دائمًا)
  const upperHalf = sorted.slice(Math.floor(sorted.length / 2));
  const opponents = [];
  const pool = [...upperHalf];
  for (let i = 0; i < o && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    opponents.push(pool.splice(idx, 1)[0]);
  }
  return [...teammates, ...opponents];
}

/* ---------------- سلّم المتصدرين المزروع ---------------- */

const LB_BOT_COUNT = 100;

/** بذرة اليوم — كلما تغيّر التاريخ تبدّلت المستويات والأسماء */
function daySeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

let _lbCache = null;
let _lbCacheDay = -1;

/**
 * 🏆 100 بوت بمستويات 70+ على شكل سلّم تنازلي مع تنويع يومي.
 * حتمي حسب التاريخ → كل الأجهزة ترى نفس القائمة دون أي كتابة
 * في قاعدة البيانات، وتتغير من تلقاء نفسها كل يوم.
 */
export function buildLeaderboardBots() {
  const seed = daySeed();
  if (_lbCache && _lbCacheDay === seed) return _lbCache;
  const rng = mulberry32(hashSeed('lb|' + seed));
  const bots = [];
  for (let i = 0; i < LB_BOT_COUNT; i++) {
    // سلّم تنازلي: القمة ~85 وتنحدر حتى ~70 مع تذبذب بسيط
    let level = 85 - Math.floor(i / 7);
    level = Math.max(70, level - (rng() < 0.3 ? 1 : 0));
    const wins = winsToReach(level) + Math.floor(rng() * winsForLevel(level));
    bots.push({
      uid: 'lb_bot_' + i,
      id: 'lb_bot_' + i,
      name: pickName(rng),
      country: BOT_COUNTRIES[Math.floor(rng() * BOT_COUNTRIES.length)],
      level,
      wins,
      losses: Math.floor(wins * (0.15 + rng() * 0.35)),
      totalVictories: wins * (7 + Math.floor(rng() * 5)),
      characterId: pickCharacter(rng),
      isSeededBot: true,
      isBot: true
    });
  }
  _lbCache = bots;
  _lbCacheDay = seed;
  return bots;
}

/** ملف بوت (شخصي أو مزروع) بلا قراءة من Firestore — حتمي من المعرف */
export function getBotProfile(uid) {
  const seeded = buildLeaderboardBots().find(b => b.uid === uid || b.id === uid);
  if (seeded) {
    return {
      uid: seeded.uid, name: seeded.name, country: seeded.country,
      level: seeded.level, wins: seeded.wins, losses: seeded.losses,
      totalVictories: seeded.totalVictories, isBot: true
    };
  }
  // بوت شخصي: هوية ثابتة من المعرف — يظهر نفسه عند إعادة فتح ملفه
  const rng = mulberry32(hashSeed('pb|' + uid));
  const level = 5 + Math.floor(rng() * 40);
  return {
    uid,
    name: pickName(rng),
    country: BOT_COUNTRIES[Math.floor(rng() * BOT_COUNTRIES.length)],
    level,
    wins: winsToReach(level) + Math.floor(rng() * 5),
    losses: Math.floor(rng() * 30),
    totalVictories: 0,
    isBot: true
  };
}

/** هل هذا المعرف لبوت؟ (شخصي أو مزروع في المتصدرين أو افتراضي مُدار) */
export function isBotUid(uid) {
  return typeof uid === 'string'
    && (uid.startsWith('bot_') || uid.startsWith('lb_bot_') || uid.startsWith('vp_'));
}
