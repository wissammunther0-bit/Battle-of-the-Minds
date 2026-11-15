// firestore-sync.js
// ==========================================================
// مزامنة ملف اللاعب مع Firestore (v4)
// - يستخدم setDoc({ merge: true }) — يعمل سواء كان المستند موجوداً أم لا
// - 📈 المستوى + انتصارات الأسئلة + الاسم المطبَّع (للبحث) تُحفظ دائمًا
// - التقدم كله محفوظ في قاعدة البيانات (لا يعتمد على الجهاز)
// - يحتوي على دالة تسجيل الخروج من Firebase Auth
// ==========================================================

import { ensureAuth, db, auth } from './firebase-config.js';
import { getPlayer, savePlayer } from './auth.js';
import { levelFromWins } from './game/levels.js';
import { signOut } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import {
  doc, getDoc, setDoc, deleteDoc, serverTimestamp, increment,
  collection, query, where, limit, getDocs, updateDoc
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

/* ==========================================================
 * بناء كائن البيانات الكامل للاعب
 * ========================================================== */
function buildPlayerData(player) {
  return {
    uid: player.id || '',
    name: player.name || '',
    nameLower: (player.name || '').trim().toLowerCase(),
    country: player.country || 'SA',
    lang: player.lang || 'ar',
    email: player.email || '',                          // 📧 لجوائز التبادل
    tokens: player.tokens || 0,
    gems: player.gems || 0,
    intel: player.intel || 0,                           // 🧠 جوائز الذكاء (v11)
    wins: player.wins || 0,
    losses: player.losses || 0,
    level: levelFromWins(player.wins || 0),             // 📈 المستوى (للمتصدرين)
    totalVictories: player.totalVictories || 0,         // 🏆 مجموع انتصارات الأسئلة
    // 📊 سجل اللاعب للأدمن (v11)
    correctAnswers: player.correctAnswers || 0,         // إجابات صحيحة
    wrongAnswers: player.wrongAnswers || 0,             // إجابات خاطئة
    roundsPlayed: player.roundsPlayed || 0,             // جولات لُعبت
    awardCounters: player.awardCounters
      || { toolUses: 0, wins: 0, roundsPlayed: 0, avatarsBought: 0 }, // عدّادات شروط الجوائز
    // 🛠️ v25 إصلاح: askedQuestionIds حُذفت من هنا عمدًا — مالكها الوحيد
    //    game/rotation.js (arrayUnion عند نهاية الجولة). كانت تُكتب هنا من
    //    الملف المحلي القديم فتمسح ذاكرة الدورة المُحفوظة لحظيًا بـ merge!
    equippedCharacter: player.equippedCharacter || null,
    ownedCharacters: player.ownedCharacters || [],
    boosters: player.boosters || {},                    // 🧰 أدوات يديرها المطور
    // 🆕 v6
    equippedAvatar: player.equippedAvatar || null,      // (توافق قديم)
    ownedAvatars: player.ownedAvatars || [],
    nameChangedAt: player.nameChangedAt || null,        // قفل 60 يوماً
    googleGiftClaimed: !!player.googleGiftClaimed,      // هدية الربط
    // 🎁 v14 — صندوق المكافآت وقرص الحظ (وقت الاستفادة الأخير)
    lastBoxAt: player.lastBoxAt || 0,
    lastWheelAt: player.lastWheelAt || 0,
    bagPrizes: (player.bagPrizes || []).slice(0, 30),   // 🎒 آخر ما حصل عليه
    // 🏆 v19 — طلبات جوائز المتجر (96 ساعة + 30 يومًا) والجولات المضاعفة
    prizeClaims: (player.prizeClaims || []).slice(0, 12),
    doubledRounds: (player.doubledRounds || []).slice(0, 20),
    // 🔊 v23 — إعدادات الصوت محفوظة مع بيانات اللاعب في Firebase
    //    🆕 v33.5: soundSet = هل اختار اللاعب الإعداد بنفسه؟ قبل ذلك
    //    الصوت يعمل افتراضيًا دائمًا (طلب المستخدم) ولا نسحب false القديم
    soundEnabled: player.soundEnabled !== false,
    soundSet: player.soundSet === true,
    // 🎬 v33.5 — فاصل الإعلانات: آخر لحظة حصل فيها اللاعب على محاولة عبر إعلان
    lastAdTokenAt: player.lastAdTokenAt || 0,
    // 📊 v24 — عدّادات الإدارة: تحريك العجلة + فتح الصندوق (التسلسل)
    wheelSpins: player.wheelSpins || 0,
    boxOpenCount: player.boxOpenCount || 0,
    // 🧾 v23 — تصنيف التسجيل (إحصاءات الأدمن): quick | google | linked_after_quick
    authProvider: player.authProvider || 'quick',
    linkedAfterQuick: !!player.linkedAfterQuick,
    updatedAt: serverTimestamp()
  };
}

/* ==========================================================
 * 🆔 v27 — فحص الاسم من قاعدة البيانات (فوري وعالمي)
 *   كان الفحص محليًا فقط (bqa_used_names) فبعد ضبط المصنع كان
 *   الجهاز يرفض أسماءً حُذفت نهائيًا من القاعدة. الآن الفحص
 *   العالمي يسأل مجموعة players مباشرة — وبعد ضبط المصنع
 *   المجموعة فارغة فكل الأسماء حرة فورًا على كل الأجهزة.
 * ========================================================== */
export async function isNameTakenInCloud(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return false;
  try {
    const snap = await getDocs(query(
      collection(db, 'players'),
      where('nameLower', '==', normalized),
      limit(1)
    ));
    return !snap.empty;
  } catch (e) {
    // فشل الشبكة لا يمنع التسجيل — الفحص المحلي يبقى خط الدفاع الأول
    console.warn('[NameCheck] cloud check failed:', e?.message || e);
    return false;
  }
}

/**
 * 📊 v24 — زيادة إحصائية شراء عنصر متجر (لصفحة الإدارة):
 * storeItems/{id}.stats = { buys: +1, amount: +price } — أفضل محاولة.
 * @param {string} itemId معرف العنصر
 * @param {number} amount المبلغ المُنفق (جواهر أو علامات)
 * @param {'gems'|'tokens'} cur العملة (للتوثيق فقط)
 */
export async function bumpStoreItemStats(itemId, amount, cur = 'gems') {
  try {
    await setDoc(doc(db, 'storeItems', String(itemId)), {
      stats: { buys: increment(1), amount: increment(Number(amount) || 0) },
      statsCur: cur,
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (e) {
    console.warn('[Firestore] bumpStoreItemStats:', e?.message || e);
  }
}

/* ==========================================================
 * 🚫 v26 — حجر أمني: هل هذا اللاعب محذوف؟
 *    وثيقة banned/{uid} تُكتب عند حذف اللاعب من لوحة الإدارة.
 *    أي كتابة تُنشئ وثيقة لاعب محذوف من جديد يجب أن تتوقف —
 *    (كان هذا سبب "اللاعب المحذوف يعود بعد تحديث الصفحة":
 *    المزامنة التلقائية كانت تعيد إنشاء ملف اللاعب من الذاكرة المحلية).
 *    @returns {Promise<boolean>} true = محذوف (أو تعذّر التحقق — fail-closed)
 * ========================================================== */
export async function isPlayerBlocked(uid) {
  try {
    const snap = await getDoc(doc(db, 'banned', uid));
    return snap.exists();
  } catch (e) {
    // فشل القراءة (شبكة) → لا نكتب فوق ذلك أبدًا — المزامنة ستعاد لاحقًا
    console.warn('[Firestore] isPlayerBlocked check failed:', e?.message || e);
    return true;
  }
}

/* ==========================================================
 * مزامنة كاملة: إنشاء أو تحديث آمن
 * ========================================================== */
let playerSyncQueue = Promise.resolve();

/* ==========================================================
 * 💓 v31.2 — نبض الحيوية: تحديث lastSeen دوريًا كي يظهر اللاعب
 *    في «النشط الآن» بلوحة الإدارة (نافذة 5 دقائق). نبضة كل 3
 *    دقائق وعند العودة للتبويب — ولا تكتب إن كانت الصفحة مخفية.
 * ========================================================== */
let _hbStarted = false;
function startLastSeenHeartbeat() {
  if (_hbStarted) return;
  _hbStarted = true;
  const beat = async () => {
    try {
      if (typeof document !== 'undefined' && document.hidden) return;
      const user = await ensureAuth();
      if (!user?.uid) return;
      await updateDoc(doc(db, 'players', user.uid), { lastSeen: serverTimestamp() });
    } catch (e) { console.warn('[heartbeat] lastSeen:', e?.message || e); }
  };
  setTimeout(beat, 4000);                        // أول نبضة بعد أول مزامنة
  setInterval(beat, 3 * 60 * 1000);              // كل 3 دقائق
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) beat(); });
  }
}

