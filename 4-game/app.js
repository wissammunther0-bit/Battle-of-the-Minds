// app.js — نقطة الدخول (v6: كتالوج متجر Firestore + أسئلة الأدمن
//          + شاشة الحظر + الدعم الفني + ربط Google عبر Redirect)
import { hasPlayer, getPlayer, savePlayer, logoutPlayer } from './auth.js';
import { registerMe, sweepBotFriendRequests } from './game/social.js';
import { cleanupStaleWaitingRooms, resumeOrForfeit } from './game/presence.js';
import { checkBanStatus, invalidateBanCache } from './game/moderation.js';
import { initPlayerLiveSync } from './game/liveSync.js';
import { initFirebase, resetAuthSession } from './firebase-config.js';
import { pullPlayerFromFirestore } from './firestore-sync.js';
import { loadStoreCatalog } from './store-catalog.js';
import { loadAdminQuestions } from './questions.js';
import { initI18n, translateDOM, setLang, getLang } from './i18n.js';
import { initTopbar, refreshTopbar } from './ui/topbar.js';
import { initRegister } from './ui/register.js';
import { initLangScreen } from './ui/langScreen.js';
import { initMainMenu } from './ui/mainMenu.js';
import { initStore } from './ui/store.js';
import { initProfile, finishGoogleLinkIfNeeded, setNavigator } from './ui/profile.js';
import { initFriends } from './ui/friends.js';
import { initLobby } from './ui/lobby.js';
import { initHistory } from './ui/history.js';
import { initLeaderboard } from './ui/leaderboard.js';
import { initSupport } from './ui/support.js';
import { closeModal } from './ui/modal.js';
import { notify } from './ui/helpers.js';
import { initBadges } from './ui/badges.js';
import { loadLegalConfig, watchLegalConfig, initLegalLinks } from './ui/legal.js';
import { initAds } from './game/ads.js';
import { GameEngine } from './game/engine.js';
import { initSoundSystem, sfxTap, applySoundPrefFromPlayer, startHomeAudio } from './game/sound.js';
import { initIcons, hydrateIcons, loadIconOverrides, watchIconOverrides } from './ui/icons.js';
import { initNetWatch } from './net-watch.js';

/* ==========================================================
 * Router
 * ========================================================== */
const views = ['splash', 'lang', 'register', 'main', 'store', 'profile',
  'friends', 'lobby', 'game', 'history', 'leaderboard', 'banned'];
let currentView = 'splash';
let activeGame = null;
let banned = false; // 🚫 حالة الحظر — تُمنع كل التنقلات

export function showView(name) {
  views.forEach(v => {
    const el = document.getElementById('view-' + v);
    if (el) el.classList.toggle('active', v === name);
  });
  currentView = name;
  // 🔔 إشعار الشارات/الوحدات بأن الشاشة تغيّرت
  document.dispatchEvent(new CustomEvent('viewchange', { detail: name }));
}

export function navigate(name) {
  // 🚫 لاعب محظور: لا خروج من شاشة الحظر إلا للدعم (نافذة لا تغيّر الشاشة)
  if (banned && name !== 'banned') name = 'banned';

  if (currentView === 'friends' && name !== 'friends') {
    const inp = document.getElementById('friend-search-input');
    const res = document.getElementById('friend-search-results');
    if (inp) inp.value = '';
    if (res) res.innerHTML = '';
  }

  if (activeGame && name !== 'game') {
    activeGame.destroy(true);
    activeGame = null;
  }

  closeModal();

  if (name === 'lang') initLangScreen();
  if (name === 'main') {
    initMainMenu();
    // 🏠 v24: كل الأصوات تعمل فور أول دخول للصفحة الرئيسية
    startHomeAudio();
  }
  if (name === 'store') initStore();
  if (name === 'profile') initProfile();
  if (name === 'friends') initFriends();
  if (name === 'lobby') initLobby();
  if (name === 'history') initHistory();
  if (name === 'leaderboard') initLeaderboard();

  showView(name);
  translateDOM();
}

