// game/levels.js
// ============================================================
// 📈 نظام المستويات — مصدر الحقيقة الوحيد
//
// قاعدة الترقية (بناءً على طلب المستخدم):
//  - من المستوى 1 إلى 10 : كل 10 انتصارات (فوز بمباراة) مستوى
//  - من 11 إلى 30        : كل 20 انتصارًا مستوى
//  - من 31 إلى 50        : كل 30 انتصارًا مستوى
//  - من 51 إلى 70        : كل 40 انتصارًا مستوى
//  - بعد 70              : كل 50 انتصارًا مستوى (وهكذا...)
//
// "انتصار" هنا = رصيد التقدم الصافي: +1 عند الفوز بمباراة كاملة
// و-1 عند الخسارة (بحد أدنى صفر). الفوز بالسؤال وحده لا يرفع المستوى.
// ============================================================

export const LEVEL_BRACKETS = [
  { upTo: 10, per: 10 },
  { upTo: 30, per: 20 },
  { upTo: 50, per: 30 },
  { upTo: 70, per: 40 },
  { upTo: Infinity, per: 50 }
];

/** عدد الانتصارات (فوز بمباراة) المطلوبة للانتقال من `level` إلى `level+1` */
export function winsForLevel(level) {
  const l = Math.max(1, Math.floor(level || 1));
  for (const b of LEVEL_BRACKETS) {
    if (l <= b.upTo) return b.per;
  }
  return 50;
}

/** مجموع الانتصارات اللازمة للوصول إلى `level` (المستوى 1 = صفر) */
export function winsToReach(level) {
  const target = Math.max(1, Math.floor(level || 1));
  let total = 0;
  for (let l = 1; l < target; l++) total += winsForLevel(l);
  return total;
}

/** المستوى الحالي من مجموع الانتصارات */
export function levelFromWins(wins) {
  const w = Math.max(0, Math.floor(wins || 0));
  let level = 1;
  let remaining = w;
  while (level < 500 && remaining >= winsForLevel(level)) {
    remaining -= winsForLevel(level);
    level++;
  }
  return level;
}

/** ⚙️ اسم قديم متوافق — مُصدَّر عبر lobby.js لكل الوحدات القديمة
 *  (ui/topbar.js و ui/profile.js و game/answers.js و scene3d.js و rounds.js)
 *  المصدر الحقيقي هو levelFromWins أعلاه. */
export function getPlayerLevel(wins) {
  return levelFromWins(wins);
}

/** التقدم داخل المستوى الحالي — لأشرطة التقدم في الملف وشاشة النهاية */
export function progressInLevel(wins) {
  const level = levelFromWins(wins);
  const earned = Math.max(0, Math.floor(wins || 0)) - winsToReach(level);
  const need = winsForLevel(level);
  return {
    level,
    current: earned,
    needed: need,
    pct: Math.min(100, Math.round((earned / need) * 100))
  };
}

/** 🤖 مهارة البوت ترتفع مع المستوى — v19 (طلب المستخدم: زيادة صعوبة
 *  اللاعبين الافتراضيين): 0.62 عند المستوى 1 → سقف 0.97 — إجابات
 *  أسرع ودقة أعلى في كل المستويات (كانت 0.50 → 0.94) */
export function botSkillForLevel(level) {
  const l = Math.max(1, Math.floor(level || 1));
  return Math.min(0.97, 0.62 + (l - 1) * 0.034);
}