export function syncPlayerToFirestore(player) {
  const task = playerSyncQueue.then(async () => {
    try {
      const user = await ensureAuth();
      const ref = doc(db, 'players', user.uid);
      const snap = await getDoc(ref);

      // 🚫 v26: اللاعب محذوف من الإدارة؟ لا تُعِد إنشاء ملفه أبدًا
      if (!snap.exists() && await isPlayerBlocked(user.uid)) {
        console.warn('[Firestore] player blocked (deleted) — sync cancelled');
        return { ok: false, deleted: true };
      }

      const latestPlayer = getPlayer() || player;
      const data = buildPlayerData({ ...latestPlayer, id: user.uid });

      // 🔴 v28 — علامة زمنية لهذه الكتابة: المستمع اللحظي (liveSync)
      //    يستخدمها لتمييز صدور كتاباتنا الخاصة وتجاهلها (منع حلقة سحابة↔جهاز)
      try { window.__bqaLastWrite = Date.now(); } catch {}

      if (!snap.exists()) {
        await setDoc(ref, { ...data, createdAt: serverTimestamp() });
        console.log('[Firestore] Player created:', user.uid);
      } else {
        await setDoc(ref, data, { merge: true });
        console.log('[Firestore] Player updated:', user.uid);
      }
      // 💓 v31.2 — بدء نبض الحيوية: «النشط الآن» في لوحة الإدارة يعتمد
      //    على lastSeen الحديث (نافذة 5 دقائق) — نبضة كل 3 دقائق + عند العودة للتبويب
      startLastSeenHeartbeat();
      return { ok: true };
    } catch (e) {
      console.warn('[Firestore] syncPlayerToFirestore failed:', e);
      return { ok: false, msg: e.message };
    }
  });
  playerSyncQueue = task.then(() => undefined, () => undefined);
  return task;
}