/* ==========================================================
 * 🏭 v26 — علامة استعادة وضع المصنع
 *   لوحة الإدارة عند الاستعادة تكتب gameMeta/factoryReset {at: Date.now()}
 *   بعد مسح كل شيء. كل جهاز يفتح اللعبة يقارن العلامة بمحلي (bqa_reset_seen):
 *   إن كانت أحدث → يمسح ملف اللاعب المحلي فورًا، ينهي جلسة Firebase
 *   المجهولة (معرّف UID جديد نظيف)، ويعيد التحميل — فيبدأ من شاشة
 *   اللغة والتسجيل كأن اللعبة جديدة تمامًا. هذا يحقق الحذف الفوري
 *   على كل الأجهزة بدون انتظار، ولا يترك الحسابات القديمة قائمة.
 * ========================================================== */
const RESET_SEEN_KEY = 'bqa_reset_seen';

async function checkFactoryReset() {
  try {
    const { ensureAuth, db, resetAuthSession } = await import('./firebase-config.js');
    const FS = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js');
    await ensureAuth();
    const snap = await FS.getDoc(FS.doc(db, 'gameMeta', 'factoryReset'));
    const at = snap.exists() ? (Number(snap.data().at) || 0) : 0;
    if (!at) return false;

    const seen = Number(localStorage.getItem(RESET_SEEN_KEY) || 0);
    if (at <= seen) return false;

    // 🛡️ سجّل العلامة أولًا — إن تعذّر الحفظ (وضع خاص/تخزين معطّل)
    //    لا نمسح إطلاقًا كي لا نعلق الجهاز في حلقة إعادة تحميل
    try { localStorage.setItem(RESET_SEEN_KEY, String(at)); }
    catch { return false; }

    // 🧹 v27 — مسح الهوية المحلية بالكامل عند كل علامة استعادة جديدة:
    //    الأسماء المحجوزة (bqa_used_names) تُمسح دائمًا حتى لو لم يوجد
    //    ملف لاعب على الجهاز — كان هذا هو سبب «الاسم موجود سابقاً» بعد
    //    ضبط المصنع: جهاز بلا ملف لاعب كان يحتفظ بقائمة الأسماء القديمة
    //    ويرفض اسمًا حُذف من قاعدة البيانات نهائيًا.
    try { localStorage.removeItem('bqa_active_round'); } catch {}
    try { localStorage.removeItem('bqa_used_names'); } catch {}

    // 🛡️ لا ملف لاعب على هذا الجهاز؟ اكتمل المسح — لا حاجة لإعادة تحميل
    if (!hasPlayer()) return false;

    try { logoutPlayer(); } catch {}
    try { await resetAuthSession(); } catch {}
    location.reload();
    return true;
  } catch (e) {
    console.warn('[reset] factory-reset check failed:', e?.message || e);
    return false;
  }
}

/* ==========================================================
 * Start Game
 * ========================================================== */
export function startGame(match) {
  if (banned) return; // 🚫 محظور لا يلعب
  navigate('game');
  // ⚔️ حاوية ساحة المواجهة (بديل حاوية الـ 3D القديمة)
  const container = document.getElementById('arena-stage');
  if (container) container.innerHTML = '';
  document.getElementById('game-overlay')?.classList.add('hidden');

  activeGame = new GameEngine({
    match,
    onEnd: () => {
      activeGame = null;
      navigate('main');
    }
  });

  activeGame.mount(container);
}

/** ⚰️ (v8) لا استئناف — أي جولة قائمة عند الإقلاع تُحتسب انسحابًا وخسارة */
async function settleAbandonedRound() {
  try {
    const res = await resumeOrForfeit();
    if (res.action === 'forfeited') {
      notify('⏳ ' + (getLang() === 'ar'
        ? 'حُسبت جولتك السابقة انسحابًا وخسارة'
        : 'Your previous round was counted as a forfeit loss'), 'warn');
    }
  } catch {}
}

