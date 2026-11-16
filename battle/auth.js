// auth.js
// ==========================================================
// إدارة جلسة اللاعب محلياً
// ==========================================================

const STORAGE_KEY = 'bqa_player';
let playerSyncRunning = false;
let playerSyncRequested = false;
let playerSyncRetryTimer = null;

/** 🔒 تغيير الاسم مسموح مرة كل 60 يوماً */
export const NAME_CHANGE_COOLDOWN_MS = 60 * 24 * 60 * 60 * 1000;

const DEFAULT_PLAYER = {
  id: 'p_' + Math.random().toString(36).slice(2, 10),
  name: '',
  country: 'SA',
  lang: 'ar',
  email: '',
  // 🏆 v19 (طلب المستخدم): اللاعب الجديد يبدأ بـ5 علامات انتصار —
  //    كل جولة تستهلك علامة، والفوز يعيد +5 — والنفاد يفتح لوحة الإعلان
  tokens: 5,
  gems: 0,
  intel: 0,                   // 🧠 جوائز الذكاء (v11)
  wins: 0,
  losses: 0,
  correctAnswers: 0,          // 📊 سجل للأدمن
  wrongAnswers: 0,
  roundsPlayed: 0,
  // 🚩 v31 — عدادات سرعة الإجابة (كشف اللاعبين المشبوهين):
  //    fastAnswers = إجابات صحيحة خلال أقل من ثانيتين من كشف السؤال
  //    totalAnswered/answerMsSum = متوسط زمن الإجابة الفعلي
  fastAnswers: 0,
  totalAnswered: 0,
  answerMsSum: 0,
  awardCounters: { toolUses: 0, wins: 0, roundsPlayed: 0, avatarsBought: 0 },
  askedQuestionIds: [],       // 🔄 ذاكرة دورة الأسئلة
  // 🧩 v14: لا شخصية افتراضية — الشخصيات يضيفها المطور من صفحة الإدارة
  ownedCharacters: [],
  equippedCharacter: null,
  boosters: {},               // 🧰 أدوات يضيفها المطور (بلا هدايا مجانية)
  friends: [],
  pendingSent: [],
  pendingReceived: [],
  // 🆕 v6
  ownedAvatars: [],           // (توافق قديم — نفس مفهوم الشخصيات)
  equippedAvatar: null,       // (توافق قديم — نفس مفهوم الشخصيات)
  nameChangedAt: null,        // آخر تغيير اسم (قفل 60 يوماً)
  googleGiftClaimed: false,   // هل استلم هدية الربط (+10 علامات)
  // 🎁 v14 — صندوق المكافآت وقرص الحظ: آخر لحظة استفاد (ms)
  lastBoxAt: 0,
  lastWheelAt: 0,
  bagPrizes: []               // 🎒 سجل ما حصل عليه من الصندوق/القرص (للحقيبة)
};

/* ==========================================================
 * قراءة/حفظ اللاعب
 * ========================================================== */
export function getPlayer() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_PLAYER, ...JSON.parse(raw) } : null;
  } catch { return null; }
}

/* ==========================================================
 * 🎒 v32 — دفتر «الوصول» للحقيبة (Bag Arrivals Ledger)
 *  كل إضافة فعلية إلى الحقيبة (أداة +ن · شخصية جديدة · جائزة مستلمة)
 *  تزيد عدّاد الوصول بمقدار ما أُضيف — والاستهلاك أو الحذف لا يزيدان
 *  شيئًا أبدًا. شارة «جديد» على الحقيبة تُشتق من هذا العدّاد:
 *  لافتة على = عدّاد الوصول > آخر نقطة «شوهدت» (فتح الحقيبة).
 *  🐞 هذا يُصلح التنبيه الوهمي: كان الفحص القديم يقارن «بصمة» كاملة،
 *  فكان استخدام الأداة أو حذف عنصر يغيّر البصمة فيشعل اللافتة رغم
 *  أن الحقيبة لم يصلها شيء جديد (بل خسرت عنصرًا!).
 * ========================================================== */
export const K_BAG_ARRIVALS = 'ba_bag_arrivals';
export const K_BAG_SEEN_ARRIVALS = 'ba_seen_bag_arrivals';

function _bagNum(key) {
  try { return parseInt(localStorage.getItem(key) || '0', 10) || 0; } catch { return 0; }
}