/* ==========================================================
 * تحديث اللغة فقط — آمن ضد المستند غير الموجود
 * ========================================================== */
export async function syncLangToFirestore(lang) {
  try {
    const user = await ensureAuth();
    const ref = doc(db, 'players', user.uid);

    // 🚫 v26: لاعب محذوف؟ لا تُنشئ ملفه من جديد عبر كتابة اللغة
    if (!await playerExistsInFirestore() && await isPlayerBlocked(user.uid)) {
      console.warn('[Firestore] player blocked (deleted) — lang sync cancelled');
      return { ok: false, deleted: true };
    }

    const local = getPlayer();

    await setDoc(ref, {
      lang: lang,
      updatedAt: serverTimestamp()
    }, { merge: true });

    // إن كان لدينا بيانات محلية، أكمل مزامنة كل الملف
    if (local) {
      await syncPlayerToFirestore(local);
    }

    console.log('[Firestore] Language synced:', lang);
    return { ok: true };
  } catch (e) {
    console.warn('[Firestore] syncLangToFirestore failed:', e);
    return { ok: false };
  }
}

/* ==========================================================
 * استرجاع بيانات اللاعب من Firestore
 * ========================================================== */
export async function pullPlayerFromFirestore() {
  try {
    const user = await ensureAuth();
    const ref = doc(db, 'players', user.uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      // ℹ️ v28 — حُذف سجل «No player document yet.» (ضجيج كونسول يتكرر
      //    مع كل إقلاع لجهاز جديد) — الوثيقة ستُنشأ تلقائيًا عند التسجيل
      return null;
    }
    const data = snap.data();
    const local = getPlayer() || {};

    const merged = {
      ...local,
      id: user.uid,
      name: data.name ?? local.name,
      country: data.country ?? local.country,
      lang: data.lang ?? local.lang ?? 'ar',
      email: data.email ?? local.email ?? '',
      tokens: data.tokens ?? local.tokens,
      gems: data.gems ?? local.gems,
      intel: data.intel ?? local.intel ?? 0,
      wins: data.wins ?? local.wins,
      losses: data.losses ?? local.losses,
      totalVictories: data.totalVictories ?? local.totalVictories ?? 0,
      correctAnswers: data.correctAnswers ?? local.correctAnswers ?? 0,
      wrongAnswers: data.wrongAnswers ?? local.wrongAnswers ?? 0,
      roundsPlayed: data.roundsPlayed ?? local.roundsPlayed ?? 0,
      awardCounters: data.awardCounters ?? local.awardCounters
        ?? { toolUses: 0, wins: 0, roundsPlayed: 0, avatarsBought: 0 },
      askedQuestionIds: data.askedQuestionIds ?? local.askedQuestionIds ?? [],
      equippedCharacter: data.equippedCharacter ?? local.equippedCharacter ?? null,
      ownedCharacters: data.ownedCharacters ?? local.ownedCharacters ?? [],
      boosters: data.boosters ?? local.boosters ?? {},
      // 🆕 v6
      equippedAvatar: data.equippedAvatar ?? local.equippedAvatar ?? null,
      ownedAvatars: data.ownedAvatars ?? local.ownedAvatars ?? [],
      nameChangedAt: data.nameChangedAt ?? local.nameChangedAt ?? null,
      googleGiftClaimed: data.googleGiftClaimed ?? local.googleGiftClaimed ?? false,
      // 🎁 v14 — صندوق المكافآت وقرص الحظ
      lastBoxAt: data.lastBoxAt ?? local.lastBoxAt ?? 0,
      lastWheelAt: data.lastWheelAt ?? local.lastWheelAt ?? 0,
      bagPrizes: data.bagPrizes ?? local.bagPrizes ?? [],
      // 🏆 v19 — طلبات الجوائز والجولات المضاعفة
      prizeClaims: data.prizeClaims ?? local.prizeClaims ?? [],
      doubledRounds: data.doubledRounds ?? local.doubledRounds ?? [],
      // 🔊 v23 — استعادة إعدادات الصوت من Firebase
      //    🆕 v33.5: إن لم يكن اختيار اللاعب صريحًا (soundSet) فالصوت ON دائمًا
      //    — يصلح الحسابات القديمة التي سُجل فيها false بلا قصد اللاعب
      soundEnabled: (data.soundSet === true || local.soundSet === true)
        ? (data.soundEnabled ?? local.soundEnabled ?? true)
        : true,
      soundSet: (data.soundSet === true) || (local.soundSet === true),
      // 🎬 v33.5 — فاصل الإعلانات بين الجولات
      lastAdTokenAt: data.lastAdTokenAt ?? local.lastAdTokenAt ?? 0,
      // 📊 v24 — عدّادات الإدارة
      wheelSpins: data.wheelSpins ?? local.wheelSpins ?? 0,
      boxOpenCount: data.boxOpenCount ?? local.boxOpenCount ?? 0,
      // 🧾 v23 — تصنيف التسجيل
      authProvider: data.authProvider ?? local.authProvider ?? 'quick',
      linkedAfterQuick: data.linkedAfterQuick ?? local.linkedAfterQuick ?? false
    };
    savePlayer(merged, false);
    return merged;
  } catch (e) {
    console.warn('[Firestore] pullPlayerFromFirestore failed:', e);
    throw e;
  }
}