/* ==========================================================
 * 🚫 فحص الحظر/التجميد — عند الإقلاع وعند كل عودة للقائمة الرئيسية
 *    + 🔴 v28: التطبيق الفوري لحالة قادمة من المستمع اللحظي
 *    (initPlayerLiveSync) — الحظر/التجميد/الرفع يصل للاعب فورًا
 *    حتى وهو داخل جولة، بلا انتظار تنقّل أو إعادة تحميل
 * ========================================================== */
let frozenActive = false; // ❄️ لاعب مجمّد عقابيًا (فترة يحددها المطور)

function applyModerationStatus(res) {
  if (res && res.banned) {
    banned = true;
    frozenActive = false;
    // 🚫 حظر نهائي (حذف الإدارة): السبب ثابت من الترجمات ولا يُقرأ من
    //    قاعدة البيانات — والعنوان يعود تلقائيًا عبر data-i18n="bannedTitle"
    // 🎮 لو داخل جولة: نخرجه بالكامل (navigate يدمّر محرك الجولة)
    if (currentView === 'game') navigate('banned');
    else showView('banned');
    translateDOM();
    return true;
  }

  // ❄️ تجميد عقابي مؤقت — شاشة الحظر بنص مختلف
  if (res && res.frozen) {
    frozenActive = true;
    // ⚠️ نعرض الشاشة ونترجم أولًا، ثم نكتب النصوص الديناميكية
    //    (لئلا يمحوها translateDOM لأن العنوان يحمل data-i18n)
    if (currentView === 'game') navigate('banned');
    else showView('banned');
    translateDOM();
    const ar = getLang() === 'ar';
    const titleEl = document.getElementById('banned-title');
    const reasonEl = document.getElementById('banned-reason');
    const days = Math.max(1, Math.ceil((res.frozenUntil - Date.now()) / 86400000));
    if (titleEl) titleEl.textContent = ar ? '❄️ حسابك مجمّد مؤقتًا' : '❄️ Account temporarily frozen';
    if (reasonEl) {
      reasonEl.textContent = ar
        ? `مدة التجميد المتبقية: ${days} يوم${res.frozenReason ? ` — السبب: ${res.frozenReason}` : ''}`
        : `Frozen for ${days} more day(s)${res.frozenReason ? ` — Reason: ${res.frozenReason}` : ''}`;
    }
    return true;
  }

  // ✅ v28 (طلب المستخدم — التحديث اللحظي): رفع الحظر/التجميد لحظيًا
  //    من لوحة الإدارة — اللاعب يخرج من شاشة الحظر فورًا بلا إعادة تحميل
  if (banned || frozenActive) {
    banned = false;
    frozenActive = false;
    invalidateBanCache();
    notify(getLang() === 'ar'
      ? 'تم رفع القيود عن حسابك — أهلًا بك مجددًا'
      : 'Restrictions lifted — welcome back', 'success');
    if (hasPlayer()) navigate('main');
    else { showView('lang'); translateDOM(); }
  }
  return false;
}

async function checkBan() {
  const res = await checkBanStatus();
  return applyModerationStatus(res);
}

/* ==========================================================
 * ✅ زر «متابعة» في شاشة الحظر — يعيد اللعبة كأنها لعبة جديدة:
 *    يمسح ملف اللاعب المحلي، وينهي جلسة Firebase المجهولة
 *    (حتى يُنشأ معرّف UID جديد نظيف بلا وثيقة حظر قديمة)،
 *    ثم يعيد تحميل الصفحة — فيبدأ التدفق من شاشة اللغة والتسجيل
 * ========================================================== */
async function resetToNewPlayerAfterBan() {
  try { logoutPlayer(); } catch {}
  try { await resetAuthSession(); } catch {}
  location.reload();
}

/* ==========================================================
 * Init — شاشة تحميل صامتة (بدون نصوص)
 * ========================================================== */