/** 📥 تسجيل إضافات الحقيبة من فرق الحالتين (قبل/بعد) — يُستدعى من savePlayer
 *  فالصلة الوحيدة لكتابة اللاعب: يغطي الشراء والجوائز ومنح الإدارة والمزامنة السحابية */
function noteBagArrivals(prev, next) {
  try {
    let added = 0;
    const pb = prev?.boosters || {}, nb = next?.boosters || {};
    Object.keys(nb).forEach(k => {
      const d = (Number(nb[k]) || 0) - (Number(pb[k]) || 0);
      if (d > 0) added += d;
    });
    const pc = new Set([...(prev?.ownedCharacters || []), ...(prev?.ownedAvatars || [])]);
    [...(next?.ownedCharacters || []), ...(next?.ownedAvatars || [])].forEach(id => {
      if (id && !pc.has(id)) added++;
    });
    const prizeKey = (c) => `${c.id || c.awardId}:${c.collectedAt || 0}`;
    const pz = new Set((prev?.prizeClaims || []).filter(c => c.collectedAt).map(prizeKey));
    (next?.prizeClaims || []).filter(c => c.collectedAt).forEach(c => {
      if (!pz.has(prizeKey(c))) added++;
    });
    if (!added) return;
    localStorage.setItem(K_BAG_ARRIVALS, String(_bagNum(K_BAG_ARRIVALS) + added));
  } catch {}
}

/** 📤 استهلاك أدوات (أداة استُخدمت في الجولة أو لتغيير الاسم):
 *  «الوصول غير المشاهد» ينقص بمقدار المستهلك — فتختفي لافتة «جديد»
 *  فور استخدام الأداة حتى لو لم يفتح اللاعب الحقيبة (طلب المستخدم). */
export function noteBagConsumed(n = 1) {
  try {
    const arrivals = _bagNum(K_BAG_ARRIVALS);
    const seen = _bagNum(K_BAG_SEEN_ARRIVALS);
    const unseen = Math.max(0, arrivals - seen);
    if (unseen <= 0) return;
    localStorage.setItem(K_BAG_ARRIVALS, String(arrivals - Math.min(Number(n) || 1, unseen)));
    try { document.dispatchEvent(new CustomEvent('bagchange')); } catch {}
  } catch {}
}

export function savePlayer(player, syncToCloud = true) {
  try { noteBagArrivals(getPlayer(), player); } catch {}
  localStorage.setItem(STORAGE_KEY, JSON.stringify(player));
  if (syncToCloud) requestPlayerSync();
}

/* ==========================================================
 * 🆔 v29 — الفحص السحابي فقط (طلب المستخدم):
 *   «فقط ممنوع استخدام اسم موجود حالياً… أما إذا حذفت الحساب
 *   فطبيعي جداً أن أنشئ حساباً بنفس الاسم المحذوف».
 *   - حُذفت قائمة الأسماء المحجوزة المحلية (bqa_used_names) نهائيًا —
 *     كانت تحجب الاسم حتى بعد حذف الحساب عمدًا، فكانت سبب رسالة
 *     «هذا الاسم مستخدم سابقاً» بعد حذف اللاعب من صفحة الإدارة.
 *   - التكرار الحقيقي يمنعه الفحص من مجموعة players في Firebase
 *     (isNameTakenInCloud — يبحث بـ nameLower) — أي اسم غير موجود
 *     حالياً في القاعدة صار حراً فوراً على كل الأجهزة.
 *   - من لا اتصال بالشبكة لا يُمنع من التسجيل (أفضل محاولة).
 * ========================================================== */

/* ==========================================================
 * إنشاء لاعب جديد
 * ========================================================== */
export function createPlayer(name, country, lang = 'ar') {
  const trimmed = name.trim();
  const player = { ...DEFAULT_PLAYER, name: trimmed, country, lang, nameChangedAt: Date.now() };
  savePlayer(player);
  return { ok: true, player };
}

export function hasPlayer() {
  const p = getPlayer();
  return !!(p && p.name);
}

export function updatePlayer(partial) {
  const player = getPlayer() || { ...DEFAULT_PLAYER };
  const updated = { ...player, ...partial };
  savePlayer(updated);
  return updated;
}