/* ==========================================================
 * التحقق من وجود المستند
 * ========================================================== */
export async function playerExistsInFirestore() {
  try {
    const user = await ensureAuth();
    const ref = doc(db, 'players', user.uid);
    const snap = await getDoc(ref);
    return snap.exists();
  } catch {
    return false;
  }
}

/* ==========================================================
 * حذف المستند (اختياري - للاختبار)
 * ========================================================== */
export async function deletePlayerFromFirestore() {
  try {
    const user = await ensureAuth();
    await deleteDoc(doc(db, 'players', user.uid));
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

/* ==========================================================
 * تسجيل خروج Firebase Auth
 * ========================================================== */
export async function signOutFirebase() {
  try {
    await signOut(auth);
    console.log('[Auth] Signed out from Firebase');
    return { ok: true };
  } catch (e) {
    console.warn('[Auth] signOut failed:', e);
    return { ok: false, msg: e.message };
  }
}

/* ==========================================================
 * 🚚 v33 — ترحيل/استعادة ملف اللاعب بعد دمج تعارض Google
 *  دخلنا بمعرّف Google موجود مسبقًا (تعارض بريد) — حالتان:
 *  1) له وثيقة سحابية باسم → حسابه الحقيقي القديم: نستعيده كما هو
 *     (نحفظه محليًا) ونحذف وثيقة المعرف السابق — لا كتابة فوق تقدمه!
 *  2) لا وثيقة له → نرحّل ملف اللاعب المحلي الحالي إلى المعرف الجديد
 *     ونحذف وثيقة المعرف القديم.
 *  المعرف القديم المجهول يُحذف لاحقًا من المصادقة تلقائيًا عبر
 *  Cloud Function التنظيفية (purgeOrphanAnonymousUsers).
 * @returns {{ok:boolean, restored?:boolean, player?:object, uid?:string, msg?:string}}
 * ========================================================== */
export async function migrateLocalPlayerToCurrentUid(previousUid) {
  try {
    const local = getPlayer();
    const user = await ensureAuth();

    // حذف وثيقة المعرف القديم (إن وُجدت واختلف عن الحالي)
    if (previousUid && previousUid !== user.uid) {
      await deleteDoc(doc(db, 'players', previousUid)).catch(() => {});
    }

    // هل لحساب Google الحالي وثيقة حقيقية سابقة؟
    const ref = doc(db, 'players', user.uid);
    const snap = await getDoc(ref).catch(() => null);
    if (snap?.exists() && snap.data()?.name) {
      // ✅ استعادة الحساب القديم كما هو — تقدمه أغلى من بيانات اليوم
      const cloudPlayer = { ...snap.data(), uid: user.uid };
      savePlayer(cloudPlayer, false);
      return { ok: true, restored: true, player: cloudPlayer, uid: user.uid };
    }

    // 🚚 ترحيل: ملف اللاعب المحلي (تقدمه) يكتب على المعرف الجديد
    if (!local?.name) return { ok: false, msg: 'no player' };
    await syncPlayerToFirestore(local);
    return { ok: true, migrated: true, player: local, uid: user.uid };
  } catch (e) {
    console.warn('[sync] migrateLocalPlayer:', e?.message || e);
    return { ok: false, msg: e?.message || '' };
  }
}