async function init() {
  initI18n();

  // 🎨 نظام الأيقونات المحلية (v13):
  //    ملء فوري بالأيقونات المدمجة، ثم فحص مجلد icons/ — إن وُجدت
  //    أيقونات المستخدم (gems.svg / start.svg ...) تُطبَّق على كل الصفحة
  hydrateIcons(document);
  initIcons().catch(() => {});
  // 🎨 v27 — تجاوزات الأيقونات من لوحة الإدارة (قراءة عند الإقلاع + مستمع لحظي:
  //    أي تغيير أيقونة/شخصية افتراضية من لوحة الأدمن يصل لكل الأجهزة فورًا)
  loadIconOverrides().catch(() => {});
  watchIconOverrides();
  // 📜 v30 — نصوص الشروط والخصوصية (قراءة عند الإقلاع + مستمع لحظي:
  //    أي تعديل من قسم الإعدادات في اللوحة يصل للاعبين فورًا) + روابط الشاشات
  loadLegalConfig().catch(() => {});
  watchLegalConfig();
  initLegalLinks();
  // 🎬 v31 — نظام الإعلانات AdMob (إعدادات الإدارة + مستمع لحظي:
  //    مفتاح التشغيل ووضع الاختبار والمفاتيح الحقيقية تصل فورًا
  //    من لوحة الإدارة بلا إعادة بناء التطبيق)
  initAds().catch(() => {});
  // 📡 v27 — شاشة انقطاع الإنترنت التفاعلية (زر إعادة المحاولة + عودة تلقائية)
  initNetWatch();

  // 🔴 v28 — التحديث اللحظي لجهة اللاعب (طلب المستخدم):
  //    الحظر/التجميد/رفع القيود + المتغيرات (جواهر/علامات/أدوات/شخصيات)
  //    + علامة استعادة المصنع — كلها تصل فورًا بلا إعادة تحميل الصفحة
  initPlayerLiveSync({ onModeration: applyModerationStatus });
  window.addEventListener('factoryreset', () => { checkFactoryReset().catch(() => {}); });

  // 🔊 نظام الأصوات — يهيّئ نفسه عند أول لمسة (سياسة المتصفحات)
  //    ويحلّق النقر العام على الأزرار (sound1)
  initSoundSystem();
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, .opt, [data-nav], .dock-btn, .store-card');
    if (t && !t.classList.contains('opt')) sfxTap();
  }, { passive: true });

  showView('splash');
  translateDOM();

  const splashProgress = document.getElementById('splash-progress');
  const updateProgress = (percent) => {
    if (splashProgress) splashProgress.style.width = percent + '%';
  };

  // ✅ زر «متابعة» في شاشة الحظر — v25 إصلاح حرج:
  //    كان التسجيل يحدث في أسفل init() بعد سطر `if (await checkBan()) return;`
  //    — أي أن اللاعب المحظور يرى الشاشة دون زر يعمل أبدًا (الطلب المباشر).
  //    الآن يُسجّل المعالج أولًا قبل أي عودة مبكرة من init.
  //    السلوك: يمسح ملف اللاعب المحلي، وينهي جلسة Firebase المجهولة
  //    (لا معرّف UID جديد نظيف بلا وثيقة حظر قديمة)، ثم يعيد تحميل
  //    الصفحة — فيبدأ التدفق من شاشة اللغة والتسجيل كلاعب جديد.
  const bannedCont = document.getElementById('btn-banned-continue');
  if (bannedCont) {
    bannedCont.onclick = () => {
      try { sfxTap(); } catch {}
      resetToNewPlayerAfterBan();
    };
  }

  try {
    updateProgress(15);
    await initFirebase();
    updateProgress(30);

    // 🏭 v26: استعادة وضع المصنع؟ (يُمسح الجهاز محليًا ويبدأ من جديد)
    if (await checkFactoryReset()) return;

    // ☁️ Firebase هو المصدر الأساسي: استعد التقدم قبل تحديد شاشة البداية.
    let cloudReadSucceeded = false;
    let cloudPlayer = null;
    try {
      let restoreTimeout;
      cloudPlayer = await Promise.race([
        pullPlayerFromFirestore(),
        new Promise((_, reject) => {
          restoreTimeout = setTimeout(() => reject(new Error('Cloud restore timed out')), 8000);
        })
      ]).finally(() => clearTimeout(restoreTimeout));
      cloudReadSucceeded = true;
      if (cloudPlayer?.lang) setLang(cloudPlayer.lang);
      // 🔊 استعادة إعدادات الصوت من Firebase (v23)
      applySoundPrefFromPlayer();
    } catch (e) {
      console.warn('Cloud player restore failed; keeping the local cache for this session:', e);
    }
    if (cloudReadSucceeded && !cloudPlayer && hasPlayer()) {
      // ترحيل الحسابات القديمة إلى Firebase بعد التأكد من نجاح قراءة المستند.
      // إذا فشل الاتصال، لا نرفع ذاكرة محلية قديمة فوق بيانات السحابة.
      const player = getPlayer();
      if (player) savePlayer(player);
    }

    // 🔗 إكمال ربط Google عبر Redirect (إن بدأ من جهاز حجب النوافذ)
    finishGoogleLinkIfNeeded().catch(() => {});

    // 🛒 كتالوج المتجر + 🆕 أسئلة الأدمن (خلفية — لا تعطل الإقلاع)
    loadStoreCatalog().catch(() => {});
    loadAdminQuestions().catch(() => {});

    if (hasPlayer()) {
      updateProgress(50);

      // 🚫 الحظر قبل أي شيء — اللاعب المحظور يرى شاشة الحظر فقط
      if (await checkBan()) return;

      try {
        await registerMe(getPlayer());            // 🪪 تسجيلي في دليل اللاعبين
        cleanupStaleWaitingRooms().catch(() => {}); // 🧹 لا غرف انتظار يتيمة
        sweepBotFriendRequests().catch(() => {});   // 🤖 رفض طلبات البوتات المستحقة
      } catch (e) {
        console.warn('Register failed:', e);
      }
      initBadges();                                 // 🔴 شارات الأصدقاء/المتجر
      initSupport();                                // 🛠️ مستمع ردود الدعم
      updateProgress(90);
    } else {
      updateProgress(60);
    }

    document.querySelectorAll('[data-nav]').forEach(btn => {
      btn.onclick = () => navigate(btn.dataset.nav);
    });

    setNavigator(navigate);          // 🧭 موجّه الشاشات لصورة الملف (متجر الشخصيات)
    initTopbar();
    initRegister();
    initLobby();
    initLangScreen();
    translateDOM();

    // 🚫 فحص دوري خفيف للحظر عند العودة للقائمة الرئيسية
    document.addEventListener('viewchange', (e) => {
      if (e.detail === 'main' && hasPlayer()) {
        checkBan().catch(() => {});
        // 🏭 v26: فحص علامة الاستعادة أيضًا — الجهاز المفتوح أثناء
        //    استعادة المصنع يُمسح محليًا ويعيد التحميل تلقائيًا
        checkFactoryReset().catch(() => {});
      }
    });

    window.addEventListener('langchange', () => {
      translateDOM();
      if (currentView !== 'lang' && currentView !== 'register' && currentView !== 'game' && currentView !== 'splash') {
        navigate(currentView);
      }
    });

    // 🎨 v27 — عند وصول أيقونة جديدة من لوحة الإدارة: أعِد رسم الشاشة
    //    الحالية (كما يحدث مع تغيير اللغة) — الجولة المفتوحة لا تُمسّ
    window.addEventListener('iconschange', () => {
      hydrateIcons(document);
      try { refreshTopbar(); } catch {}    // الشريط العلوي + الشخصية الافتراضية
      if (currentView !== 'game' && currentView !== 'splash') {
        navigate(currentView);
      }
    });

    updateProgress(100);

    setTimeout(async () => {
      if (hasPlayer()) {
        navigate('main');

        // ⚰️ تسوية الجولة المهجورة: من انسحب خسر نهائيًا — لا عودة
        settleAbandonedRound();
      } else {
        showView('lang');
        translateDOM();
      }
    }, 800);

  } catch (e) {
    console.error('Init error:', e);
    updateProgress(100);
    setTimeout(() => {
      showView('lang');
      translateDOM();
    }, 1500);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