function requestPlayerSync() {
  playerSyncRequested = true;
  if (playerSyncRunning) return;
  if (playerSyncRetryTimer) {
    clearTimeout(playerSyncRetryTimer);
    playerSyncRetryTimer = null;
  }

  playerSyncRunning = true;
  void (async () => {
    try {
      while (playerSyncRequested) {
        playerSyncRequested = false;
        const player = getPlayer();
        if (!player) continue;

        const { syncPlayerToFirestore } = await import('./firestore-sync.js');
        const result = await syncPlayerToFirestore(getPlayer() || player);
        if (!result?.ok) {
          playerSyncRetryTimer = setTimeout(() => {
            playerSyncRetryTimer = null;
            requestPlayerSync();
          }, 5000);
          break;
        }
      }
    } catch (e) {
      console.warn('[Player] Automatic cloud sync failed:', e);
      playerSyncRetryTimer = setTimeout(() => {
        playerSyncRetryTimer = null;
        requestPlayerSync();
      }, 5000);
    } finally {
      playerSyncRunning = false;
      if (playerSyncRequested) requestPlayerSync();
    }
  })();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', requestPlayerSync);
}

/* ==========================================================
 * 🔒 معلومات قفل تغيير الاسم (60 يوماً)
 * ========================================================== */
export function nameChangeInfo() {
  const player = getPlayer();
  if (!player) return { locked: false, remainingDays: 0 };
  if (!player.nameChangedAt) return { locked: false, remainingDays: 0 };
  const passed = Date.now() - player.nameChangedAt;
  if (passed >= NAME_CHANGE_COOLDOWN_MS) return { locked: false, remainingDays: 0 };
  const remainingMs = NAME_CHANGE_COOLDOWN_MS - passed;
  return {
    locked: true,
    remainingDays: Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)))
  };
}

export function renamePlayer(newName, country, lang) {
  const trimmed = newName.trim();
  const player = getPlayer();
  if (!player) return { ok: false, msg: 'لا يوجد لاعب' };

  // 🔒 الاسم لا يتغير إلا كل 60 يوماً (تغيير الدولة/اللغة مسموح دائماً)
  // ✏️ أداة تغيير الاسم (استهلاكية من المتجر) تتجاوز القفل (v11)
  let usedRenameToken = false;
  if (trimmed !== player.name) {
    const info = nameChangeInfo();
    if (info.locked) {
      const stock = player.boosters?.rename || 0;
      if (stock > 0) {
        // 🔓 استهلاك أداة تغيير الاسم
        usedRenameToken = true;
      } else {
        return { ok: false, nameLocked: true, remainingDays: info.remainingDays, msg: 'الاسم' };
      }
    }
    // 🆔 v29: فحص الاسم من قاعدة البيانات فقط (المستدعي يفحص السحابة
    //    قبل الاستدعاء) — لا قائمة محلية تحجب أسماء حسابات محذوفة
  }

  const updated = {
    ...player,
    name: trimmed,
    country: country ?? player.country,
    lang: lang ?? player.lang,
    // نسجل الطابع فقط عند تغيير الاسم فعلاً
    nameChangedAt: trimmed !== player.name ? Date.now() : (player.nameChangedAt ?? Date.now())
  };
  if (usedRenameToken) {
    updated.boosters = { ...(updated.boosters || {}), rename: (updated.boosters?.rename || 0) - 1 };
    noteBagConsumed(1);   // 🎒 v32 — استخدام الأداة يصفّر وصولها غير المشاهد
  }
  savePlayer(updated);
  return { ok: true, player: updated, usedRenameToken };
}

/* ==========================================================
 * تحديث اللغة فقط
 * ========================================================== */
export function setPlayerLang(lang) {
  const player = getPlayer();
  if (!player) return null;
  const updated = { ...player, lang };
  savePlayer(updated);
  return updated;
}

/* ==========================================================
 * تسجيل الخروج — يمسح بيانات اللاعب مع الحفاظ على اللغة
 * ========================================================== */
export function logoutPlayer() {
  try {
    const currentLang = localStorage.getItem('bqa_lang') || 'ar';
    // امسح ملف اللاعب فقط
    localStorage.removeItem(STORAGE_KEY);
    // أعد حفظ اللغة
    localStorage.setItem('bqa_lang', currentLang);
    // 🆔 v29 — لا قائمة أسماء محجوزة بعد الآن: الأسماء تُحجب من قاعدة
    //    البيانات فقط (الأسماء الموجودة حالياً) والمحذوف منها حر فوراً
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}