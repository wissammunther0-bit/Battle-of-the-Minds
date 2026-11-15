// admin/admin.js — v24 (إعادة بناء كاملة بطلب المستخدم)
// ============================================================
// 🛡️ لوحة تحكم المطور — Admin Console
//
// الأقسام (بدل "نظرة عامة" — القسم الرئيسي هو إدارة العبة):
//   🎮 إدارة العبة · 👥 اللاعبون الحقيقيون · 🛠️ رسائل الدعم
//   🛒 المتجر (الشخصيات + الأدوات) · 🎁 الجوائز والخزنة
//   🎬 الإعلانات · 🤖 اللاعبون الافتراضيون · ❓ الأسئلة · 🌍 اللغات
//
// الدخول: حساب Firebase (بريد/كلمة مرور) + يجب أن يكون UID
// في مجموعة admins (تُضاف يدوياً من Firebase Console مرة واحدة).
// ============================================================

import { auth, db } from '../firebase-config.js';
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, query, where, orderBy, limit, getDocs,
  serverTimestamp, getCountFromServer, arrayUnion, arrayRemove, Timestamp,
  onSnapshot, increment, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
// 🎨 v27 — سجل الأيقونات المدمجة نفسه (للمعاينة في قسم التحكم بالأيقونات)
import { ICONS } from '../ui/icons.js';
// 💰 v29 — إعادة موارد اللاعب المحذوف إلى الخزنة الرئيسية (حركة اقتصادية موحدة)
import { tankPlayerDeleted } from '../game/economy.js';

/* ======================= أدوات عامة ======================= */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** 🛡️ v27 — استدعاء آمن لأي دالة تحميل: مهما أعادت (وعد أو undefined
 *  أو دالة) لا تكسر الصفحة — يُصلح خطأ
 *  "Cannot read properties of undefined (reading 'catch')" في switchTab */
function safe(fn) {
  try {
    const r = fn();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch (e) { console.warn('safe():', e); }
}

let toastTimer = null;
function toast(msg, cls = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast ' + cls;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

function dlgOpen(title, bodyHTML, actionsHTML) {
  $('dlg-title').textContent = title;
  $('dlg-body').innerHTML = bodyHTML;
  $('dlg-actions').innerHTML = actionsHTML;
  $('dlg').classList.remove('hidden');
  $('dlg-actions').querySelectorAll('[data-dlg-cancel]').forEach(b => b.onclick = dlgClose);
}
function dlgClose() { $('dlg').classList.add('hidden'); }

function fmtTime(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
    if (!d) return '—';
    return d.toLocaleDateString('ar') + ' ' + d.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

function timeAgo(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : null;
    if (!d) return '—';
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'الآن';
    if (mins < 60) return `قبل ${mins} د`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `قبل ${hours} س`;
    return `قبل ${Math.floor(hours / 24)} ي`;
  } catch { return '—'; }
}

function showMsg(id, text, ok) {
  const el = $(id);
  el.textContent = text;
  el.className = 'form-msg ' + (ok ? 'ok' : 'err');
  setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 4000);
}

const dayKey = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/* ======================= 🌐 لغة صفحة الإدارة ======================= */
const ADMIN_I18N = {
  ar: {},
  en: {
    loginTitle: 'Developer Control Panel',
    email: 'Email', password: 'Password', login: 'Sign in',
    loginNote: 'Developers only — requires an account listed in the admins collection.',
    logout: 'Exit',
    tabGame: 'Game Management', tabPlayers: 'Real Players', tabSupport: 'Support Inbox',
    tabStore: 'Store', tabRewards: 'Rewards & Vault', tabAds: 'Ads',
    tabVbots: 'Virtual Players', tabQuestions: 'Questions', tabLangs: 'Languages',
    tabSettings: 'Settings', tabIcons: 'Icons',
    gmTotal: 'Total real players', gmToday: 'Joined today', gmOnline: 'Online now',
    gmBanned: 'Banned', gmUnread: 'Unread support msgs', gmAdsToday: 'Ads watched today',
    regClassTitle: 'Real players — registration type',
    secNote: 'Security reminder'
  }
};
let adminLang = 'ar';
try { adminLang = localStorage.getItem('ba_admin_lang') || 'ar'; } catch {}

function applyAdminLang() {
  document.documentElement.lang = adminLang;
  document.documentElement.dir = adminLang === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n-admin]').forEach(el => {
    const key = el.getAttribute('data-i18n-admin');
    const dict = ADMIN_I18N[adminLang] || {};
    const val = dict[key];
    if (!val) return;
    // 🔸 نستبدل أول عقدة نصية فقط — حتى لا نمسح الحقول داخل الوسم
    const firstText = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
    if (firstText) firstText.textContent = val;
    else el.textContent = val;
  });
}

$('admin-page-lang').value = adminLang;
$('admin-page-lang').onchange = async () => {
  adminLang = $('admin-page-lang').value;
  try { localStorage.setItem('ba_admin_lang', adminLang); } catch {}
  try { await setDoc(doc(db, 'gameMeta', 'adminUI'), { lang: adminLang, updatedAt: serverTimestamp() }, { merge: true }); } catch {}
  applyAdminLang();
};

/* ======================= الجلسة ======================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) { showLogin(); return; }
  try {
    const ref = await getDoc(doc(db, 'admins', user.uid));
    if (ref.exists()) {
      showPanel();
    } else {
      await signOut(auth);
      loginError('هذا الحساب ليس في قائمة admins — أضف وثيقة بمعرّف ' + user.uid + ' إلى مجموعة admins');
    }
  } catch (e) {
    loginError('تعذر التحقق: ' + (e?.message || e));
  }
});

function loginError(msg) {
  const el = $('login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showLogin() {
  $('login-screen').classList.add('active');
  $('panel-screen').classList.remove('active');
}

function showPanel() {
  $('login-screen').classList.remove('active');
  $('panel-screen').classList.add('active');
  applyAdminLang();
  loadGameStats().catch(() => {});
  loadTankSummary().catch(() => {});
  startLiveWatchers();
  // 🔴 v27 (طلب المستخدم): التحديث اللحظي في **كل** القوائم فور فتح
  //    صفحة الإدارة — بلا انتظار فتح القسم: لاعب جديد يسجّل من جهاز
  //    ثاني يظهر مباشرة في القائمة، وكل تغيير يتحدّث لحظيًا
  startPlayersLive();      // 👥 قائمة اللاعبين الحقيقيين لحظية من الدخول
  // 🛠️ v41: حُذف الدعم الفني بالكامل — لا startSupportLive (المجموعة محظورة في القواعد)
  safe(loadQuestions);     // ❓ الأسئلة لحظية من الدخول
  safe(startIconsLive);    // 🎨 قائمة الأيقونات لحظية من الدخول
  safe(loadLangStats);     // 🌍 إحصائية اللغات
  safe(loadRewardsAll);    // 🎁 الجوائز والخزنة (عجلة/صندوق/متجر الجوائز)
  repairMissingLastSeen().catch(() => {});
  sweepOldSupport().catch(() => {});
}

$('btn-admin-login').onclick = async () => {
  const email = $('admin-email').value.trim();
  const pass = $('admin-pass').value;
  if (!email || !pass) { loginError('أدخل البريد وكلمة المرور'); return; }
  $('btn-admin-login').disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    loginError('بيانات الدخول غير صحيحة أو حدث خطأ: ' + (e?.code || e?.message || e));
  }
  $('btn-admin-login').disabled = false;
};

$('btn-admin-logout').onclick = () => { stopLiveWatchers(); signOut(auth).then(showLogin); };

/* ======================= التنقل بين الأقسام ======================= */
document.querySelectorAll('.pt-tab').forEach(btn => {
  btn.onclick = () => switchTab(btn.dataset.tab);
});
document.querySelectorAll('[data-goto]').forEach(btn => {
  btn.onclick = () => switchTab(btn.dataset.goto);
});

function switchTab(tab) {
  document.querySelectorAll('.pt-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
  const page = $('tab-' + tab);
  if (page) page.classList.add('active');
  try { localStorage.setItem('ba_admin_tab', tab); } catch {}

  // 🛡️ v27: كل الاستدعاءات عبر safe() — لا يوجد .catch على undefined
  if (tab === 'game') { safe(loadGameStats); safe(loadTankSummary); }
  if (tab === 'players' && !playersLoaded) safe(loadRecentPlayers);
  // 🛠️ v41: حُذف الدعم الفني — استُبدل بتبويب الإبلاغات
  if (tab === 'reports') safe(loadReports);
  if (tab === 'store') safe(loadStoreAll);
  if (tab === 'rewards') safe(loadRewardsAll);
  if (tab === 'ads') { safe(loadAds); safe(loadAdsSettings); }
  if (tab === 'vbots') { safe(loadVbots); safe(loadVbForm); }
  if (tab === 'questions') safe(loadQuestions);
  if (tab === 'langs') safe(loadLangStats);
  if (tab === 'icons') safe(renderIconsAdmin);   // 🎨 قسم الأيقونات (v27)
  if (tab === 'settings') safe(loadLegalEditor); // 📜 نصوص الشروط والخصوصية (v30)
}

/* ==========================================================
 * 🔴 التحديث اللحظي — v25 (طلب المستخدم): كل الأقسام تتحدث لحظيًا
 *    بلا تحديث الصفحة: العدادات · الخزان · المتجر · الجوائز والعجلة
 *    والصندوق · الإعلانات · اللاعبون الافتراضيون · الأسئلة · اللغات
 * ========================================================== */
let _ovInterval = null;
let _unsubs = [];

/** 🛡️ لا تُعِد رسم قسمًا فيه حقل يُحرَّر الآن (حتى لا يفقد الأدمن كتابته) */
function sectionBusy(sectionId) {
  const sec = $('tab-' + sectionId);
  if (!sec) return true;
  const ae = document.activeElement;
  return !!(ae && sec.contains(ae));
}

function startLiveWatchers() {
  stopLiveWatchers();

  // 🛠️ v41: حُذف مستمع رسائل الدعم الفني (المجموعة محظورة في القواعد) —
  //    استُبدل بمستمع الإبلاغات (reports) في تبويب الإبلاغات
  _unsubs.push(onSnapshot(
    query(collection(db, 'reports'), where('handled', '!=', true)),
    s => {
      const n = s.size;
      const badge = $('tab-reports-count');
      if (badge) {
        if (n > 0) { badge.textContent = n; badge.classList.remove('hidden'); }
        else badge.classList.add('hidden');
      }
    }, () => {}));

  // 🏦 الخزان الرئيسي — لحظي: يغذي إدارة العبة + الجوائز + الإعلانات دفعة واحدة
  _unsubs.push(onSnapshot(TANK_DOC(), (snap) => {
    const d = snap.exists() ? snap.data() : {};
    renderTankSummary(d);
    renderVault(d);
    renderAds(d);
  }, (e) => { console.warn('tank listener:', e); loadTankSummary().catch(() => {}); }));

  // 🎡 العجلة + 🎁 الصندوق — لحظي (بحماية حقول التحرير)
  _unsubs.push(onSnapshot(doc(db, 'storeMeta', 'wheel'), (snap) => {
    if (sectionBusy('rewards')) return;
    if (!snap.exists()) return;
    const d = snap.data();
    $('wheel-enabled').checked = d.enabled !== false;
    $('wheel-interval').value = String(d.intervalMinutes || 60);
    const slots = (Array.isArray(d.slots) && d.slots.length >= 2)
      ? d.slots.map((s, i) => ({ ...s, percent: Number.isFinite(Number(s.percent)) ? s.percent : (WHEEL_PERCENTS[i] ?? 50) }))
      : defaultWheelSlots();
    renderWheelSlotRows(slots);
  }, () => {}));
  _unsubs.push(onSnapshot(doc(db, 'storeMeta', 'box'), (snap) => {
    if (sectionBusy('rewards')) return;
    if (!snap.exists()) return;
    const d = snap.data();
    $('box-enabled').checked = d.enabled !== false;
    $('box-interval').value = String(d.intervalMinutes || 60);
    renderBoxRewardRows(Array.isArray(d.rewards) && d.rewards.length ? d.rewards : defaultBoxRewards());
  }, () => {}));

  // 🛒 المتجر — لحظي (الشخصيات + الأدوات + إصدار المتجر)
  _unsubs.push(onSnapshot(
    query(collection(db, 'storeItems'), orderBy('createdAt', 'desc'), limit(120)),
    (snap) => {
      _storeItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _storeItems.forEach(it => { _itemCache[it.id] = it; });
      renderCharactersAdmin();
      renderToolsAdmin();
      renderVbCharGrid();            // 🤖 شبكة شخصيات نموذج اللاعب الافتراضي
    },
    (e) => { console.warn('store listener:', e); loadStoreAll().catch(() => {}); }));
  _unsubs.push(onSnapshot(doc(db, 'storeMeta', 'version'), (snap) => {
    const el = $('store-ver');
    if (el) el.textContent = snap.exists() ? ('v' + (snap.data().v || 2)) : '—';
  }, () => {}));

  // 📜 الشروط والخصوصية — لحظي (تحديث حقول التحرير إن لم يكتب الأدمن الآن)
  _unsubs.push(onSnapshot(doc(db, 'gameMeta', 'legal'), (snap) => {
    if (sectionBusy('settings')) return;
    if (!snap.exists()) return;
    const d = snap.data();
    const termsEl = $('legal-terms');
    const privEl = $('legal-privacy');
    if (termsEl && !termsEl.value.trim()) termsEl.value = String(d.terms || '');
    if (privEl && !privEl.value.trim()) privEl.value = String(d.privacy || '');
  }, () => {}));

  // 🎁 متجر الجوائز — لحظي
  _unsubs.push(onSnapshot(
    query(collection(db, 'awards'), orderBy('createdAt', 'desc'), limit(60)),
    (snap) => renderAwardsAdmin(snap.docs),
    (e) => { console.warn('awards listener:', e); loadAwardsAdmin().catch(() => {}); }));

  // 🤖 اللاعبون الافتراضيون — لحظي (القائمة + الإجماليات)
  _unsubs.push(onSnapshot(
    query(collection(db, 'virtualPlayers'), limit(300)),
    (snap) => renderVbots(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (e) => { console.warn('vbots listener:', e); loadVbots().catch(() => {}); }));

  // 👥 عدادات إدارة العبة — احتياط دوري كل 8 ثوانٍ (المصدر اللحظي الأول
  //    هو لقطة اللاعبين في syncPlayerCounters)
  // 🛠️ v37 — حارس حصة القراءة: استعلامات العدّ تُحسب قراءات، والحلقة
  //    السابقة كانت كل 8 ثوانٍ × 4 عدّادات ≈ 43–90 ألف قراءة/يوم —
  //    السبب الأول لاستنفاد 50 ألف قراءة (صور المستخدم 98/99:
  //    RunAggregationQuery resource-exhausted + 429 Too Many Requests).
  //    الآن: كل دقيقتين + إيقاف تام عند إخفاء التبويب + تراجع تلقائي
  //    عند استنفاد الحصة بدل ضرب الخادم بـ429 طوال اليوم.
  let _quotaExhausted = false;
  const _countOnce = async (id, q) => {
    try {
      $(id).textContent = (await getCountFromServer(q)).data().count;
    } catch (e) {
      if (String(e?.code || e?.message || '').includes('resource-exhausted') && !_quotaExhausted) {
        _quotaExhausted = true;
        clearInterval(_ovInterval);
        toast('⚠️ استُنفدت حصة قراءة Firestore اليومية (50 ألف) — عُدّادات النظرة العامة متوقفة حتى إعادة الضبط عند منتصف الليل بتوقيت المحيط الهادئ. للعمل بلا انقطاع: فعّل خطة Blaze من Console أو قلّل فتح اللوحة لفترات قصيرة.', 'err');
        console.warn('[admin] quota exhausted — counters paused:', e?.code || e?.message);
      }
    }
  };
  const refreshCounts = async () => {
    if (document.hidden || _quotaExhausted) return;   // 🆕 v37 — لا قراءات والتبويب مخفي
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    _countOnce('gm-players', query(collection(db, 'players')));
    _countOnce('gm-banned', query(collection(db, 'players'), where('banned', '==', true)));
    _countOnce('gm-online', query(collection(db, 'players'),
      where('lastSeen', '>', new Date(Date.now() - 5 * 60 * 1000))));
    _countOnce('gm-today', query(collection(db, 'players'), where('createdAt', '>', startToday)));
    await Promise.resolve();
  };
  refreshCounts().catch(() => {});
  _ovInterval = setInterval(() => refreshCounts().catch(() => {}), 120000);
  _unsubs.push({ call: () => clearInterval(_ovInterval) });
}

function stopLiveWatchers() {
  _unsubs.forEach(u => { try { u.call ? u.call() : u(); } catch {} });
  _unsubs = [];
  if (playersUnsub) { playersUnsub(); playersUnsub = null; }
  if (questionsUnsub) { questionsUnsub(); questionsUnsub = null; }
  if (supportUnsub) { supportUnsub(); supportUnsub = null; }
  if (iconsUnsub) { iconsUnsub(); iconsUnsub = null; }   // 🎨 v27
}

/* ==========================================================
 * 🎮 إدارة العبة — العدادات الكلية + تصنيف التسجيل + الخزان
 * ========================================================== */
async function loadGameStats() {
  const countOf = async (q) => { try { return (await getCountFromServer(q)).data().count; } catch { return '—'; } };
  const c = () => collection(db, 'players');
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);

  $('pl-quick').textContent = await countOf(query(c(), where('authProvider', '==', 'quick')));
  $('pl-linked').textContent = await countOf(query(c(), where('authProvider', '==', 'google'), where('linkedAfterQuick', '==', true)));
  $('pl-google').textContent = await countOf(query(c(), where('authProvider', '==', 'google'), where('linkedAfterQuick', '==', false)));
  $('pl-total-real').textContent = await countOf(query(c()));
}

async function loadTankSummary() {
  try {
    const snap = await getDoc(doc(db, 'gameMeta', 'tank'));
    renderTankSummary(snap.exists() ? snap.data() : {});
  } catch {}
}

/** 🔴 v25 — رسم ملخص الخزان من بيانات جاهزة (يُستدعى لحظيًا من المستمع) */
function renderTankSummary(d = {}) {
  const tokens = Math.max(0, Number(d.tankTokens) || 0);
  const gems = Math.floor(tokens / 5);
  $('gk-tokens').textContent = tokens;
  $('gk-gems').textContent = gems;
  $('gk-intel').textContent = Math.floor(gems / 100);
  $('gk-ads').textContent = d.adsViewed || 0;
  // 🐞 v32 — بطاقة «إعلانات شوهدت اليوم» في إدارة العبة كانت تبقى «—»
  //    للأبد (لم يكن هناك من يكتبها) — الآن من خريطة اليوم نفسها
  const t = d.adsToday || {};
  const gmAds = $('gm-ads-today');
  if (gmAds) gmAds.textContent = (t.date === dayKey()) ? (t.total || 0) : 0;
}
$('btn-gk-refresh').onclick = () => { loadGameStats().catch(() => {}); loadTankSummary().catch(() => {}); toast('تم تحديث العدادات ✓', 'ok'); };

/* ==========================================================
 * 👥 اللاعبون الحقيقيون — قائمة لحظية + ترقيم 50 + بحث وفترة
 * ========================================================== */
const PAGE_SIZE = 50;
let playersLoaded = false;
let playersUnsub = null;
let _playersLatest = [];
let _page = 0;

function startPlayersLive() {
  if (playersUnsub) playersUnsub();
  playersLoaded = true;
  playersUnsub = onSnapshot(
    query(collection(db, 'players'), limit(1000)),
    (snap) => {
      // 🐞 v32 — كان الترتيب { uid: d.id, ...d.data() } فيطغى حقل uid القديم
      //    المكتوب داخل الوثيقة (مثل 'p_xxxx' العشوائي من نسخ قديمة) على معرّف
      //    الوثيقة الحقيقي — فكان الحظر/الحذف/التجميد/المحادثة تستهدف وثيقة
      //    غير موجودة، فيبدو أن اللاعب المحذوف «يعود» = الحسابات المتكررة.
      //    الآن uid = معرّف الوثيقة دائمًا + نصلح الحقل القديم في القاعدة.
      _playersLatest = snap.docs.map(d => ({ ...d.data(), uid: d.id }));
      _playersLatest.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      _repairStaleUids(snap.docs);
      syncPlayerCounters();
      renderPlayers();
      renderCountryBars();
    },
    (e) => { console.warn('players listener:', e); loadPlayersOnce(); }
  );
}

/** 🛠️ v32 — ترحيل لمرة واحدة لكل وثيقة: وثائق كتبتها نسخ قديمة وفيها حقل
 *  uid محلي عشوائي ('p_xxxx') — نطابقه مع معرّف الوثيقة الحقيقي حتى تعمل
 *  كل عمليات الإدارة على الوثيقة الصحيحة (أفضل محاولة، لا يعطل القائمة). */
const _uidRepairInFlight = new Set();
function _repairStaleUids(docs) {
  (docs || []).forEach(d => {
    const val = d.data()?.uid;
    if (val === d.id || _uidRepairInFlight.has(d.id)) return;
    _uidRepairInFlight.add(d.id);
    updateDoc(doc(db, 'players', d.id), { uid: d.id })
      .then(() => console.log('[Repair] uid field fixed:', d.id))
      .catch((e) => console.warn('[Repair] uid fix skipped:', d.id, e?.message || e))
      .finally(() => _uidRepairInFlight.delete(d.id));
  });
}

async function loadPlayersOnce() {
  try {
    const snap = await getDocs(query(collection(db, 'players'), limit(1000)));
    // 🐞 v32 — نفس إصلاح الترتيب (uid = معرّف الوثيقة دائمًا)
    _playersLatest = snap.docs.map(d => ({ ...d.data(), uid: d.id }));
    _playersLatest.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    _repairStaleUids(snap.docs);
    syncPlayerCounters();
    renderPlayers();
    renderCountryBars();
  } catch (e) { toast('خطأ: ' + e.message, 'err'); }
}

async function loadRecentPlayers() {
  startPlayersLive();
  return loadPlayersOnce();
}

async function repairMissingLastSeen() {
  try {
    const snap = await getDocs(query(collection(db, 'players'), limit(500)));
    const missing = snap.docs.filter(d => !d.data().lastSeen);
    if (!missing.length) return;
    // 🛡️ v31.2 — لكل وثيقة على حدة: وثيقة فيها حقل image ضخم (>1MB) تفشل
    //    أي كتابة عليها — نتخطاها دون تعطيل إصلاح البقية (كان Promise.all يفشل كله)
    for (const d of missing) {
      const img = String(d.data().image || '');
      if (img.length > 700 * 1024) {
        console.warn('repair lastSeen: تخطي وثيقة بحقل image كبير:', d.id);
        continue;
      }
      try { await updateDoc(doc(db, 'players', d.id), { lastSeen: serverTimestamp() }); }
      catch (e) { console.warn('repair lastSeen:', d.id, e?.message || e); }
    }
  } catch (e) { console.warn('repair lastSeen:', e); }
}

function syncPlayerCounters() {
  const list = _playersLatest;
  $('pl-total').textContent = list.length;
  const today = dayKey();
  $('pl-today').textContent = list.filter(p => {
    const ms = p.createdAt?.toMillis?.() || 0;
    return ms && new Date(ms).toISOString().slice(0, 10) === today;
  }).length;
  $('pl-online').textContent = list.filter(p =>
    p.lastSeen && (Date.now() - p.lastSeen.toDate().getTime() < 5 * 60 * 1000)).length;
  $('pl-banned').textContent = list.filter(p => p.banned).length;
  $('gm-players').textContent = list.length;
  $('gm-banned').textContent = list.filter(p => p.banned).length;
  $('gm-online').textContent = list.filter(p =>
    p.lastSeen && (Date.now() - p.lastSeen.toDate().getTime() < 5 * 60 * 1000)).length;
  $('gm-today').textContent = $('pl-today').textContent;

  // 🔴 v25 لحظي: تصنيف التسجيل (إدارة العبة) من نفس اللقطة
  const q = (f) => list.filter(f).length;
  const setIf = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  setIf('pl-quick', q(p => p.authProvider === 'quick'));
  setIf('pl-linked', q(p => p.authProvider === 'google' && p.linkedAfterQuick === true));
  setIf('pl-google', q(p => p.authProvider === 'google' && p.linkedAfterQuick === false));
  setIf('pl-total-real', list.length);

  // 🔴 v25 لحظي: إحصائية اللغات (تبويب اللغات) + مجموع علامات الحقيقيين (الافتراضيون)
  renderLangStatsFromPlayers();
  // 🆕 v27 — مجموع علامات الانتصار لجميع اللاعبين الحقيقيين:
  //    يظهر في الخزنة الرئيسية (tk-real-tokens) + تبويب الافتراضيون
  const realTokensSum = list.reduce((a, p) => a + (Number(p.tokens) || 0), 0);
  const sumEl = $('vb-real-tokens-sum');
  if (sumEl) sumEl.textContent = realTokensSum;
  const tkRealEl = $('tk-real-tokens');
  if (tkRealEl) tkRealEl.textContent = realTokensSum;
  // ⚖️ v36 — مجاميع الحقيقيين (علامات + جواهر + جوائز ذكاء) لقانون الحفظ
  //    (نفس معادلة التحويل: كل 5 علامات = جوهرة، كل 100 جوهرة = جائزة)
  _vaultSums.rTokens = realTokensSum;
  _vaultSums.rGems = list.reduce((a, p) => a + Math.floor((Number(p.tokens) || 0) / 5), 0);
  _vaultSums.rIntel = list.reduce((a, p) => a + Math.floor(Math.floor((Number(p.tokens) || 0) / 5) / 100), 0);
  renderVaultConservation();

  // 🚩 v31 — قائمة اللاعبين المشبوهين تتحدث لحظيًا مع كل لقطة لاعبين
  renderSuspicious();
}

/* ==========================================================
 * 🚩 v31 — اللاعبون المشبوهون (كشف الغش بالإحصائية لا بالمنع)
 *  معايير الخروج عن الطبيعة البشرية (بشروط حد أدنى حتى لا
 *  نعلّم لاعبًا سريع الأصابع بالخطأ):
 *   1) إجابات صحيحة خاطفة (<2 ثانية من كشف السؤال) بنسبة 40%+
 *      بدقة 80%+ — مع 20 إجابة على الأقل.
 *   2) متوسط زمن إجابة ≤ 2.5 ثانية بدقة 85%+ — مع 20 إجابة على الأقل.
 *   3) فوز 90%+ في 15 جولة فأكثر.
 *  القرار للإدارة: فتح الملف · حظر · تجميد · أو «تمت المراجعة».
 * ========================================================== */
const SUS_MIN_ANSWERS = 20;

function suspiciousFlags(p) {
  const flags = [];
  const total = Number(p.totalAnswered) || 0;
  const fast = Number(p.fastAnswers) || 0;
  const msSum = Number(p.answerMsSum) || 0;
  const correct = Number(p.correctAnswers) || 0;
  const wrong = Number(p.wrongAnswers) || 0;
  const wins = Number(p.wins) || 0;
  const losses = Number(p.losses) || 0;
  const rounds = Number(p.roundsPlayed) || 0;
  const acc = (correct + wrong) > 0 ? correct / (correct + wrong) : 0;
  const accPct = Math.round(acc * 100);

  if (total >= SUS_MIN_ANSWERS) {
    const fastRate = fast / total;
    const avgSec = msSum / total / 1000;
    if (fastRate >= 0.4 && acc >= 0.8) {
      flags.push(`⚡ ${Math.round(fastRate * 100)}% إجابات خلال أقل من ثانيتين — الدقة ${accPct}%`);
    }
    if (avgSec > 0 && avgSec <= 2.5 && acc >= 0.85) {
      flags.push(`⏱️ متوسط الإجابة ${avgSec.toFixed(1)} ثانية — الدقة ${accPct}%`);
    }
  }
  if (rounds >= 15 && (wins + losses) > 0 && (wins / (wins + losses)) >= 0.9) {
    flags.push(`🏆 فوز ${Math.round((wins / (wins + losses)) * 100)}% في ${rounds} جولة`);
  }
  return flags;
}

function renderSuspicious() {
  const box = $('susp-box');
  if (!box) return;
  const reviewed = [];
  const rows = [];
  _playersLatest.forEach(p => {
    if (p.banned || p.isBot) return;
    const flags = suspiciousFlags(p);
    if (!flags.length) return;
    if (p.susReviewedAt) reviewed.push({ p, flags });
    else rows.push({ p, flags });
  });

  if (!rows.length && !reviewed.length) {
    box.innerHTML = '<p class="muted">✅ لا لاعبين مشبوهين حاليًا — كل الأنماط ضمن الطبيعي</p>';
    return;
  }

  const rowHTML = ({ p, flags }, isReviewed) => `
    <div class="cbar" style="align-items:flex-start;gap:10px;${isReviewed ? 'opacity:.55' : ''}">
      <div style="flex:1;min-width:220px">
        <b>${esc(p.name)}</b>
        <span class="muted small">· ${esc(p.country || '—')} · مستوى ${p.level || 1} · ${timeAgo(p.lastSeen)}</span>
        <div class="small">${flags.map(f => `<div>${f}</div>`).join('')}</div>
        ${isReviewed ? '<span class="muted small">✔️ تمت مراجعته سابقًا</span>' : ''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        <button class="btn btn-ghost small" data-susp-open="${esc(p.uid)}">📂 الملف</button>
        <button class="btn btn-warn small" data-susp-freeze="${esc(p.uid)}" data-susp-name="${esc(p.name)}">❄️ تجميد</button>
        <button class="btn btn-danger small" data-susp-ban="${esc(p.uid)}" data-susp-name="${esc(p.name)}">🚫 حظر</button>
        ${isReviewed ? '' : `<button class="btn btn-ghost small" data-susp-review="${esc(p.uid)}">✔️ مراجعة</button>`}
      </div>
    </div>`;

  box.innerHTML =
    rows.map(r => rowHTML(r, false)).join('') +
    (reviewed.length
      ? `<details style="margin-top:8px"><summary class="muted small">✔️ المُراجعون سابقًا (${reviewed.length})</summary>
         ${reviewed.map(r => rowHTML(r, true)).join('')}</details>`
      : '');

  box.querySelectorAll('[data-susp-open]').forEach(b => {
    b.onclick = () => openPlayerDetails(b.dataset.suspOpen);
  });
  box.querySelectorAll('[data-susp-ban]').forEach(b => {
    b.onclick = () => banPlayer(b.dataset.suspBan, b.dataset.suspName);
  });
  box.querySelectorAll('[data-susp-freeze]').forEach(b => {
    b.onclick = () => freezePlayer(b.dataset.suspFreeze, b.dataset.suspName);
  });
  box.querySelectorAll('[data-susp-review]').forEach(b => {
    b.onclick = async () => {
      try {
        await updateDoc(doc(db, 'players', b.dataset.suspReview), {
          susReviewedAt: serverTimestamp()
        });
        toast('سُجّلت المراجعة — سيتكرر ظهوره فقط إذا تغيّر نمطه', 'ok');
      } catch (e) { toast('⛔ ' + (e?.message || e), 'err'); }
    };
  });
}

/** 🔍 البحث: اسم أو UID + فترة تاريخ الانضمام */
function filteredPlayers() {
  const q = $('pl-search').value.trim().toLowerCase();
  const from = $('pl-from').value ? new Date($('pl-from').value + 'T00:00:00').getTime() : 0;
  const to = $('pl-to').value ? new Date($('pl-to').value + 'T23:59:59').getTime() : 0;
  let list = _playersLatest;
  if (q.length >= 2) {
    if (q.length >= 20 && /^[a-z0-9]+$/i.test(q)) {
      list = list.filter(p => p.uid === q);
    } else {
      list = list.filter(p => (p.name || '').toLowerCase().includes(q) || (p.nameLower || '').includes(q));
    }
  }
  if (from) list = list.filter(p => (p.createdAt?.toMillis?.() || 0) >= from);
  if (to) list = list.filter(p => (p.createdAt?.toMillis?.() || 0) <= to);
  return list;
}

$('btn-pl-search').onclick = () => { _page = 0; renderPlayers(); renderCountryBars(); };
$('pl-search').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-pl-search').click(); });
$('btn-pl-clear').onclick = () => {
  $('pl-search').value = ''; $('pl-from').value = ''; $('pl-to').value = '';
  _page = 0; renderPlayers(); renderCountryBars(); toast('أُلغي البحث — القائمة الكاملة', 'ok');
};

$('btn-pl-prev').onclick = () => { if (_page > 0) { _page--; renderPlayers(); } };
$('btn-pl-next').onclick = () => { _page++; renderPlayers(); };

function renderPlayers() {
  const tb = $('players-tbody');
  const list = filteredPlayers();
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (_page >= pages) _page = pages - 1;
  const slice = list.slice(_page * PAGE_SIZE, _page * PAGE_SIZE + PAGE_SIZE);

  $('pl-page-info').textContent = `صفحة ${_page + 1} / ${pages} — ${list.length} لاعب`;

  if (!slice.length) {
    tb.innerHTML = '<tr><td colspan="14" class="muted">لا نتائج</td></tr>';
    return;
  }
  tb.innerHTML = slice.map(p => {
    const isBanned = !!p.banned;
    const online = p.lastSeen && (Date.now() - p.lastSeen.toDate().getTime() < 5 * 60 * 1000);
    const isFrozen = p.frozenUntil && p.frozenUntil.toDate() > new Date();
    const statusTag = isBanned
      ? '<span class="tag banned">محظور</span>'
      : isFrozen
        ? '<span class="tag banned">❄️ مجمّد</span>'
        : (online ? '<span class="tag online">متصل</span>' : '<span class="tag offline">' + timeAgo(p.lastSeen) + '</span>');
    const unread = p._supUnread ? '<span class="mini-badge" style="position:static">🔴</span>' : '';
    // 📊 v32 — أعمدة الإحصائيات في القائمة مباشرة (كانت غائبة:
    //   الجولات + الإجابات الصحيحة/الكلية + عدد الجوائز في الحقيبة)
    const answeredAll = (Number(p.correctAnswers) || 0) + (Number(p.wrongAnswers) || 0);
    const prizesN = Array.isArray(p.bagPrizes) ? p.bagPrizes.length : 0;
    return `
      <tr>
        <td><b>${esc(p.name)} ${unread}</b><br><span class="muted small" style="direction:ltr;display:inline-block">${esc(p.uid.slice(0, 10))}…</span></td>
        <td>${p.level || 1}</td>
        <td>${p.wins || 0} / ${p.losses || 0}</td>
        <td>${p.roundsPlayed || 0}</td>
        <td>${p.correctAnswers || 0}/${answeredAll}</td>
        <td>${prizesN}</td>
        <td>${p.tokens || 0}</td>
        <td>${p.gems || 0}</td>
        <td>${p.intel || 0}</td>
        <td>${esc(p.country || '—')} ${esc(langName(p.lang) || '')}</td>
        <td>${timeAgo(p.createdAt)}</td>
        <td>${timeAgo(p.lastSeen)}</td>
        <td>${statusTag}</td>
        <td><div class="row-actions">
          <button class="btn btn-primary" data-details="${p.uid}">👤</button>
          <button class="btn btn-ghost" data-chat="${p.uid}" data-name="${esc(p.name)}" title="محادثة الدعم">🛠️${p._supUnread ? '🔴' : ''}</button>
          ${isBanned
            ? `<button class="btn btn-success" data-unban="${p.uid}">فك</button>`
            : `<button class="btn btn-warn" data-ban="${p.uid}" data-name="${esc(p.name)}">🚫</button>`}
          ${isFrozen
            ? `<button class="btn btn-success" data-unfreeze="${p.uid}" data-name="${esc(p.name)}" title="إلغاء التجميد">🧊</button>`
            : `<button class="btn btn-ghost" data-freeze="${p.uid}" data-name="${esc(p.name)}" title="تجميد">❄️</button>`}
          <button class="btn btn-danger" data-del="${p.uid}" data-name="${esc(p.name)}">🗑️</button>
        </div></td>
      </tr>`;
  }).join('');

  tb.querySelectorAll('[data-ban]').forEach(b => b.onclick = () => banPlayer(b.dataset.ban, b.dataset.name));
  tb.querySelectorAll('[data-unban]').forEach(b => b.onclick = async () => {
    await updateDoc(doc(db, 'players', b.dataset.unban), { banned: false, bannedReason: '' });
    // 🧹 v26: فك الحظر يزيل الحجر الأمني أيضًا إن وُجد (اللاعب الذي حُذف
    //    ملفه سابقًا ثم عاد كشبح — كان يرى شاشة الحذف للأبد بلا وسيلة لإلغائها)
    await deleteDoc(doc(db, 'banned', b.dataset.unban)).catch(() => {});
    toast('تم فك الحظر وإزالة الحجر الأمني ✓', 'ok');
  });
  tb.querySelectorAll('[data-details]').forEach(b => b.onclick = () => openPlayerDetails(b.dataset.details));
  tb.querySelectorAll('[data-chat]').forEach(b => b.onclick = () => openPlayerChat(b.dataset.chat, b.dataset.name));
  tb.querySelectorAll('[data-freeze]').forEach(b => b.onclick = () => freezePlayer(b.dataset.freeze, b.dataset.name));
  // 🧊 v26: زر إلغاء التجميد مباشرة في القائمة — كان موجودًا فقط داخل ملف اللاعب
  tb.querySelectorAll('[data-unfreeze]').forEach(b => b.onclick = async () => {
    await updateDoc(doc(db, 'players', b.dataset.unfreeze), { frozenUntil: null, frozenReason: '' });
    toast('تم إلغاء التجميد ✓', 'ok');
  });
  tb.querySelectorAll('[data-del]').forEach(b => b.onclick = () => deletePlayer(b.dataset.del, b.dataset.name));
}

function langName(code) {
  const names = { ar: 'عربي', en: 'EN', fr: 'FR', es: 'ES', de: 'DE', tr: 'TR', ur: 'UR', hi: 'HI', ru: 'RU', zh: 'ZH' };
  return code ? (names[code] || code.toUpperCase()) : '';
}

/** 🌍 إحصائية اللاعبين حسب الدولة */
function renderCountryBars() {
  const box = $('pl-countries');
  const counts = {};
  _playersLatest.forEach(p => { const k = p.country || '—'; counts[k] = (counts[k] || 0) + 1; });
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!rows.length) { box.innerHTML = '<p class="muted">لا لاعبين بعد</p>'; return; }
  const max = rows[0][1] || 1;
  box.innerHTML = rows.map(([cc, n]) => `
    <div class="cbar">
      <span class="cbar-label">${esc(cc)}</span>
      <span class="cbar-track"><i style="width:${Math.max(4, Math.round((n / max) * 100))}%"></i></span>
      <b class="cbar-n">${n}</b>
    </div>`).join('');
}

function banPlayer(uid, name) {
  dlgOpen('🚫 حظر اللاعب: ' + name, `
    <p class="muted" style="margin-bottom:10px">سيظهر للاعب شاشة حظر مع سبب وخيار التواصل مع الدعم الفني. يمكنك فك الحظر لاحقاً.</p>
    <input id="ban-reason" placeholder="سبب الحظر (يظهر للاعب)" />`,
    `<button class="btn btn-ghost" data-dlg-cancel>إلغاء</button>
     <button class="btn btn-danger" id="ban-go">تنفيذ الحظر</button>`);
  $('ban-go').onclick = async () => {
    const reason = $('ban-reason').value.trim() || 'مخالفة قوانين اللعبة';
    await updateDoc(doc(db, 'players', uid), {
      banned: true, bannedReason: reason, bannedAt: serverTimestamp()
    });
    dlgClose();
    toast('تم حظر ' + name + ' 🚫', 'ok');
  };
}

/** 🧹 v26 مسح مجموعات فرعية للاعب (friends/history) — دفعة واحدة لكل 400 مستند */
async function wipePlayerSubcols(uid) {
  for (const sc of ['friends', 'history']) {
    try {
      const sub = await getDocs(query(collection(db, 'players', uid, sc), limit(500)));
      for (let i = 0; i < sub.docs.length; i += 400) {
        const batch = writeBatch(db);
        sub.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
        await batch.commit().catch(() => {});
      }
    } catch (e) { console.warn('wipePlayerSubcols', sc, e?.message || e); }
  }
}

/** 💰 v29 — قيمة موارد اللاعب بعلامات الخزان:
 *  علاماته + جواهره (كل جوهرة = 5 علامات) + جوائز ذكائه (كل جائزة = 100 جوهرة = 500 علامة)
 *  — نفس تحويلات الخزان المعتمدة في game/economy.js */
function playerTankValue(d) {
  const tokens = Math.max(0, Number(d?.tokens) || 0);
  const gems   = Math.max(0, Number(d?.gems) || 0);
  const intel  = Math.max(0, Number(d?.intel) || 0);
  return tokens + gems * 5 + intel * 500;
}

/** 💰 v29 — إعادة موارد لاعب (قبل حذفه) إلى الخزان الرئيسي — أفضل محاولة.
 *  @returns {Promise<number>} عدد العلامات التي عادت فعلاً (0 عند الفشل/صفر الموارده) */
async function returnPlayerResourcesToTank(uid) {
  try {
    const ps = await getDoc(doc(db, 'players', uid));
    if (!ps.exists()) return 0;
    const n = playerTankValue(ps.data());
    if (n > 0) await tankPlayerDeleted(n);
    return n;
  } catch (e) {
    console.warn('returnPlayerResourcesToTank:', e?.message || e);
    return 0;
  }
}

/** 🗑️ حذف لاعب — حجر أمني يمنع إعادة التسجيل + ملف اللاعب ومجموعاته الفرعية يُحذف
 *  v26: حذف كامل نهائي — أصدقاؤه وسجل جولاته يُمسح أيضًا (لا أثر في أي قائمة)،
 *  ومزامنة جهازه لم تعد تعيد إنشاء ملفه (حاجز الحجر في اللعبة).
 *  💰 v29 (طلب المستخدم): علامات الانتصار والجواهر وغيرها تعود إلى الخزنة
 *  الرئيسية قبل الحذف — لا تضيع موارد اللعبة مع الحساب المحذوف. */
async function deletePlayer(uid, name) {
  const ok = await confirmDlg(`⚠️ حذف اللاعب "${name}" نهائيًا؟`, 'يُمنع من الدخول (شاشة: تم حذف حسابك) ويُحذف ملفه وأصدقاؤه وسجل جولاته من قاعدة البيانات نهائيًا — حتى لو كان تطبيقه مفتوحًا الآن. علاماته وجواهره وجوائز ذكائه تعود إلى الخزنة الرئيسية.');
  if (!ok) return;
  // 🛠️ v36 — لا فشل صامت (شكوى المستخدم: حذف اللاعب و remained موجود!):
  //    أي خطأ شبكة/Firestore كان يُجهض الحذف كاملًا بلا رسالة — الآن
  //    يظهر الخطأ بوضوح مع إعادة المحاولة، ولا توست نجاح إلا بنجاح فعلي
  try {
    const returned = await returnPlayerResourcesToTank(uid);   // 💰 عودة الموارد للخزنة
    await setDoc(doc(db, 'banned', uid), {
      reason: 'تم حذف هذا الحساب لمخالفة بعض القوانين والشروط',
      deletedAt: serverTimestamp()
    });
    await wipePlayerSubcols(uid);          // 🧹 لا أثر في الأصدقاء أو السجل
    await deleteDoc(doc(db, 'players', uid));
    toast(returned > 0
      ? `تم حذف اللاعب نهائيًا 🗑️ — عادت ${returned} علامة إلى الخزنة الرئيسية 💰`
      : 'تم حذف اللاعب نهائيًا 🗑️', 'ok');
    loadPlayersOnce();
    loadVault();                            // ⚖️ تحديث فحص الحفظ فورًا
  } catch (e) {
    toast('⛔ تعذر إكمال الحذف: ' + (e?.message || e) + ' — أعد المحاولة بعد استقرار الاتصال', 'err');
  }
}

/** 🗑️ حذف كل اللاعبين الحقيقيين — بتأكيد مزدوج (تصميم اللعبة) */
$('btn-pl-delete-all').onclick = async () => {
  const ok1 = await confirmDlg('⚠️ حذف كل اللاعبين الحقيقيين؟', 'سيُحذف كل ملف لاعب مع أصدقائه وسجل جولاته من قاعدة البيانات ولا يبقى أي لاعب. اللاعب عند الانضمام يرى شاشة الحظر مع زر «متابعة» يعيده لاعبًا جديدًا يمكنه التسجيل من جديد. علامات اللاعبين وجواهرهم وجوائز ذكائهم كلها تعود إلى الخزنة الرئيسية.');
  if (!ok1) return;
  const ok2 = await confirmDlg('⚠️ تأكيد أخير', 'العملية لا يمكن التراجع عنها — هل أنت متأكد تمامًا؟');
  if (!ok2) return;
  try {
    const snap = await getDocs(query(collection(db, 'players'), limit(1000)));
    let n = 0, returnedTotal = 0, failed = 0;
    for (const d of snap.docs) {
      // 🛠️ v36 — عدّ الفشل بصدق: كان كل خطأ يُبتلع ويُحسب اللاعب محذوفًا
      //    كذبًا («تم الحذف» بينما وثيقته باقية في Console) — الآن أي فشل
      //    يُسجل ويظهر في الرسالة النهائية مع إعادة المحاولة
      try {
        returnedTotal += await returnPlayerResourcesToTank(d.id);   // 💰 عودة الموارد للخزنة
        await setDoc(doc(db, 'banned', d.id), {
          reason: 'تم حذف هذا الحساب لمخالفة بعض القوانين والشروط',
          deletedAt: serverTimestamp()
        });
        await wipePlayerSubcols(d.id);
        await deleteDoc(doc(db, 'players', d.id));
        n++;
      } catch (e) {
        failed++;
        console.warn('bulk delete failed:', d.id, e?.message || e);
      }
    }
    toast(failed
      ? `⚠️ حُذف ${n} لاعبًا وفشل ${failed} (انقطاع اتصال) — أعد الضغط لإكمال الباقي`
      : (returnedTotal > 0
        ? `تم حذف ${n} لاعب نهائيًا 🗑️ — عادت ${returnedTotal} علامة إلى الخزنة الرئيسية 💰`
        : `تم حذف ${n} لاعب نهائيًا 🗑️`), failed ? 'err' : 'ok');
    loadPlayersOnce();
    loadVault();          // 💰 تحديث أرقام الخزنة فورًا بعد عودة الموارد
  } catch (e) {
    toast('خطأ: ' + (e?.message || e), 'err');
  }
};

/** 🎨 نافذة تأكيد بتصميم اللعبة (بدل confirm المتصفح) */
function confirmDlg(message, sub = '') {
  return new Promise((resolve) => {
    dlgOpen('تأكيد', `
      <p style="margin:0 0 6px;font-weight:700">${message}</p>
      <p class="muted small">${sub}</p>`,
      `<button class="btn btn-ghost" id="cd-no">إلغاء</button>
       <button class="btn btn-danger" id="cd-yes">تأكيد</button>`);
    $('cd-yes').onclick = () => { dlgClose(); resolve(true); };
    $('cd-no').onclick = () => { dlgClose(); resolve(false); };
  });
}

/* ==========================================================
 * 🛠️ رسائل الدعم الفني — صندوق وارد لحظي (غير المقروءة تتصدّر)
 * ========================================================== */
let supFilter = 'unread';
let supportUnsub = null;

document.querySelectorAll('#sup-filters .chip').forEach(ch => ch.onclick = () => {
  document.querySelectorAll('#sup-filters .chip').forEach(c => c.classList.remove('active'));
  ch.classList.add('active');
  supFilter = ch.dataset.sup;
  renderSupportList();
});

$('btn-sup-del-all').onclick = async () => {
  const ok = await confirmDlg('🗑️ حذف كل رسائل الدعم؟', 'تحذف كل المحادثات نهائيًا من صندوق الدعم.');
  if (!ok) return;
  try {
    const snap = await getDocs(query(collection(db, 'supportTickets'), limit(500)));
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref).catch(() => {})));
    toast(`تم حذف ${snap.docs.length} رسالة 🗑️`, 'ok');
    renderSupportList();
  } catch (e) { toast('خطأ: ' + (e?.message || e), 'err'); }
};

/** 🧹 أي رسالة تمر عليها 90 يومًا تُحذف تلقائيًا (تنفيذ عند الدخول) */
async function sweepOldSupport() {
  try {
    const since = new Date(Date.now() - 90 * 86400000);
    const snap = await getDocs(query(
      collection(db, 'supportTickets'),
      where('createdAt', '<', since),
      limit(400)
    ));
    if (!snap.docs.length) return;
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref).catch(() => {})));
    toast(`🧹 حُذفت ${snap.docs.length} رسالة أقدم من 90 يومًا`, 'ok');
  } catch {}
}

function startSupportLive() {
  if (supportUnsub) supportUnsub();
  supportUnsub = onSnapshot(
    query(collection(db, 'supportTickets'), orderBy('createdAt', 'desc'), limit(200)),
    () => renderSupportList(),
    (e) => { console.warn('support listener:', e); renderSupportList(); }
  );
}

async function renderSupportList() {
  const box = $('sup-list');
  if (!box) return;
  let tickets = [];
  try {
    const snap = await getDocs(query(collection(db, 'supportTickets'), orderBy('createdAt', 'desc'), limit(200)));
    tickets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    $('sup-total').textContent = tickets.length;
    const unread = tickets.filter(t => !t.read).length;
    $('sup-unread-n').textContent = unread;
    $('gm-unread').textContent = unread;
    // 🔴 شارة غير المقروء على اسم اللاعب في قائمة اللاعبين
    const unreadUids = new Set(tickets.filter(t => !t.read).map(t => t.uid));
    _playersLatest.forEach(p => { p._supUnread = unreadUids.has(p.uid); });
    if (playersLoaded) {
      const tb = $('players-tbody');
      if (tb && tb.querySelector('[data-chat]')) renderPlayers();
    }
  } catch (e) {
    box.innerHTML = '<p class="muted panel-card">تعذر جلب الرسائل — تحقق من الاتصال</p>';
    return;
  }

  let list = tickets;
  if (supFilter === 'unread') list = tickets.filter(t => !t.read);
  else if (supFilter !== 'all') list = tickets.filter(t => t.status === supFilter);

  if (!list.length) { box.innerHTML = '<p class="muted panel-card">لا رسائل هنا ✓</p>'; return; }

  box.innerHTML = list.map(t => {
    const unread = !t.read;
    return `
    <div class="sup-card ${t.status === 'answered' ? 'answered' : ''} ${unread ? 'unread' : ''}">
      <div class="sup-head">
        <div>
          <span class="sup-player">${esc(t.name)} ${unread ? '<span class="tag banned">🔴 غير مقروءة</span>' : ''}</span>
          <span class="tag ${t.status === 'answered' ? 'ok' : ''}" style="margin-inline-start:8px">${t.status === 'answered' ? 'تم الرد' : 'مفتوحة'}</span>
        </div>
        <div class="sup-meta">🏆 ${t.level || 1} · ${esc(t.country || '')} · ${fmtTime(t.createdAt)}${t.email ? ' · ✉️ ' + esc(t.email) : ''}</div>
      </div>
      <div class="sup-text" data-orig="${esc(t.message)}">${esc(t.message)}</div>
      <div class="row-actions" style="margin-top:6px">
        <button class="btn btn-primary small" data-sup-open="${t.id}">📖 ${unread ? 'فتح وتعليم مقروءة' : 'مقروءة'}</button>
        <button class="btn btn-ghost small" data-sup-translate="${t.id}">🌐 ترجمة</button>
        <button class="btn btn-ghost small" data-sup-profile="${esc(t.uid || '')}">👤 ملف اللاعب</button>
        <button class="btn btn-danger small" data-sup-del="${t.id}">🗑️ حذف</button>
      </div>
      ${(t.replies || []).length ? `
        <div class="sup-replies">
          ${t.replies.map(r => `<div class="sup-reply"><b>🛠️ رد (${fmtTime({ toDate: () => new Date(r.at) })})</b>${esc(r.msg)}</div>`).join('')}
        </div>` : ''}
      <div class="sup-reply-form">
        <div class="row-between" style="margin-bottom:4px">
          <label class="muted small" style="display:flex;align-items:center;gap:5px;margin:0">لغة الرد:
            <select class="sup-lang" data-sup-lang="${t.id}" style="width:130px">
              <option value="">نفس لغة الرسالة</option>
              <option value="ar">🇸🇦 العربية</option>
              <option value="en">🇬🇧 English</option>
              <option value="fr">🇫🇷 Français</option>
              <option value="es">🇪🇸 Español</option>
              <option value="tr">🇹🇷 Türkçe</option>
              <option value="ur">🇵🇰 اردو</option>
              <option value="hi">🇮🇳 हिन्दी</option>
              <option value="ru">🇷🇺 Русский</option>
              <option value="zh">🇨🇳 中文</option>
            </select>
          </label>
          <button class="btn btn-ghost small" data-sup-tr-reply="${t.id}">🌐 ترجمة ردي</button>
        </div>
        <textarea id="sup-reply-${t.id}" placeholder="اكتب ردك للاعب — سيصل فوراً مع تنبيه في ملفه"></textarea>
        <button class="btn btn-primary" data-sup-send="${t.id}">إرسال الرد ✈️</button>
      </div>
    </div>`;
  }).join('');

  box.querySelectorAll('[data-sup-open]').forEach(b => b.onclick = async () => {
    await updateDoc(doc(db, 'supportTickets', b.dataset.supOpen), { read: true }).catch(() => {});
    toast('تم تعليم الرسالة مقروءة ✓', 'ok');
    renderSupportList();
  });
  box.querySelectorAll('[data-sup-del]').forEach(b => b.onclick = async () => {
    const ok = await confirmDlg('حذف هذه الرسالة نهائيًا؟');
    if (!ok) return;
    await deleteDoc(doc(db, 'supportTickets', b.dataset.supDel));
    toast('تم حذف الرسالة 🗑️', 'ok');
    renderSupportList();
  });
  box.querySelectorAll('[data-sup-profile]').forEach(b => b.onclick = () => {
    if (!b.dataset.supProfile) { toast('لا معرف لاعب في هذه الرسالة', 'err'); return; }
    switchTab('players');
    setTimeout(() => openPlayerDetails(b.dataset.supProfile), 350);
  });

  // 🌐 الترجمة الفورية (زر بجانب كل رسالة)
  box.querySelectorAll('[data-sup-translate]').forEach(b => b.onclick = async () => {
    const card = b.closest('.sup-card');
    const el = card.querySelector('.sup-text');
    if (el.dataset.translated === '1') {   // اضغط مجددًا = العودة للأصل
      el.textContent = el.dataset.orig;
      el.dataset.translated = '0';
      b.textContent = '🌐 ترجمة';
      return;
    }
    b.disabled = true; b.textContent = '⏳';
    const tr = await translateText(el.dataset.orig || el.textContent, 'ar');
    b.disabled = false; b.textContent = '🌐 ترجمة';
    if (tr) { el.textContent = tr; el.dataset.translated = '1'; b.textContent = '↩️ الأصل'; }
    else toast('تعذرت الترجمة — تحقق من الاتصال', 'err');
  });

  // 🌐 ترجمة الرد للغة المختارة قبل الإرسال
  box.querySelectorAll('[data-sup-tr-reply]').forEach(b => b.onclick = async () => {
    const id = b.dataset.supTrReply;
    const ta = $('sup-reply-' + id);
    const lang = box.querySelector(`[data-sup-lang="${id}"]`)?.value;
    if (!ta.value.trim()) { toast('اكتب ردك أولًا', 'err'); return; }
    b.disabled = true; b.textContent = '⏳';
    const tr = await translateText(ta.value, lang || 'en');
    b.disabled = false; b.textContent = '🌐 ترجمة ردي';
    if (tr) { ta.value = tr; toast('تمت ترجمة الرد ✓ — راجعه ثم أرسل', 'ok'); }
    else toast('تعذرت الترجمة', 'err');
  });

  box.querySelectorAll('[data-sup-send]').forEach(b => b.onclick = async () => {
    const ta = $('sup-reply-' + b.dataset.supSend);
    const msg = ta.value.trim();
    if (!msg) { toast('اكتب الرد أولاً', 'err'); return; }
    b.disabled = true;
    await updateDoc(doc(db, 'supportTickets', b.dataset.supSend), {
      status: 'answered',
      read: true,
      lastReplyAt: serverTimestamp(),
      replies: arrayUnion({ msg, at: Date.now() })
    });
    toast('تم إرسال الرد ✓', 'ok');
    renderSupportList();
  });
}

/** 🌐 ترجمة فورية عبر خدمة الترجمة (أفضل محاولة) */
async function translateText(text, target = 'ar') {
  try {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl='
      + encodeURIComponent(target) + '&dt=t&q=' + encodeURIComponent(text.slice(0, 1800));
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.[0] || []).map(x => x?.[0] || '').join('');
  } catch { return null; }
}

/** 🛠️ محادثة الدعم مع لاعب — من قائمة اللاعبين مباشرة */
function openPlayerChat(uid, name) {
  dlgOpen(`🛠️ محادثة الدعم — ${name || ''}`, `
    <div id="chat-thread" class="chat-thread"><p class="muted">جاري التحميل…</p></div>
    <textarea id="chat-input" placeholder="اكتب رسالتك للاعب…"></textarea>`,
    `<button class="btn btn-ghost" data-dlg-cancel>إغلاق</button>
     <button class="btn btn-primary" id="chat-send">إرسال ✈️</button>`);
  loadChatThread(uid);
  $('chat-send').onclick = async () => {
    const msg = $('chat-input').value.trim();
    if (!msg) { toast('اكتب الرسالة أولًا', 'err'); return; }
    const ref = doc(db, 'supportTickets', 'admin_' + uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        status: 'answered', read: true, lastReplyAt: serverTimestamp(),
        replies: arrayUnion({ msg, at: Date.now() })
      });
    } else {
      await setDoc(ref, {
        uid, name: name || 'لاعب', message: '(محادثة بدأها الدعم الفني)',
        status: 'answered', read: true,
        replies: [{ msg, at: Date.now() }],
        createdAt: serverTimestamp(), lastReplyAt: serverTimestamp()
      });
    }
    $('chat-input').value = '';
    toast('أُرسلت الرسالة — ستصل للاعب مع تنبيه ✓', 'ok');
    loadChatThread(uid);
  };
}

async function loadChatThread(uid) {
  const box = $('chat-thread');
  if (!box) return;
  try {
    const snap = await getDocs(query(
      collection(db, 'supportTickets'),
      where('uid', '==', uid),
      orderBy('createdAt', 'desc'), limit(20)
    ));
    const items = [];
    snap.docs.forEach(d => {
      const t = d.data();
      if (t.message && !t.message.startsWith('(محادثة')) {
        items.push({ who: 'player', msg: t.message, at: t.createdAt });
      }
      (t.replies || []).forEach(r => items.push({ who: 'admin', msg: r.msg, at: r.at }));
    });
    items.sort((a, b) => (a.at?.toMillis?.() || a.at || 0) - (b.at?.toMillis?.() || b.at || 0));
    box.innerHTML = items.length
      ? items.map(x => `<div class="chat-msg ${x.who}"><b>${x.who === 'admin' ? '🛠️ الدعم' : '👤 اللاعب'}</b>${esc(x.msg)}<small>${x.at?.toMillis ? fmtTime(x.at) : fmtTime({ toDate: () => new Date(x.at) })}</small></div>`).join('')
      : '<p class="muted">لا رسائل بعد — ابدأ المحادثة من الأسفل</p>';
  } catch (e) {
    box.innerHTML = '<p class="muted">تعذر تحميل المحادثة: ' + esc(e?.message || e) + '</p>';
  }
}

/* ==========================================================
 * 👤 ملف اللاعب الكامل + تفاصيل النشاط والفترات
 * ========================================================== */
async function openPlayerDetails(uid) {
  dlgOpen('👤 ملف اللاعب', '<p class="muted">جاري التحميل…</p>', '<button class="btn btn-ghost" data-dlg-cancel>إغلاق</button>');
  try {
    const pSnap = await getDoc(doc(db, 'players', uid));
    if (!pSnap.exists()) { $('dlg-body').innerHTML = '<p class="muted">اللاعب غير موجود</p>'; return; }
    const p = pSnap.data();
    const c = p.awardCounters || {};
    const frozen = p.frozenUntil && p.frozenUntil.toDate() > new Date();

    const createdMs = p.createdAt?.toMillis?.() || 0;
    const lastMs = p.lastSeen?.toMillis?.() || 0;
    const daysSinceJoin = createdMs ? Math.max(0, Math.floor((Date.now() - createdMs) / 86400000)) : '—';
    const daysSinceLast = lastMs ? Math.max(0, Math.floor((Date.now() - lastMs) / 86400000)) : '—';

    const stat = (l, v) => `<div class="pd-stat"><span>${l}</span><b>${v}</b></div>`;
    $('dlg-body').innerHTML = `
      <div class="pd-grid">
        ${stat('الاسم', esc(p.name || '—'))}
        ${stat('المستوى', p.level || 1)}
        ${stat('فوز / خسارة', (p.wins || 0) + ' / ' + (p.losses || 0))}
        ${stat('النقاط (انتصارات الأسئلة)', p.totalVictories || 0)}
        ${stat('إجابات صحيحة', p.correctAnswers || 0)}
        ${stat('إجابات خاطئة', p.wrongAnswers || 0)}
        ${stat('جولات لُعبت', p.roundsPlayed || 0)}
        ${stat('🏆 علامات انتصار', p.tokens || 0)}
        ${stat('💎 جواهر', p.gems || 0)}
        ${stat('🧠 جوائز ذكاء', p.intel || 0)}
        ${stat('شخصيات مملوكة', (p.ownedCharacters || p.ownedAvatars || []).length)}
        ${stat('🎡 تحريك العجلة', p.wheelSpins || 0)}
        ${stat('اللغة', esc(p.lang || '—'))}
        ${stat('الدولة', esc(p.country || '—'))}
        ${stat('البريد', esc(p.email || '—'))}
        ${stat('تاريخ الانضمام', fmtTime(p.createdAt))}
        ${stat('أيام من الانضمام', daysSinceJoin)}
        ${stat('آخر ظهور', fmtTime(p.lastSeen))}
        ${stat('أيام من آخر نشاط', daysSinceLast)}
        ${stat('الحالة', p.banned ? '🚫 محظور' : frozen ? '❄️ مجمّد' : '✅ سليم')}
      </div>

      <h4 style="margin:12px 0 6px">📊 نشاط اللاعب في فترة — كم جولة لعب؟</h4>
      <div class="row-between" style="flex-wrap:wrap;gap:8px">
        <label class="muted small" style="display:flex;align-items:center;gap:5px;margin:0">من
          <input type="date" id="pd-from" style="width:130px" /> إلى <input type="date" id="pd-to" style="width:130px" />
        </label>
        <button class="btn btn-primary small" id="pd-activity">🔍 حساب النشاط</button>
        <span class="muted small" id="pd-activity-out"></span>
      </div>`;

    $('pd-activity').onclick = async () => {
      const out = $('pd-activity-out');
      out.textContent = '⏳ جاري الحساب…';
      const from = $('pd-from').value ? new Date($('pd-from').value + 'T00:00:00') : null;
      const to = $('pd-to').value ? new Date($('pd-to').value + 'T23:59:59') : null;
      try {
        const snap = await getDocs(query(collection(db, 'players', uid, 'history'), limit(500)));
        let wins = 0, losses = 0;
        snap.docs.forEach(d => {
          const h = d.data();
          const ms = h.at?.toMillis?.() || 0;
          if (from && ms < from.getTime()) return;
          if (to && ms > to.getTime()) return;
          if (h.result === 'win') wins++; else losses++;
        });
        out.textContent = `✅ النشاط: ${wins + losses} جولة (${wins} فوز · ${losses} خسارة) في الفترة المحددة`;
      } catch (e) {
        out.textContent = '⛔ خطأ: ' + (e?.message || e);
      }
    };

    $('dlg-actions').innerHTML = `
      <button class="btn btn-ghost" id="pd-chat">🛠️ محادثة الدعم</button>
      ${p.banned
        ? `<button class="btn btn-success" id="pd-unban">فك الحظر</button>`
        : `<button class="btn btn-warn" id="pd-ban">🚫 حظر</button>`}
      ${frozen
        ? `<button class="btn btn-primary" id="pd-unfreeze">إلغاء التجميد</button>`
        : `<button class="btn btn-primary" id="pd-freeze">❄️ تجميد</button>`}
      <button class="btn btn-danger" id="pd-del">🗑️ حذف نهائي</button>
      <button class="btn btn-ghost" data-dlg-cancel>إغلاق</button>`;
    $('dlg-actions').querySelectorAll('[data-dlg-cancel]').forEach(b => b.onclick = dlgClose);
    $('pd-chat').onclick = () => { dlgClose(); openPlayerChat(uid, p.name || ''); };
    if ($('pd-ban')) $('pd-ban').onclick = () => { dlgClose(); banPlayer(uid, p.name || ''); };
    if ($('pd-unban')) $('pd-unban').onclick = async () => {
      await updateDoc(doc(db, 'players', uid), { banned: false, bannedReason: '' });
      // 🧹 v26: فك الحظر يزيل الحجر الأمني إن وُجد (استعادة كاملة)
      await deleteDoc(doc(db, 'banned', uid)).catch(() => {});
      toast('تم فك الحظر وإزالة الحجر الأمني ✓', 'ok'); dlgClose();
    };
    if ($('pd-freeze')) $('pd-freeze').onclick = () => { dlgClose(); freezePlayer(uid, p.name || ''); };
    if ($('pd-unfreeze')) $('pd-unfreeze').onclick = async () => {
      await updateDoc(doc(db, 'players', uid), { frozenUntil: null, frozenReason: '' });
      toast('تم إلغاء التجميد ✓', 'ok'); dlgClose();
    };
    if ($('pd-del')) $('pd-del').onclick = () => { dlgClose(); deletePlayer(uid, p.name || ''); };
  } catch (e) {
    $('dlg-body').innerHTML = '<p class="muted">خطأ: ' + esc(e?.message || e) + '</p>';
  }
}

/* ---------------- ❄️ التجميد العقابي ---------------- */
function freezePlayer(uid, name) {
  dlgOpen('❄️ تجميد اللاعب: ' + name, `
    <p class="muted" style="margin-bottom:10px">يُمنع اللاعب من اللعب لمدة تحددها (بدون حظر نهائي).</p>
    <label>مدة التجميد (أيام)
      <input id="freeze-days" type="number" min="1" max="365" value="3" />
    </label>
    <label style="margin-top:8px">السبب (يظهر للاعب)
      <input id="freeze-reason" placeholder="مخالفة قوانين اللعبة" />
    </label>`,
    `<button class="btn btn-ghost" data-dlg-cancel>إلغاء</button>
     <button class="btn btn-primary" id="freeze-go">تنفيذ التجميد ❄️</button>`);
  $('freeze-go').onclick = async () => {
    const days = Math.max(1, parseInt($('freeze-days').value, 10) || 3);
    const reason = $('freeze-reason').value.trim() || 'مخالفة قوانين اللعبة';
    await updateDoc(doc(db, 'players', uid), {
      frozenUntil: Timestamp.fromDate(new Date(Date.now() + days * 86400000)),
      frozenReason: reason
    });
    dlgClose();
    toast(`تم تجميد ${name} لمدة ${days} يوم ❄️`, 'ok');
  };
}

/* ==========================================================
 * 🛒 المتجر — الشخصيات (PNG بقياس موحّد) + الأدوات (قسمين)
 * ========================================================== */
const IMG_OK = ['image/png', 'image/jpeg'];

/** 🖼️ قلب أي صورة إلى مربع موحّد — Canvas داخل المتصفح.
 *  🛠️ v30 (طلب المستخدم — وضوح الصور): لا تكبير أبدًا — الصورة
 *  الأصغر من 256 تبقى بمقاسها الأصلي في المنتصف (التكبير بالكانفس
 *  كان سبب التمشيط)، والمربعة PNG أصغر من 256 تُمرَّر بلا إعادة
 *  ضغط، والتصغير بأعلى جودة تنعيم. العرض النهائي موحّد عبر CSS. */
function toSquareImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        // ✅ مربعة أصغر من 256 وPNG؟ مرّر الأصل كما هو — صفر فقدان
        if (img.width === img.height && img.width <= 256
            && String(dataUrl).startsWith('data:image/png')) {
          resolve(dataUrl);
          return;
        }
        const target = (img.width <= 256 && img.height <= 256)
          ? Math.max(img.width, img.height)
          : 256;
        const cv = document.createElement('canvas');
        cv.width = target; cv.height = target;
        const ctx = cv.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.clearRect(0, 0, target, target);
        if (img.width <= target && img.height <= target) {
          // احتواء بمقاس أصلي — بلا تكبير
          const w = img.width, h = img.height;
          ctx.drawImage(img, (target - w) / 2, (target - h) / 2, w, h);
        } else {
          // احتواء كامل داخل المربع (كف دون قص) — قياس موحّد دائمًا
          const scale = Math.min(target / img.width, target / img.height);
          const w = img.width * scale, h = img.height * scale;
          ctx.drawImage(img, (target - w) / 2, (target - h) / 2, w, h);
        }
        resolve(cv.toDataURL('image/png'));
      } catch { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** 🖼️ v31.2 — ضغط تلقائي عبر canvas: يصغّر الصورة لحد 512px ويحولها JPEG
 *  ليضمن بقاء حقل الصورة تحت حد Firestore (1MB) مهما كان حجم الملف الأصلي */
async function compressImageDataUrl(dataUrl, maxSide = 512, quality = 0.85) {
  const img = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('bad image'));
    im.src = dataUrl;
  });
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  return cv.toDataURL('image/jpeg', quality);
}

function bindImagePicker(fileId, statusId, holder, square = false) {
  $(fileId).onchange = async () => {
    const f = $(fileId).files[0];
    const st = $(statusId);
    holder.val = null;
    if (!f) { st.textContent = ''; return; }
    if (!IMG_OK.includes(f.type)) {
      st.textContent = '⛔ صيغة غير مسموحة — PNG / JPG فقط';
      st.style.color = '#f87171';
      $(fileId).value = '';
      return;
    }
    // 🖼️ v31.2 — بلا حد 600KB صارم: الصور الكبيرة تُضغط تلقائيًا بدل الرفض
    if (f.size > 15 * 1024 * 1024) {
      st.textContent = '⛔ الصورة ضخمة جدًا (فوق 15MB) — اختر صورة أصغر';
      st.style.color = '#f87171';
      $(fileId).value = '';
      return;
    }
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        let out = rd.result;
        const needsCompress = !square && out.length > 350 * 1024;
        if (needsCompress) out = await compressImageDataUrl(out);
        if (square) out = await toSquareImage(out);
        // 🛡️ حماية نهائية: حد Firestore هو 1MB للحقل — نمنع قبل الإرسال
        if (out.length > 900 * 1024) {
          st.textContent = '⛔ الصورة ما زالت كبيرة بعد الضغط — جرب صورة أبسط';
          st.style.color = '#f87171';
          $(fileId).value = '';
          return;
        }
        holder.val = out;
        st.textContent = '✅ الصورة جاهزة' + (square ? ' (قُلِّست إلى مربع موحّد 256×256)' : (needsCompress ? ' (ضُغطت تلقائيًا لتلائم قاعدة البيانات)' : ''));
        st.style.color = '#4ade80';
      } catch (e) {
        st.textContent = '⛔ تعذر تجهيز الصورة — جرب صورة أخرى';
        st.style.color = '#f87171';
        $(fileId).value = '';
      }
    };
    rd.readAsDataURL(f);
  };
}

let imageData = null;
let awardImageData = null;
bindImagePicker('ch-image', 'ch-image-status', { get val() { return imageData; }, set val(v) { imageData = v; } }, true);
bindImagePicker('aw-image', 'aw-image-status', { get val() { return awardImageData; }, set val(v) { awardImageData = v; } });

function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

/* ---------------- ⚔️ الشخصيات ---------------- */
$('btn-ch-save').onclick = async () => {
  const nameAr = $('ch-name-ar').value.trim();
  const price = parseInt($('ch-price').value, 10) || 0;
  if (!nameAr) { showMsg('ch-msg', '⚠️ أدخل اسم الشخصية', false); return; }
  if (!imageData) { showMsg('ch-msg', '⚠️ ارفع صورة الشخصية', false); return; }

  const id = 'ch_' + (slugify(nameAr) || Math.random().toString(36).slice(2, 8));
  try {
    await setDoc(doc(db, 'storeItems', id), {
      id, type: 'character', name: { ar: nameAr }, price,
      image: imageData,                     // PNG مربع موحّد 256×256
      active: true, source: 'admin',
      createdAt: serverTimestamp()
    });
    await bumpStoreVersion();
    showMsg('ch-msg', `✅ أُضيفت الشخصية "${nameAr}" إلى المتجر`, true);
    $('ch-name-ar').value = '';
    $('ch-image').value = '';
    imageData = null;
    $('ch-image-status').textContent = '';
    loadStoreAll();
  } catch (e) {
    showMsg('ch-msg', '⛔ خطأ: ' + (e?.message || e), false);
  }
};

/* ---------------- 🧰 الأدوات الثابتة + متجر الأدوات ---------------- */
const TOOL_DEFAULT_NAMES = {
  skip: 'تخطي السؤال',
  swap: 'تغيير السؤال',
  freeze1: 'تجميد 1 مرة',
  freeze2: 'تجميد 2 مرة',
  freeze3: 'تجميد 3 مرات',
  fifty: 'حذف خيارين (50:50)',
  rename: 'تغيير الاسم'
};
const TOOL_GRANTS = { freeze1: 'freeze', freeze2: 'freeze', freeze3: 'freeze' };

let toolImageData = {};   // kind → dataURL

/** إعدادات كل أداة ثابتة (الاسم + السعر + الصورة في صف واحد) */
function toolSettingRow(kind, it) {
  const price = Number(it?.price) || 0;
  const name = (typeof it?.name === 'string' ? it.name : it?.name?.ar) || TOOL_DEFAULT_NAMES[kind];
  const img = it?.image || '';
  if (!toolImageData[kind]) toolImageData[kind] = null;
  return `
    <div class="qrow" data-tool-row="${kind}">
      <span class="tool-thumb" id="tool-thumb-${kind}">${img ? `<img class="q-thumb" src="${esc(img)}" alt="">` : '🧰'}</span>
      <div class="q-main">
        <div class="q-title">${TOOL_DEFAULT_NAMES[kind]}</div>
        <div class="q-sub">الاسم الظاهر والسعر 🏆 قابلان للتعديل — الحفظ يصل للاعبين فورًا</div>
      </div>
      <input type="text" data-ts-name="${kind}" value="${esc(name)}" maxlength="60" style="width:150px" />
      <input type="number" data-ts-price="${kind}" value="${price}" min="0" max="99999" style="width:90px" title="السعر بعلامات الانتصار" />
      <label class="btn btn-ghost small" style="cursor:pointer">🖼️
        <input type="file" data-ts-img="${kind}" accept=".png,image/png" style="display:none" />
      </label>
      <button class="btn btn-primary small" data-ts-save="${kind}">💾</button>
    </div>`;
}

function bindToolRow(kind) {
  const row = document.querySelector(`[data-tool-row="${kind}"]`);
  if (!row) return;
  row.querySelector(`[data-ts-img="${kind}"]`).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!IMG_OK.includes(f.type) && f.type !== 'image/png') { toast('PNG فقط للأداة', 'err'); return; }
    const rd = new FileReader();
    rd.onload = async () => {
      toolImageData[kind] = await toSquareImage(rd.result);
      const th = row.querySelector(`#tool-thumb-${kind}`);
      if (th) th.innerHTML = `<img class="q-thumb" src="${toolImageData[kind]}" alt="">`;
      toast('الصورة جاهزة — اضغط 💾 للحفظ', 'ok');
    };
    rd.readAsDataURL(f);
  };
  row.querySelector(`[data-ts-save="${kind}"]`).onclick = async () => {
    const name = row.querySelector(`[data-ts-name="${kind}"]`).value.trim() || TOOL_DEFAULT_NAMES[kind];
    const price = parseInt(row.querySelector(`[data-ts-price="${kind}"]`).value, 10) || 0;
    const patch = {
      type: 'booster',
      name, price,
      grants: TOOL_GRANTS[kind] || null,
      active: $('tool-store-list').dataset.active?.includes(kind)
        ? undefined : undefined
    };
    if (toolImageData[kind]) patch.image = toolImageData[kind];
    try {
      // merge يحفظ التعديلات دون تغيير حالة النشر (active)
      await setDoc(doc(db, 'storeItems', kind), patch, { merge: true });
      await bumpStoreVersion();
      toast(`حُفظت "${name}" — السعر 🏆 ${price} ✓`, 'ok');
      loadStoreAll();
    } catch (e) { toast('خطأ: ' + (e?.message || e), 'err'); }
  };
}

/** ➕ إضافة أداة من قسم الإعدادات إلى متجر اللاعبين */
$('btn-tool-add-to-store').onclick = async () => {
  const kind = $('tool-add-select').value;
  if (!kind) { toast('اختر أداة أولًا', 'err'); return; }
  try {
    await setDoc(doc(db, 'storeItems', kind), {
      id: kind, type: 'booster',
      name: TOOL_DEFAULT_NAMES[kind],
      price: 3,
      grants: TOOL_GRANTS[kind] || null,
      active: true, source: 'admin',
      createdAt: serverTimestamp()
    }, { merge: true });
    await bumpStoreVersion();
    toast(`أُضيفت "${TOOL_DEFAULT_NAMES[kind]}" إلى متجر اللاعبين ✓`, 'ok');
    loadStoreAll();
  } catch (e) { toast('خطأ: ' + (e?.message || e), 'err'); }
};

/* ---------------- 📦 تحميل المتجر كاملًا ---------------- */
let _storeItems = [];
const _itemCache = {};

async function loadStoreAll() {
  try {
    const snap = await getDocs(query(collection(db, 'storeItems'), orderBy('createdAt', 'desc'), limit(120)));
    _storeItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _storeItems.forEach(it => { _itemCache[it.id] = it; });
    renderCharactersAdmin();
    renderToolsAdmin();
    loadStoreVersion();
  } catch (e) {
    toast('خطأ تحميل المتجر: ' + (e?.message || e), 'err');
  }
}

function renderCharactersAdmin() {
  const box = $('ch-list');
  const chars = _storeItems.filter(it => it.type === 'character' || it.type === 'avatar');
  const totalBuys = chars.reduce((a, c) => a + (Number(c.stats?.buys) || 0), 0);
  const totalGems = chars.reduce((a, c) => a + (Number(c.stats?.amount) || 0), 0);
  $('st-ch-total-buys').textContent = totalBuys;
  $('st-ch-total-gems').textContent = totalGems;
  $('st-ch-count').textContent = chars.length;

  if (!chars.length) { box.innerHTML = '<p class="muted">لا شخصيات بعد — أضف الأولى من الأعلى</p>'; return; }
  box.innerHTML = chars.map(c => `
    <div class="qrow">
      ${c.image ? `<img class="q-thumb" src="${esc(c.image)}" alt="">` : `<span style="font-size:26px">${esc(c.emoji || '✨')}</span>`}
      <div class="q-main">
        <div class="q-title">${esc(c.name?.ar || c.id)}</div>
        <div class="q-sub">💎 ${c.price} · 🛒 مشتريات: <b>${Number(c.stats?.buys) || 0}</b> · 💎 المبلغ: <b>${Number(c.stats?.amount) || 0}</b> · ${fmtTime(c.createdAt)}</div>
      </div>
      <button class="btn btn-ghost" data-it-edit="${c.id}" title="تحرير الصورة والاسم والسعر">✏️</button>
      <button class="btn ${c.active ? 'btn-warn' : 'btn-success'}" data-it-toggle="${c.id}" data-active="${c.active ? 1 : 0}">${c.active ? 'إخفاء' : 'نشر'}</button>
      <button class="btn btn-danger" data-it-del="${c.id}">🗑️</button>
    </div>`).join('');
  bindItemActions(box);
}

function renderToolsAdmin() {
  // 🧰 القسم العلوي: إعدادات كل الأدوات الثابتة (دائمًا موجودة)
  const setBox = $('tool-set-list');
  setBox.innerHTML = Object.keys(TOOL_DEFAULT_NAMES).map(k =>
    toolSettingRow(k, _storeItems.find(it => it.id === k))).join('');
  Object.keys(TOOL_DEFAULT_NAMES).forEach(bindToolRow);

  // 🛒 القسم السفلي: الأدوات المنشورة في متجر اللاعبين
  const storeBox = $('tool-store-list');
  const inStore = _storeItems.filter(it => it.type === 'booster' && it.active !== false);
  storeBox.dataset.active = inStore.map(it => it.id).join(',');
  const totalBuys = inStore.reduce((a, c) => a + (Number(c.stats?.buys) || 0), 0);
  const totalTokens = inStore.reduce((a, c) => a + (Number(c.stats?.amount) || 0), 0);
  $('st-tool-total-buys').textContent = totalBuys;
  $('st-tool-total-tokens').textContent = totalTokens;

  // 📥 قائمة الإضافة = الأدوات غير المنشورة فقط
  const notInStore = Object.keys(TOOL_DEFAULT_NAMES).filter(k => !inStore.some(it => it.id === k));
  $('tool-add-select').innerHTML = notInStore.length
    ? notInStore.map(k => `<option value="${k}">${TOOL_DEFAULT_NAMES[k]}</option>`).join('')
    : '<option value="">كل الأدوات موجودة في المتجر</option>';
  $('btn-tool-add-to-store').disabled = !notInStore.length;

  storeBox.innerHTML = inStore.length ? inStore.map(it => `
    <div class="qrow">
      ${it.image ? `<img class="q-thumb" src="${esc(it.image)}" alt="">` : '<span style="font-size:26px">🧰</span>'}
      <div class="q-main">
        <div class="q-title">${esc(typeof it.name === 'string' ? it.name : (it.name?.ar || it.id))}</div>
        <div class="q-sub">🏆 ${it.price} علامات · 🛒 مشتريات: <b>${Number(it.stats?.buys) || 0}</b> · 🏆 المبلغ: <b>${Number(it.stats?.amount) || 0}</b></div>
      </div>
      <button class="btn btn-ghost" data-it-edit="${it.id}">✏️</button>
      <button class="btn btn-warn" data-tool-unstore="${it.id}">↩️ حذف من المتجر</button>
      <button class="btn btn-danger" data-it-del="${it.id}">🗑️</button>
    </div>`).join('')
    : '<p class="muted">لا أدوات في المتجر بعد — أضفها من القائمة أعلاه</p>';

  storeBox.querySelectorAll('[data-tool-unstore]').forEach(b => b.onclick = async () => {
    const ok = await confirmDlg(`إزالة "${TOOL_DEFAULT_NAMES[b.dataset.toolUnstore] || b.dataset.toolUnstore}" من متجر اللاعبين؟`, 'تعود الأداة إلى قسم الإعدادات بالأعلى ويمكن إضافتها مجددًا. من يملكها يبقى يملكها.');
    if (!ok) return;
    await updateDoc(doc(db, 'storeItems', b.dataset.toolUnstore), { active: false });
    await bumpStoreVersion();
    toast('أُزيلت من المتجر — عادت لقسم الإعدادات ✓', 'ok');
    loadStoreAll();
  });
}

function bindItemActions(box) {
  box.querySelectorAll('[data-it-edit]').forEach(b => b.onclick = () => editStoreItem(b.dataset.itEdit));
  box.querySelectorAll('[data-it-toggle]').forEach(b => b.onclick = async () => {
    await updateDoc(doc(db, 'storeItems', b.dataset.itToggle), { active: b.dataset.active !== '1' });
    await bumpStoreVersion();
    loadStoreAll();
  });
  box.querySelectorAll('[data-it-del]').forEach(b => b.onclick = async () => {
    const ok = await confirmDlg('حذف هذا العنصر من المتجر نهائيًا؟', 'من اشتراه يبقى يملكه.');
    if (!ok) return;
    await deleteDoc(doc(db, 'storeItems', b.dataset.itDel));
    await bumpStoreVersion();
    loadStoreAll();
  });
}

async function bumpStoreVersion() {
  const ref = doc(db, 'storeMeta', 'version');
  const snap = await getDoc(ref);
  const v = (snap.exists() ? (snap.data().v || 2) : 2) + 1;
  await setDoc(ref, { v, updatedAt: serverTimestamp() });
  return v;
}

async function loadStoreVersion() {
  try {
    const snap = await getDoc(doc(db, 'storeMeta', 'version'));
    const el = $('store-ver');
    if (el) el.textContent = snap.exists() ? ('v' + (snap.data().v || 2)) : '—';
  } catch {}
}

/** ✏️ تحرير عنصر (الصورة والاسم والسعر) */
function editStoreItem(id) {
  const snap = _itemCache[id];
  if (!snap) return;
  const isBooster = snap.type === 'booster';
  let newImage = null;
  dlgOpen('✏️ تحرير: ' + (snap.name?.ar || id), `
    <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
      <div style="text-align:center">
        <img id="ei-preview" src="${snap.image || ''}" alt=""
             style="width:96px;height:96px;object-fit:contain;border-radius:14px;background:rgba(255,255,255,.06);border:1px solid rgba(148,163,184,.3)">
        <div style="margin-top:8px">
          <label class="btn btn-ghost small" style="cursor:pointer">🖼️ صورة جديدة
            <input type="file" id="ei-image" accept=".png,.jpg,.jpeg,image/png,image/jpeg" style="display:none" />
          </label>
        </div>
        <span id="ei-status" class="muted small"></span>
      </div>
      <div style="flex:1;min-width:220px;display:flex;flex-direction:column;gap:8px">
        <label>الاسم (عربي)
          <input id="ei-name" value="${esc(typeof snap.name === 'string' ? snap.name : (snap.name?.ar || ''))}" maxlength="60" />
        </label>
        <label>${isBooster ? 'السعر بعلامات الانتصار 🏆' : 'السعر بالجواهر 💎'}
          <input id="ei-price" type="number" min="0" max="99999" value="${Number(snap.price) || 0}" />
        </label>
        <label>الوصف (اختياري)
          <input id="ei-desc" value="${esc(snap.desc || '')}" maxlength="140" />
        </label>
      </div>
    </div>`,
    `<button class="btn btn-ghost" data-dlg-cancel>إلغاء</button>
     <button class="btn btn-primary" id="ei-save">💾 حفظ التعديل</button>`);

  $('ei-image').onchange = async () => {
    const f = $('ei-image').files[0];
    const st = $('ei-status');
    newImage = null;
    if (!f) { st.textContent = ''; return; }
    if (!IMG_OK.includes(f.type)) { st.textContent = '⛔ PNG / JPG فقط'; st.style.color = '#f87171'; return; }
    if (f.size > 600 * 1024) { st.textContent = '⛔ الحجم يتجاوز 600KB'; st.style.color = '#f87171'; return; }
    const rd = new FileReader();
    rd.onload = async () => {
      newImage = await toSquareImage(rd.result);
      $('ei-preview').src = newImage;
      st.textContent = '✅ الصورة جاهزة (مربع موحّد)';
      st.style.color = '#4ade80';
    };
    rd.readAsDataURL(f);
  };

  $('ei-save').onclick = async () => {
    const name = $('ei-name').value.trim();
    const price = parseInt($('ei-price').value, 10) || 0;
    const desc = $('ei-desc').value.trim();
    const patch = { price, desc };
    if (name) patch.name = { ...(typeof snap.name === 'object' && snap.name ? snap.name : {}), ar: name };
    if (newImage) patch.image = newImage;
    try {
      await updateDoc(doc(db, 'storeItems', id), patch);
      await bumpStoreVersion();
      toast('تم حفظ التعديل — يظهر للاعبين فورًا ✓', 'ok');
      dlgClose();
      loadStoreAll();
    } catch (e) {
      toast('خطأ: ' + (e?.message || e), 'err');
    }
  };
}

/* ==========================================================
 * 🎁 الجوائز والخزنة — الخزان الرئيسي · العجلة · الصندوق · متجر الجوائز
 * ========================================================== */
const TANK_DOC = () => doc(db, 'gameMeta', 'tank');

/** 🏷️ v37 — رفع إصدار بنك الأسئلة: وثيقة واحدة (questionsMeta) تخبر
 *  أجهزة اللاعبين أن كاشهم أصبح قديمًا فيعيدون بناء البنك مرة واحدة.
 *  هذا يحوّل تكلفة الأسئلة من ~1000 قراءة لكل جلسة لاعب إلى قراءة واحدة
 *  لكل جلسة (وصفحّة الحصة اليومية من صور المستخدم 98/99) */
function _bumpQuestionsVersion() {
  setDoc(doc(db, 'gameMeta', 'questionsMeta'),
    { version: increment(1), at: serverTimestamp() }, { merge: true })
    .catch((e) => console.warn('[admin] questionsMeta bump:', e?.message || e));
}

/* ⚖️ v36 — قانون الحفظ الاقتصادي (طلب المستخدم: «لا يقبل خطأ»):
   العدد الكلي للنظام = Σ علامات الافتراضيين + Σ علامات الحقيقيين + المتبقي.
   المجاميع تتحدث لحظيًا من مستمعي اللاعبين والافتراضيين، وفحص الحفظ
   يقارن خزان العلامات الفعلي بالمتبقي المتوقع ويكشف أي تسريب فورًا،
   وزر «إعادة مزامنة الخزنة» يضبط الخزان على الرقم الصحيح بنقرة. */
const _vaultSums = { vbTokens: 0, vbGems: 0, vbIntel: 0, rTokens: 0, rGems: 0, rIntel: 0 };
let _vaultTotal = 100;        // العدد الكلي للنظام (gameMeta/tank.totalTokens — الافتراضي 100)
let _lastTankTokens = 0;      // آخر قيمة خزان مقروءة (من renderVault)

/** ⚖️ رسم بطاقات قانون الحفظ + توزيع الجواهر وجوائز الذكاء بين اللاعبين */
function renderVaultConservation() {
  const held = _vaultSums.vbTokens + _vaultSums.rTokens;
  const expected = Math.max(0, _vaultTotal - held);
  const diff = Math.round((Number(_lastTankTokens) || 0) - expected);
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('tk-total', _vaultTotal);
  set('tk-virtual-tokens', _vaultSums.vbTokens);
  const chk = $('tk-check');
  if (chk) {
    chk.textContent = diff === 0 ? '✓ متوازن' : (diff > 0 ? `✗ زائد ${diff}` : `✗ ناقص ${Math.abs(diff)}`);
    chk.style.color = diff === 0 ? '#5ee6a5' : '#ff8a8a';
  }
  // 💎🧠 الجواهر وجوائز الذكاء محصورة بين الافتراضيين والحقيقيين
  //    (نفس معادلة التحويل: كل 5 علامات = جوهرة، كل 100 جوهرة = جائزة)
  set('tk-v-gems', _vaultSums.vbGems);
  set('tk-r-gems', _vaultSums.rGems);
  set('tk-a-gems', _vaultSums.vbGems + _vaultSums.rGems);
  set('tk-v-intel', _vaultSums.vbIntel);
  set('tk-r-intel', _vaultSums.rIntel);
  set('tk-a-intel', _vaultSums.vbIntel + _vaultSums.rIntel);
}

const REWARD_KINDS = [
  { v: 'gems',        l: '💎 جواهر' },
  { v: 'tokens',      l: '🏆 علامات انتصار' },
  { v: 'intel',       l: '🧠 جوائز ذكاء' },
  { v: 'tool:rename', l: '✏️ أداة تغيير الاسم' },
  { v: 'tool:skip',   l: '⏭️ أداة تخطي السؤال' },
  { v: 'tool:swap',   l: '🔄 أداة تغيير السؤال' },
  { v: 'tool:freeze', l: '❄️ أداة تجميد الخصم' },
  { v: 'tool:fifty',  l: '✂️ أداة حذف خيارين' }
];
/** 🎯 النسب الافتراضية — القسم 1 = 100% … القسم 10 = 0% (طلب المستخدم) */
const WHEEL_PERCENTS = [100, 80, 60, 40, 30, 10, 5, 2, 1, 0];

function kindOpts(rawKind) {
  return REWARD_KINDS.map(k =>
    `<option value="${k.v}" ${rawKind === k.v ? 'selected' : ''}>${k.l}</option>`).join('');
}

/* ---------------- 🏦 الخزان الرئيسي ---------------- */
async function loadVault() {
  try {
    const snap = await getDoc(TANK_DOC());
    renderVault(snap.exists() ? snap.data() : {});
  } catch (e) { console.warn('vault:', e); }
}

/** 🔴 v25 — رسم الخزان من بيانات جاهزة (يُستدعى لحظيًا من المستمع) */
function renderVault(d = {}) {
  const tokens = Math.max(0, Number(d.tankTokens) || 0);
  const gems = Math.floor(tokens / 5);
  $('tk-tokens').textContent = tokens;
  $('tk-gems').textContent = gems;
  $('tk-intel').textContent = Math.floor(gems / 100);
  // ⚖️ v36 — العدد الكلي للنظام + تحديث فحص الحفظ فورًا
  _vaultTotal = Math.max(0, Math.round(Number(d.totalTokens) || 100));
  _lastTankTokens = tokens;
  const totalInput = $('tk-total-input');
  if (totalInput && document.activeElement !== totalInput) totalInput.value = _vaultTotal;
  renderVaultConservation();
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  // 📤📥 اليوم — من خريطة اليوم
  const outT = d.outToday || {};
  const recT = d.recToday || {};
  set('tk-out-today', outT.date === dayKey() ? (outT.amount || 0) : 0);
  set('tk-rec-today', recT.date === dayKey() ? (recT.amount || 0) : 0);
  set('tk-vdraw', d.virtualDrawnTokens || 0);
  set('tk-vreturn', d.virtualReturnedTokens || 0);
  // 💰 v29 — استرداد علامات اللاعبين المحذوفين إلى الخزنة
  set('tk-pdel', d.playerDeletedTokens || 0);
  set('tk-vdel', d.virtualDeletedTokens || 0);
  set('tk-tools', d.toolPurchaseTokens || 0);
  set('tk-newplayers', d.newPlayerTokens || 0);
  set('cx-wheel-gems', d.wheelGems || 0);
  set('cx-box-gems', d.boxGems || 0);
  set('cx-ex-gems', d.exchangeGems || 0);
  set('cx-ex-intel', d.exchangeIntel || 0);
  set('cx-link-gems', d.linkGems || 0);
  set('cx-char-gems', d.characterGems || 0);
  set('cx-box-tokens', d.boxTokens || 0);
  set('cx-wheel-tokens', d.wheelTokens || 0);
  set('cx-ad-double', d.adDoubleTokens || 0);
  // 🖼️ أيقونة العلامات المخصصة
  const slot = $('tk-ico-slot');
  if (slot) slot.innerHTML = d.tokensIcon ? `<img class="q-thumb" src="${esc(d.tokensIcon)}" alt="">` : '🏆';
  // 🎡🎁 عدادات اليوم للعجلة والصندوق
  const ws = d.wheelSpinsToday || {};
  const bo = d.boxOpensToday || {};
  $('wheel-spins-today').textContent = ws.date === dayKey() ? (ws.count || 0) : 0;
  $('box-opens-today').textContent = bo.date === dayKey() ? (bo.count || 0) : 0;
}

/** ➕ إضافة علامات للخزان — الذرّية increment (إصلاح خطأ increment is not defined) */
$('btn-tk-add').onclick = async () => {
  const n = parseInt($('tk-add').value, 10) || 0;
  if (n <= 0) { showMsg('tk-msg', '⚠️ أدخل عددًا صحيحًا أكبر من صفر', false); return; }
  try {
    const snap = await getDoc(TANK_DOC());
    if (snap.exists()) {
      await updateDoc(TANK_DOC(), {
        tankTokens: increment(n),
        updatedAt: serverTimestamp()
      });
    } else {
      await setDoc(TANK_DOC(), {
        tankTokens: n, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
    }
    showMsg('tk-msg', `✅ أُضيفت ${n} علامة انتصار إلى الخزان الرئيسي`, true);
    loadVault();
  } catch (e) {
    showMsg('tk-msg', '⛔ خطأ: ' + (e?.message || e), false);
  }
};

/** ⚖️ v36 — حفظ العدد الكلي للنظام (أساس قانون الحفظ) */
$('btn-tk-total').onclick = async () => {
  const n = Math.max(0, parseInt($('tk-total-input').value, 10) || 0);
  try {
    await setDoc(TANK_DOC(), { totalTokens: n, updatedAt: serverTimestamp() }, { merge: true });
    _vaultTotal = n;
    showMsg('tk-sync-msg', `✅ أصبح العدد الكلي للنظام ${n} — فحص الحفظ محدّث فورًا`, true);
    loadVault();
  } catch (e) {
    showMsg('tk-sync-msg', '⛔ خطأ: ' + (e?.message || e), false);
  }
};

/** ⚖️ v36 — إعادة مزامنة الخزنة: يضبط خزان العلامات على المتبقي الحقيقي
 *  (الكلي − Σالافتراضيين − Σالحقيقيين) فيحقق قانون الحفظ بنقرة واحدة */
$('btn-tk-resync').onclick = async () => {
  const held = _vaultSums.vbTokens + _vaultSums.rTokens;
  const expected = Math.max(0, _vaultTotal - held);
  const okN = await confirmDlg('⚖️ إعادة مزامنة الخزنة؟',
    `سيُضبط خزان العلامات على ${expected} = الكلي (${_vaultTotal}) − الافتراضيون (${_vaultSums.vbTokens}) − الحقيقيون (${_vaultSums.rTokens}). ملاحظة: اللاعبون الذين حذفت ملفاتهم يدويًا من Console لا يظهرون في المجاميع — علاماتهم ضمن الفرق إن وُجدت.`);
  if (!okN) return;
  try {
    await setDoc(TANK_DOC(), { tankTokens: expected, updatedAt: serverTimestamp() }, { merge: true });
    showMsg('tk-sync-msg', `✅ تمت المزامنة — خزان العلامات الآن ${expected} ويحقق قانون الحفظ ✓`, true);
    loadVault();
  } catch (e) {
    showMsg('tk-sync-msg', '⛔ خطأ: ' + (e?.message || e), false);
  }
};

/** 🧹 v36 — تصفير كل الإحصائيات (حقيقيون + افتراضيون) — بطلب المستخدم:
 *  «أريد عداد يصفر الإحصائيات متى ما شئت». يُصفّر: الجولات، الفوز،
 *  الخسارة، الانتصارات الكلية، الإجابات الصحيحة/الخاطئة — الموارد
 *  (العلامات/الجواهر/الجوائز/الشخصيات) لا تتأثر إطلاقًا */
$('btn-stats-reset').onclick = async () => {
  const ok1 = await confirmDlg('🧹 تصفير كل الإحصائيات؟',
    'تُصفَّر (الجولات، الفوز، الخسارة، الانتصارات الكلية، الإجابات الصحيحة والخاطئة) لكل اللاعبين الحقيقيين والافتراضيين. العلامات والجواهر وجوائز الذكاء والشخصيات لا تتأثر إطلاقًا.');
  if (!ok1) return;
  const ok2 = await confirmDlg('⚠️ تأكيد التصفير', 'تشمل كل اللاعبين وتصبح الإحصائيات صفرًا في لوحة الإدارة وفي ملفاتهم — لا يمكن التراجع. هل أنت متأكد؟');
  if (!ok2) return;
  try {
    const STATS_ZERO = { wins: 0, losses: 0, totalVictories: 0, correctAnswers: 0, wrongAnswers: 0, roundsPlayed: 0 };
    let n = 0;
    for (const col of ['players', 'virtualPlayers']) {
      const snap = await getDocs(query(collection(db, col), limit(1000)));
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = writeBatch(db);
        docs.slice(i, i + 400).forEach(d => batch.update(d.ref, STATS_ZERO));
        await batch.commit();
        n += Math.min(400, docs.length - i);
      }
    }
    toast(`✅ صُفّرت إحصائيات ${n} لاعبًا (حقيقيين وافتراضيين)`, 'ok');
    loadVault();
  } catch (e) {
    toast('خطأ: ' + (e?.message || e), 'err');
  }
};

/** 🖼️ أيقونة علامات الانتصار المخصصة (تُعرض في القسم) */
$('tk-icon').onchange = () => {
  const f = $('tk-icon').files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      const icon = f.type === 'image/svg+xml' ? rd.result : await toSquareImage(rd.result);
      await setDoc(TANK_DOC(), { tokensIcon: icon, updatedAt: serverTimestamp() }, { merge: true });
      toast('حُفظت أيقونة علامات الانتصار ✓', 'ok');
      loadVault();
    } catch (e) { toast('خطأ: ' + (e?.message || e), 'err'); }
  };
  rd.readAsDataURL(f);
};

/** 🔍 بحث الخزان بفترة — سجل حركات الخزان اليومي (gameMeta/ecoLog/{date}) */
$('btn-tk-period').onclick = async () => {
  const out = $('tk-period-out');
  out.textContent = '⏳ جاري الحساب…';
  try {
    const { drawn, recovered, vbDeleted, days } = await sumEcoLog($('tk-from').value, $('tk-to').value);
    out.textContent = `✅ خلال ${days} يوم: سُحبت ${drawn} علامة · استُردت من الجولات ${recovered} علامة` +
      (vbDeleted > 0 ? ` · محذوفات الافتراضيين ${vbDeleted} علامة` : '');
  } catch (e) {
    out.textContent = '⛔ ' + (e?.message || e);
  }
};

/** 📊 جمع سجل الحركات اليومية بين تاريخين */
async function sumEcoLog(fromStr, toStr) {
  const snap = await getDocs(collection(db, 'gameMeta', 'ecoLog', 'days')).catch(() => null);
  let drawn = 0, recovered = 0, vbDeleted = 0, days = 0;
  if (!snap) return { drawn, recovered, vbDeleted, days };
  const from = fromStr || '0000-00-00';
  const to = toStr || '9999-99-99';
  snap.docs.forEach(d => {
    const key = d.id;
    if (key < from || key > to) return;
    days++;
    const v = d.data();
    drawn += Number(v.drawn) || 0;
    recovered += Number(v.recovered) || 0;
    vbDeleted += Number(v.vbDeleted) || 0;   // 🧹 v31.2 — محذوفات الافتراضيين (منفصلة)
  });
  return { drawn, recovered, vbDeleted, days };
}

/* ---------------- 🎡 عجلة المكافآت ---------------- */
function wheelSlotRow(slot = {}, i) {
  const rawKind = slot.toolId ? `tool:${slot.toolId}` : (slot.kind || 'gems');
  const percent = Number.isFinite(Number(slot.percent)) ? Number(slot.percent) : WHEEL_PERCENTS[i] ?? 50;
  const isTool = rawKind.startsWith('tool:');
  const isFreeze = rawKind === 'tool:freeze';
  const isNone = rawKind === 'none';
  const amountDisabled = isNone || (isTool && !isFreeze);
  return `
    <div class="cond-row" style="display:flex;gap:6px;margin-bottom:2px;flex-wrap:wrap" data-w-row="${i}">
      <span class="muted small" style="width:22px;display:inline-flex;align-items:center;justify-content:center">${i + 1}</span>
      <select data-w-kind style="flex:2;min-width:150px">${kindOpts(rawKind)}</select>
      <input data-w-amount type="number" min="1" max="999999" value="${slot.amount ?? 5}"
             style="flex:1;min-width:80px" title="${isFreeze ? 'عدد الأسئلة التي يتجمد فيها الخصم (1-3)' : 'المقدار'}" ${amountDisabled ? 'disabled' : ''} />
      <input data-w-percent type="number" min="0" max="100" value="${percent}"
             style="flex:1;min-width:76px" title="نسبة الظهور %" />
    </div>`;
}

function renderWheelSlotRows(slots) {
  $('wheel-slots').innerHTML = slots.map((s, i) => wheelSlotRow(s, i)).join('');
  $('wheel-slots').querySelectorAll('[data-w-kind]').forEach(sel => {
    sel.onchange = () => {
      const row = sel.closest('[data-w-row]');
      const amt = row.querySelector('[data-w-amount]');
      // ❄️ v31.2 — التجميد وحده يقبل كمية (1-3 أسئلة)؛ بقية الأدوات و none معطلة
      amt.disabled = sel.value === 'none' || (sel.value.startsWith('tool:') && sel.value !== 'tool:freeze');
      if (amt.disabled) amt.value = 1;
      if (sel.value === 'tool:freeze') {
        amt.min = 1; amt.max = 3;
        amt.value = Math.min(3, Math.max(1, parseInt(amt.value, 10) || 1));
      } else { amt.min = 1; amt.max = 999999; }
    };
  });
}

function defaultWheelSlots() {
  return [
    { kind: 'tokens', amount: 5,  percent: 100 },
    { kind: 'gems',   amount: 5,  percent: 80 },
    { kind: 'gems',   amount: 10, percent: 60 },
    { kind: 'tokens', amount: 10, percent: 40 },
    { kind: 'gems',   amount: 25, percent: 30 },
    { kind: 'tool:skip', amount: 1, percent: 10 },
    { kind: 'tokens', amount: 25, percent: 5 },
    { kind: 'gems',   amount: 100, percent: 2 },
    { kind: 'intel',  amount: 1,  percent: 1 },
    { kind: 'gems',   amount: 500, percent: 0 }
  ];
}

$('btn-wheel-reset').onclick = () => { renderWheelSlotRows(defaultWheelSlots()); toast('استُعيدت النسب الافتراضية — عدّلها ثم احفظ', 'ok'); };

$('btn-wheel-save').onclick = async () => {
  const enabled = $('wheel-enabled').checked;
  const intervalMinutes = parseInt($('wheel-interval').value, 10) || 60;
  const rows = Array.from($('wheel-slots').querySelectorAll('[data-w-row]'));
  const slots = rows.map(row => {
    const rawKind = row.querySelector('[data-w-kind]').value;
    const amount = Math.max(1, parseInt(row.querySelector('[data-w-amount]').value, 10) || 1);
    const percent = Math.max(0, Math.min(100, parseInt(row.querySelector('[data-w-percent]').value, 10) || 0));
    if (rawKind.startsWith('tool:')) {
      const tid = rawKind.slice(5);
      // ❄️ v31.2 — التجميد يحفظ كميته (1-3 أسئلة)؛ بقية الأدوات واحد دائمًا
      const amt = tid === 'freeze' ? Math.min(3, Math.max(1, amount)) : 1;
      return { kind: 'tool', toolId: tid, amount: amt, percent };
    }
    return { kind: rawKind, amount, percent };
  });
  if (slots.length < 2) { showMsg('wheel-msg', '⚠️ تحتاج خانتين على الأقل', false); return; }
  if (!slots.some(s => s.percent > 0 && s.kind !== 'none')) {
    showMsg('wheel-msg', '⚠️ لا توجد خانة بنسبة أكبر من صفر — اجعل واحدة قابلة للفوز', false);
    return;
  }
  try {
    await setDoc(doc(db, 'storeMeta', 'wheel'), {
      enabled, intervalMinutes, slots, updatedAt: serverTimestamp()
    }, { merge: true });
    showMsg('wheel-msg', `✅ حُفظت العجلة (${slots.length} خانة) — تظهر للاعبين فورًا`, true);
  } catch (e) {
    showMsg('wheel-msg', '⛔ خطأ: ' + (e?.message || e), false);
  }
};

$('btn-wheel-period').onclick = async () => {
  const out = $('wheel-period-out');
  out.textContent = '⏳ جاري الحساب…';
  try {
    const snap = await getDocs(collection(db, 'gameMeta', 'ecoLog', 'days')).catch(() => null);
    let spins = 0, days = 0;
    if (snap) {
      const from = $('wheel-from').value || '0000-00-00';
      const to = $('wheel-to').value || '9999-99-99';
      snap.docs.forEach(d => {
        const key = d.id;
        if (key < from || key > to) return;
        days++;
        spins += Number(d.data().wheelSpins) || 0;
      });
    }
    out.textContent = `✅ خلال ${days} يوم: ${spins} مرة تحريك`;
  } catch (e) {
    out.textContent = '⛔ ' + (e?.message || e);
  }
};

/* ---------------- 🎁 صندوق المكافآت (أقسام بالتسلسل) ---------------- */
function boxRewardRow(r = {}, i) {
  const rawKind = r.toolId ? `tool:${r.toolId}` : (r.kind || 'gems');
  const isTool = rawKind.startsWith('tool:');
  const isFreeze = rawKind === 'tool:freeze';
  return `
    <div class="cond-row" style="display:flex;gap:6px;margin-bottom:2px;flex-wrap:wrap" data-br-row>
      <span class="muted small" style="width:22px;display:inline-flex;align-items:center;justify-content:center">${i + 1}</span>
      <select data-br-kind style="flex:2;min-width:160px">${kindOpts(rawKind)}</select>
      <input data-br-amount type="number" min="1" max="999999" value="${r.amount ?? 10}"
             style="flex:1;min-width:84px" title="${isFreeze ? 'عدد الأسئلة التي يتجمد فيها الخصم (1-3)' : 'المقدار'}" ${isTool && !isFreeze ? 'disabled' : ''} />
      <button class="btn btn-danger" data-br-del title="حذف القسم">➖</button>
    </div>`;
}

function renderBoxRewardRows(rewards) {
  $('box-rewards').innerHTML = rewards.map((s, i) => boxRewardRow(s, i)).join('');
  $('box-rewards').querySelectorAll('[data-br-kind]').forEach(sel => {
    sel.onchange = () => {
      const amt = sel.closest('[data-br-row]').querySelector('[data-br-amount]');
      // ❄️ v31.2 — التجميد وحده يقبل كمية (1-3 أسئلة)
      amt.disabled = sel.value.startsWith('tool:') && sel.value !== 'tool:freeze';
      if (amt.disabled) amt.value = 1;
      if (sel.value === 'tool:freeze') {
        amt.min = 1; amt.max = 3;
        amt.value = Math.min(3, Math.max(1, parseInt(amt.value, 10) || 1));
      } else { amt.min = 1; amt.max = 999999; }
    };
  });
  $('box-rewards').querySelectorAll('[data-br-del]').forEach(b => {
    b.onclick = () => b.closest('[data-br-row]').remove();
  });
}

function defaultBoxRewards() {
  return [
    { kind: 'tokens', amount: 5 },
    { kind: 'gems', amount: 5 },
    { kind: 'gems', amount: 10 },
    { kind: 'tool:skip', amount: 1 },
    { kind: 'tokens', amount: 10 },
    { kind: 'gems', amount: 25 },
    { kind: 'tool:freeze', amount: 1 },
    { kind: 'tokens', amount: 15 },
    { kind: 'gems', amount: 50 },
    { kind: 'intel', amount: 1 }
  ];
}

function collectBoxRewards() {
  return Array.from($('box-rewards').querySelectorAll('[data-br-row]')).map(row => {
    const rawKind = row.querySelector('[data-br-kind]').value;
    const amount = Math.max(1, parseInt(row.querySelector('[data-br-amount]').value, 10) || 1);
    if (rawKind.startsWith('tool:')) {
      const tid = rawKind.slice(5);
      // ❄️ v31.2 — التجميد يحفظ كميته (1-3 أسئلة)؛ بقية الأدوات واحد
      return { kind: 'tool', toolId: tid, amount: tid === 'freeze' ? Math.min(3, Math.max(1, amount)) : 1 };
    }
    return { kind: rawKind, amount };
  });
}

$('btn-box-add').onclick = () => {
  const rows = collectBoxRewards();
  rows.push({ kind: 'gems', amount: 10 });
  renderBoxRewardRows(rows);
};

$('btn-box-reset').onclick = () => { renderBoxRewardRows(defaultBoxRewards()); toast('استُعيدت الأقسام الافتراضية — عدّلها ثم احفظ', 'ok'); };

$('btn-box-save').onclick = async () => {
  const enabled = $('box-enabled').checked;
  const intervalMinutes = parseInt($('box-interval').value, 10) || 60;
  const rewards = collectBoxRewards();
  if (!rewards.length) { showMsg('box-msg', '⚠️ أضف قسمًا واحدًا على الأقل', false); return; }
  try {
    await setDoc(doc(db, 'storeMeta', 'box'), {
      enabled, intervalMinutes, rewards, updatedAt: serverTimestamp()
    }, { merge: true });
    showMsg('box-msg', `✅ حُفظ الصندوق (${rewards.length} قسم) — يُفتح بالتسلسل`, true);
  } catch (e) {
    showMsg('box-msg', '⛔ خطأ: ' + (e?.message || e), false);
  }
};

$('btn-box-period').onclick = async () => {
  const out = $('box-period-out');
  out.textContent = '⏳ جاري الحساب…';
  try {
    const snap = await getDocs(collection(db, 'gameMeta', 'ecoLog', 'days')).catch(() => null);
    let opens = 0, days = 0;
    if (snap) {
      const from = $('box-from').value || '0000-00-00';
      const to = $('box-to').value || '9999-99-99';
      snap.docs.forEach(d => {
        const key = d.id;
        if (key < from || key > to) return;
        days++;
        opens += Number(d.data().boxOpens) || 0;
      });
    }
    out.textContent = `✅ خلال ${days} يوم: ${opens} مرة فتح`;
  } catch (e) {
    out.textContent = '⛔ ' + (e?.message || e);
  }
};

async function loadWheelBoxAdmin() {
  try {
    const [wSnap, bSnap] = await Promise.all([
      getDoc(doc(db, 'storeMeta', 'wheel')),
      getDoc(doc(db, 'storeMeta', 'box'))
    ]);
    if (wSnap.exists()) {
      const d = wSnap.data();
      $('wheel-enabled').checked = d.enabled !== false;
      $('wheel-interval').value = String(d.intervalMinutes || 60);
      const slots = (Array.isArray(d.slots) && d.slots.length >= 2)
        ? d.slots.map((s, i) => ({ ...s, percent: Number.isFinite(Number(s.percent)) ? s.percent : (WHEEL_PERCENTS[i] ?? 50) }))
        : defaultWheelSlots();
      renderWheelSlotRows(slots);
    } else {
      renderWheelSlotRows(defaultWheelSlots());
    }
    if (bSnap.exists()) {
      const d = bSnap.data();
      $('box-enabled').checked = d.enabled !== false;
      $('box-interval').value = String(d.intervalMinutes || 60);
      renderBoxRewardRows(Array.isArray(d.rewards) && d.rewards.length ? d.rewards : defaultBoxRewards());
    } else {
      renderBoxRewardRows(defaultBoxRewards());
    }
  } catch {}
}

/* ---------------- 🧠 متجر الجوائز ---------------- */
const COND_TYPES = [
  { v: 'avatarsOwned', l: 'امتلاك أفاتار (عدد)' },
  { v: 'toolUses',     l: 'استخدام أدوات مساعدة (مرات)' },
  { v: 'wins',         l: 'فوز بجولات (عدد)' },
  { v: 'roundsPlayed', l: 'لعب جولات (عدد)' },
  { v: 'level',        l: 'الوصول إلى مستوى' }
];

let awCondCount = 0;
$('btn-aw-cond').onclick = () => {
  awCondCount++;
  $('aw-conds').insertAdjacentHTML('beforeend', condRowHTML('aw', awCondCount));
  bindCondDel('aw-conds');
};

function condRowHTML(prefix, i, cond = {}) {
  const opts = COND_TYPES.map(t =>
    `<option value="${t.v}" ${cond.type === t.v ? 'selected' : ''}>${t.l}</option>`).join('');
  return `
    <div class="cond-row" style="display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap" id="${prefix}-row-${i}">
      <select data-c-type style="flex:2;min-width:150px">${opts}</select>
      <input data-c-val type="number" min="1" value="${cond.value || 5}" style="flex:1;min-width:80px" />
      <button class="btn btn-danger small" data-c-del="${prefix}-row-${i}">✖️</button>
    </div>`;
}

function bindCondDel(containerId) {
  $(containerId).querySelectorAll('[data-c-del]').forEach(b => b.onclick = () => {
    document.getElementById(b.dataset.cDel)?.remove();
  });
}

function collectConds(containerId) {
  return Array.from($(containerId).querySelectorAll('[data-c-type]')).map(sel => ({
    type: sel.value,
    value: parseInt(sel.parentElement.querySelector('[data-c-val]').value, 10) || 1
  }));
}

$('btn-aw-save').onclick = async () => {
  const name = $('aw-name').value.trim();
  const price = parseInt($('aw-price').value, 10) || 0;
  const order = parseInt($('aw-order').value, 10) || 0;
  const desc = $('aw-desc').value.trim();
  const conditions = collectConds('aw-conds');
  if (!name) { showMsg('aw-msg', '⚠️ أدخل اسم الجائزة', false); return; }
  if (price < 1) { showMsg('aw-msg', '⚠️ أدخل الثمن بجوائز الذكاء', false); return; }
  if (!awardImageData) { showMsg('aw-msg', '⚠️ ارفع صورة الجائزة', false); return; }
  try {
    await setDoc(doc(collection(db, 'awards')), {
      name, price, order, desc, conditions,
      image: awardImageData,
      active: true,
      createdAt: serverTimestamp()
    });
    showMsg('aw-msg', '✅ نُشرت الجائزة — ظهرت في متجر الرئيسية فورًا', true);
    $('aw-name').value = ''; $('aw-desc').value = '';
    $('aw-conds').innerHTML = '';
    awardImageData = null;
    $('aw-image').value = '';
    $('aw-image-status').textContent = '';
    loadAwardsAdmin();
  } catch (e) {
    showMsg('aw-msg', '⛔ خطأ: ' + (e?.message || e), false);
  }
};

async function loadAwardsAdmin() {
  try {
    const snap = await getDocs(query(collection(db, 'awards'), orderBy('createdAt', 'desc'), limit(60)));
    renderAwardsAdmin(snap.docs);
  } catch (e) {
    const box = $('aw-list');
    if (box) box.innerHTML = '<p class="muted">خطأ: ' + esc(e?.message || e) + '</p>';
  }
}

/** 🔴 v25 — رسم الجوائز من وثائق جاهزة (يُستدعى لحظيًا من المستمع) */
function renderAwardsAdmin(docs) {
  const box = $('aw-list');
  if (!box) return;
  if (!docs.length) { box.innerHTML = '<p class="muted">لا جوائز بعد</p>'; return; }
  box.innerHTML = docs.map(d => {
    const a = d.data();
    const conds = (a.conditions || []).map(c =>
      COND_TYPES.find(t => t.v === c.type)?.l + ' × ' + c.value).join(' · ') || 'بدون شروط';
    _awCache[d.id] = a;
    return `
      <div class="qrow">
        ${a.image ? `<img class="q-thumb" src="${esc(a.image)}" alt="">` : ''}
        <div class="q-main">
          <div class="q-title">${esc(a.name)}</div>
          <div class="q-sub">🧠 ${a.price} · ${esc(a.desc || '')} · ${esc(conds)} · 📦 استلام: <b>${Number(a.claims) || 0}</b> · ${a.active ? 'منشورة' : 'مخفية'}</div>
        </div>
        <button class="btn btn-ghost" data-aw-edit="${d.id}">✏️</button>
        <button class="btn ${a.active ? 'btn-warn' : 'btn-success'}" data-aw-toggle="${d.id}" data-active="${a.active ? 1 : 0}">${a.active ? 'إخفاء' : 'نشر'}</button>
        <button class="btn btn-danger" data-aw-del="${d.id}">🗑️</button>
      </div>`;
  }).join('');
  box.querySelectorAll('[data-aw-edit]').forEach(b => b.onclick = () => editAward(b.dataset.awEdit));
  box.querySelectorAll('[data-aw-toggle]').forEach(b => b.onclick = async () => {
    await updateDoc(doc(db, 'awards', b.dataset.awToggle), { active: b.dataset.active !== '1' });
  });
  box.querySelectorAll('[data-aw-del]').forEach(b => b.onclick = async () => {
    const ok = await confirmDlg('حذف هذه الجائزة نهائيًا؟');
    if (!ok) return;
    await deleteDoc(doc(db, 'awards', b.dataset.awDel));
  });
}

const _awCache = {};
function editAward(id) {
  const a = _awCache[id];
  if (!a) return;
  let newImage = null;
  dlgOpen('✏️ تعديل الجائزة: ' + (a.name || ''), `
    <div style="display:flex;gap:14px;flex-wrap:wrap">
      <img id="ea-prev" src="${a.image || ''}" style="width:96px;height:96px;object-fit:contain;border-radius:12px;background:rgba(255,255,255,.06)">
      <div style="flex:1;min-width:220px;display:flex;flex-direction:column;gap:8px">
        <label>الاسم<input id="ea-name" value="${esc(a.name || '')}" maxlength="80" /></label>
        <label>الثمن 🧠<input id="ea-price" type="number" min="1" value="${Number(a.price) || 1}" /></label>
        <label>التفاصيل<input id="ea-desc" value="${esc(a.desc || '')}" maxlength="200" /></label>
        <label>صورة جديدة<input id="ea-img" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" /></label>
      </div>
    </div>`,
    `<button class="btn btn-ghost" data-dlg-cancel>إلغاء</button>
     <button class="btn btn-primary" id="ea-save">💾 حفظ</button>`);
  $('ea-img').onchange = () => {
    const f = $('ea-img').files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { newImage = rd.result; $('ea-prev').src = newImage; };
    rd.readAsDataURL(f);
  };
  $('ea-save').onclick = async () => {
    const patch = {
      name: $('ea-name').value.trim() || a.name,
      price: parseInt($('ea-price').value, 10) || a.price,
      desc: $('ea-desc').value.trim()
    };
    if (newImage) patch.image = newImage;
    await updateDoc(doc(db, 'awards', id), patch);
    toast('حُفظ تعديل الجائزة ✓', 'ok');
    dlgClose();
    loadAwardsAdmin();
  };
}

/** 🎁 تحميل قسم الجوائز كاملًا */
async function loadRewardsAll() {
  await Promise.all([loadVault(), loadWheelBoxAdmin(), loadAwardsAdmin()]);
}

/* ==========================================================
 * 🎬 الإعلانات — إحصائية كل مرحلة + اليوم + الفترات + الدول
 * ========================================================== */
async function loadAds() {
  try {
    const snap = await getDoc(TANK_DOC());
    renderAds(snap.exists() ? snap.data() : {});
  } catch (e) { console.warn('ads:', e); }
}

/** 🔴 v25 — رسم إحصائيات الإعلانات من بيانات جاهزة (يُستدعى لحظيًا) */
function renderAds(d = {}) {
  const ads = d.adsByKind || {};
  const today = d.adsToday || {};
  const isToday = today.date === dayKey();
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('ad-wheel', ads.wheel || 0);
  set('ad-box', ads.box || 0);
  set('ad-double', ads.double || 0);
  set('ad-prize', ads.prize || 0);
  set('ad-extra', ads.extra || 0);
  const total = Object.values(ads).reduce((a, b) => a + (Number(b) || 0), 0);
  set('ad-total', d.adsViewed || total);
  set('ad-today-total', isToday ? (today.total || 0) : 0);
  set('ad-wheel-today', isToday ? (today.wheel || 0) : 0);
  set('ad-box-today', isToday ? (today.box || 0) : 0);
  set('ad-double-today', isToday ? (today.double || 0) : 0);

  // 🧪 v31.1 — إحصائيات الإعلانات التجريبية: منفصلة كليًا عن الحقيقية
  //   (adsTestViewed / adsByKindTest / adsTodayTest — يكتبها ads.js في وضع testMode)
  const tAds = d.adsByKindTest || {};
  const tToday = d.adsTodayTest || {};
  const isTestToday = tToday.date === dayKey();
  const tTotal = d.adsTestViewed || Object.values(tAds).reduce((a, b) => a + (Number(b) || 0), 0);
  set('ad-test-total', tTotal);
  set('ad-test-wheel', tAds.wheel || 0);
  set('ad-test-box', tAds.box || 0);
  set('ad-test-double', tAds.double || 0);
  set('ad-test-prize', tAds.prize || 0);
  set('ad-test-extra', tAds.extra || 0);
  set('ad-test-today', isTestToday ? (tToday.total || 0) : 0);
  const tNote = $('ad-test-note');
  if (tNote) tNote.textContent = tTotal > 0
    ? 'أرقام التجربة فقط — لن تُضاف لإحصائيات الإعلانات الحقيقية بعد إطفاء وضع الاختبار'
    : 'لا مشاهدات تجريبية بعد — شاهد إعلانًا من اللعبة في وضع الاختبار';
  set('gk-ads', d.adsViewed || total);

  // 🌍 الدول — من خريطة adsByCountry
  const box = $('ads-countries');
  if (!box) return;
  const byCountry = d.adsByCountry || {};
  const rows = Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (!rows.length) { box.innerHTML = '<p class="muted">لا مشاهدات مسجلة بعد</p>'; }
  else {
    const max = rows[0][1] || 1;
    box.innerHTML = rows.map(([cc, n]) => `
      <div class="cbar">
        <span class="cbar-label">${esc(cc)}</span>
        <span class="cbar-track"><i style="width:${Math.max(4, Math.round((n / max) * 100))}%"></i></span>
        <b class="cbar-n">${n}</b>
      </div>`).join('');
  }
}

/* ==========================================================
 * ⚙️ v31 — إعدادات الإعلانات (AdMob) — storeMeta/ads
 *  مفتاح رئيسي + وضع اختبار + فاصل + حد يومي + مفاتيح المواضع.
 *  وحدة الاختبار الرسمية واحدة من Google لكل المواضع، والمفاتيح
 *  الحقيقية الافتراضية مطابقة لحساب الأدمن (تظهر معبأة أول مرة).
 *  اللعبة تقرأ الوثيقة نفسها لحظيًا (game/ads.js — onSnapshot).
 * ========================================================== */
const ADMOB_APP_ID = 'ca-app-pub-1430212159347635~3368025556';
const ADS_TEST_UNIT = 'ca-app-pub-3940256099942544/5224354917';
const ADS_UNIT_DEFAULTS = {
  wheel:  'ca-app-pub-1430212159347635/8732032872',   // Rewards Wheel
  box:    'ca-app-pub-1430212159347635/8550255387',   // Rewards Box
  double: 'ca-app-pub-1430212159347635/2573818639',   // Doubling the round result
  prize:  'ca-app-pub-1430212159347635/5509159072',   // Receiving the cash prize
  extra:  'ca-app-pub-1430212159347635/5916353188'    // Get a chance to play
};
const ADS_UNIT_FIELDS = ['wheel', 'box', 'double', 'prize', 'extra', 'other'];

async function loadAdsSettings() {
  // 🧷 نملأ القيم الافتراضية أولًا (تعمل حتى بلا اتصال)، ثم تُغطى
  //    بأي قيم محفوظة في storeMeta/ads — لا تبقى الحقول فارغة أبدًا
  $('ads-enabled').checked = true;             // افتراضيًا مفعّلة
  $('ads-testmode').checked = false;           // 🛠️ v38: وضع الاختبار مغلق افتراضيًا (فحص الأمان)
  $('ads-cooldown').value = 120;               // دقيقتان بين إعلانين
  $('ads-dailylimit').value = 20;              // حد يومي 20 إعلانًا
  ADS_UNIT_FIELDS.forEach(k => {
    const el = $('ads-unit-' + k);
    if (el && !el.value.trim()) el.value = String(ADS_UNIT_DEFAULTS[k] || '');
  });
  try {
    const snap = await getDoc(doc(db, 'storeMeta', 'ads'));
    if (!snap.exists()) return;
    const d = snap.data();
    $('ads-enabled').checked = d.enabled !== false;
    $('ads-testmode').checked = d.testMode === true;   // 🛠️ v38: تفعيل صريح فقط
    $('ads-cooldown').value = Math.max(0, Math.floor(Number(d.cooldownSec) || 120));
    $('ads-dailylimit').value = Math.max(1, Math.floor(Number(d.dailyLimit) || 20));
    const ids = d.unitIds || {};
    ADS_UNIT_FIELDS.forEach(k => {
      const el = $('ads-unit-' + k);
      if (el && !el.value.trim()) el.value = String(ids[k] || ADS_UNIT_DEFAULTS[k] || '');
    });
  } catch (e) {
    showMsg('ads-settings-msg', '⛔ تعذّر تحميل الإعدادات المحفوظة: ' + (e?.message || e), false);
  }
}

$('btn-ads-settings-save').onclick = async () => {
  const unitIds = {};
  ADS_UNIT_FIELDS.forEach(k => {
    const v = ($('ads-unit-' + k)?.value || '').trim();
    if (v) unitIds[k] = v;
  });
  try {
    await setDoc(doc(db, 'storeMeta', 'ads'), {
      enabled: $('ads-enabled').checked,
      testMode: $('ads-testmode').checked,
      cooldownSec: Math.max(0, Math.floor(Number($('ads-cooldown').value) || 0)),
      dailyLimit: Math.max(1, Math.floor(Number($('ads-dailylimit').value) || 1)),
      unitIds,
      updatedAt: serverTimestamp()
    }, { merge: true });
    showMsg('ads-settings-msg', $('ads-testmode').checked
      ? '✅ حُفظت — وضع الاختبار يعمل: كل المواضع تُظهر إعلان Google التجريبي'
      : '✅ حُفظت — الوضع الرسمي: المواضع تستخدم مفاتيحك الحقيقية (أول إعلان حقيقي يستغرق ساعات حتى تبدأ الخدمة)', true);
    toast('حُفظت إعدادات الإعلانات ✓', 'ok');
  } catch (e) {
    showMsg('ads-settings-msg', '⛔ خطأ: ' + (e?.message || e), false);
  }
};

/** 🔍 بحث الإعلانات بفترة — من السجل اليومي gameMeta/adsLog/{date} */
$('btn-ads-period').onclick = async () => {
  const out = $('ads-period-out');
  out.textContent = '⏳ جاري الحساب…';
  try {
    const snap = await getDocs(collection(db, 'gameMeta', 'adsLog', 'days')).catch(() => null);
    let total = 0, byKind = {}, days = 0;
    if (snap) {
      const from = $('ads-from').value || '0000-00-00';
      const to = $('ads-to').value || '9999-99-99';
      snap.docs.forEach(dk => {
        const key = dk.id;
        if (key < from || key > to) return;
        days++;
        const v = dk.data();
        total += Number(v.total) || 0;
        Object.entries(v.kinds || {}).forEach(([k, n]) => { byKind[k] = (byKind[k] || 0) + (Number(n) || 0); });
      });
    }
    const parts = Object.entries(byKind).map(([k, n]) => `${k}: ${n}`).join(' · ');
    out.textContent = `✅ خلال ${days} يوم: ${total} إعلان ${parts ? '(' + parts + ')' : ''}`;
  } catch (e) {
    out.textContent = '⛔ ' + (e?.message || e);
  }
};

/* ==========================================================
 * 🤖 اللاعبون الافتراضيون — أسماء JSON · شخصيات متعددة · شريطان · نسخ
 * ========================================================== */
const IQ_TEST_ROUNDS = 20;
let vbNames = [];
let editingVbId = null;
let _vbCache = {};
let vbSelectedChars = new Set();

function vbIQ(wins, losses) {
  const played = (Number(wins) || 0) + (Number(losses) || 0);
  if (played < IQ_TEST_ROUNDS) return null;
  return Math.round(((Number(wins) || 0) / Math.max(1, played)) * 100);
}

const VB_FLAGS = [
  ['SA', '🇸🇦 السعودية'], ['EG', '🇪🇬 مصر'], ['AE', '🇦🇪 الإمارات'],
  ['KW', '🇰🇼 الكويت'], ['QA', '🇶🇦 قطر'], ['JO', '🇯🇴 الأردن'],
  ['MA', '🇲🇦 المغرب'], ['DZ', '🇩🇿 الجزائر'], ['IQ', '🇮🇶 العراق'],
  ['PS', '🇵🇸 فلسطين'], ['TN', '🇹🇳 تونس'], ['LY', '🇱🇾 ليبيا'],
  ['SD', '🇸🇩 السودان'], ['OM', '🇴🇲 عمان'], ['BH', '🇧🇭 البحرين'],
  ['YE', '🇾🇪 اليمن'], ['LB', '🇱🇧 لبنان'], ['SY', '🇸🇾 سوريا'],
  ['US', '🇺🇸 أمريكا'], ['GB', '🇬🇧 بريطانيا'], ['FR', '🇫🇷 فرنسا'],
  ['DE', '🇩🇪 ألمانيا'], ['ES', '🇪🇸 إسبانيا'], ['IT', '🇮🇹 إيطاليا'],
  ['RU', '🇷🇺 روسيا'], ['TR', '🇹🇷 تركيا'], ['PK', '🇵🇰 باكستان'],
  ['IN', '🇮🇳 الهند'], ['ID', '🇮🇩 إندونيسيا'], ['MY', '🇲🇾 ماليزيا'],
  ['NG', '🇳🇬 نيجيريا'], ['BR', '🇧🇷 البرازيل'], ['MX', '🇲🇽 المكسيك'],
  ['CN', '🇨🇳 الصين'], ['JP', '🇯🇵 اليابان'], ['KR', '🇰🇷 كوريا']
];

/** تهيئة النموذج: الأعلام + اختيار الشخصيات من المتجر (متعدد) */
async function loadVbForm() {
  const cSel = $('vb-country');
  if (cSel && !cSel.options.length) {
    cSel.innerHTML = VB_FLAGS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  }
  const chBox = $('vb-chars');
  if (chBox && !chBox.dataset.built) {
    renderVbCharGrid();
  }

  // 🎚️ الشريطان
  const bindRange = (rid, vid) => {
    $(rid).oninput = () => { $(vid).textContent = $(rid).value; };
  };
  bindRange('vb-time-min', 'vb-time-min-v');
  bindRange('vb-time-max', 'vb-time-max-v');
  bindRange('vb-acc', 'vb-acc-v');
}

/** 🔴 v25 — شبكة شخصيات النموذج من الكتالوج اللحظي (تتجدد مع المتجر) */
function renderVbCharGrid() {
  const chBox = $('vb-chars');
  if (!chBox) return;
  const chars = _storeItems.filter(it => it.type === 'character' || it.type === 'avatar');
  if (!chars.length) { chBox.innerHTML = '<p class="muted small">أضف شخصيات للمتجر أولًا</p>'; return; }
  chBox.innerHTML = `<button class="btn btn-ghost small" id="btn-vb-allchars" style="margin-bottom:6px">✅ اختيار كل الشخصيات</button><div style="display:flex;flex-wrap:wrap;gap:6px">` +
    chars.map(it => {
      const img = it.image ? `<img class="q-thumb" src="${esc(it.image)}" alt="">` : '✨';
      return `<label class="vb-char-chip ${vbSelectedChars.has(it.id) ? 'on' : ''}" data-vb-char="${it.id}" title="${esc(it.name?.ar || it.id)}">${img}<input type="checkbox" hidden /></label>`;
    }).join('') + '</div>';
  chBox.dataset.built = '1';
  chBox.querySelectorAll('[data-vb-char]').forEach(ch => {
    ch.onclick = (e) => {
      e.preventDefault();
      const id = ch.dataset.vbChar;
      const on = vbSelectedChars.has(id);
      if (on) vbSelectedChars.delete(id); else vbSelectedChars.add(id);
      ch.classList.toggle('on', !on);
    };
  });
  const allBtn = chBox.querySelector('#btn-vb-allchars');
  if (allBtn) allBtn.onclick = () => {
    const chips = chBox.querySelectorAll('[data-vb-char]');
    const allOn = vbSelectedChars.size >= chips.length;
    chips.forEach(ch => {
      const id = ch.dataset.vbChar;
      if (allOn) vbSelectedChars.delete(id); else vbSelectedChars.add(id);
      ch.classList.toggle('on', !allOn);
    });
  };
}

/** ➕ إضافة اسم لقائمة الأسماء */
$('btn-vb-addname').onclick = () => {
  const inp = document.createElement('div');
  inp.style.cssText = 'display:flex;gap:6px;align-items:center';
  inp.innerHTML = `<input class="vb-name-input" maxlength="24" placeholder="اسم للجولات" style="min-width:140px" />
    <button class="btn btn-danger small" data-vbname-del>✖</button>`;
  inp.querySelector('[data-vbname-del]').onclick = () => inp.remove();
  $('vb-names').appendChild(inp);
  inp.querySelector('input').focus();
};

/** 📥 استيراد أسماء من JSON (مثل آلية الأسئلة) */
$('btn-vb-json').onclick = () => {
  const raw = $('vb-json').value.trim();
  if (!raw) { toast('الصق قائمة الأسماء بصيغة JSON', 'err'); return; }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { toast('JSON غير صالح: ' + e.message, 'err'); return; }
  const names = (Array.isArray(parsed) ? parsed : (parsed.names || []))
    .map(n => String(n).trim()).filter(Boolean).slice(0, 200);
  if (!names.length) { toast('لم يُعثر على أسماء في الـJSON', 'err'); return; }
  vbNames = [...new Set([...collectVbNames(), ...names])].slice(0, 200);
  renderVbNames(vbNames);
  $('vb-json').value = '';
  toast(`استُوردت ${names.length} اسمًا ✓`, 'ok');
};

function collectVbNames() {
  return Array.from($('vb-names').querySelectorAll('.vb-name-input'))
    .map(i => i.value.trim()).filter(Boolean).slice(0, 200);
}

function renderVbNames(names) {
  $('vb-names').innerHTML = '';
  (names || []).forEach(n => {
    const inp = document.createElement('div');
    inp.style.cssText = 'display:flex;gap:6px;align-items:center';
    inp.innerHTML = `<input class="vb-name-input" maxlength="24" value="${esc(n)}" style="min-width:140px" />
      <button class="btn btn-danger small" data-vbname-del>✖</button>`;
    inp.querySelector('[data-vbname-del]').onclick = () => inp.remove();
    $('vb-names').appendChild(inp);
  });
}

function resetVbForm() {
  editingVbId = null;
  $('vb-name').value = '';
  $('vb-level').value = 5;
  $('vb-cap').value = 40;
  $('vb-time-min').value = 3; $('vb-time-min-v').textContent = '3';
  $('vb-time-max').value = 11; $('vb-time-max-v').textContent = '11';
  $('vb-acc').value = 85; $('vb-acc-v').textContent = '85';
  vbSelectedChars = new Set();
  document.querySelectorAll('[data-vb-char]').forEach(ch => ch.classList.remove('on'));
  renderVbNames([]);
  $('btn-vb-save').textContent = '➕ حفظ اللاعب الافتراضي';
  $('btn-vb-cancel').classList.add('hidden');
}

$('btn-vb-cancel').onclick = resetVbForm;

$('btn-vb-save').onclick = async () => {
  const name = $('vb-name').value.trim();
  const level = Math.min(200, Math.max(1, parseInt($('vb-level').value, 10) || 1));
  const country = $('vb-country').value || 'SA';
  const cap = Math.max(10, parseInt($('vb-cap').value, 10) || 40);
  const timeMin = Math.max(0, Math.min(10, parseInt($('vb-time-min').value, 10) || 3));
  const timeMax = Math.max(timeMin + 1, Math.min(12, parseInt($('vb-time-max').value, 10) || 11));
  const accuracy = Math.max(20, Math.min(100, parseInt($('vb-acc').value, 10) || 85));
  const names = collectVbNames();
  const characterIds = [...vbSelectedChars];
  const mainChar = characterIds[0] || null;
  if (!name && !names.length) { showMsg('vb-msg', '⚠️ أدخل اسمًا أو قائمة أسماء', false); return; }

  // 📊 v25 (طلب المستخدم): لا إحصائيات مزروعة — لاعب جديد يبدأ بصفر،
  //  والجولات تُحتسب حقيقية من سجل الجولات فقط (كان الإنشاء يزرع أرقامًا
  //  وهمية من المستوى مثل 24 جولة للاعب لم يلعب بعد).

  try {
    if (editingVbId) {
      await updateDoc(doc(db, 'virtualPlayers', editingVbId), {
        name: name || names[0],
        level, country, characterId: mainChar, characterIds,
        names, vaultCap: cap,
        answerWindow: { min: timeMin, max: timeMax },
        accuracy, updatedAt: serverTimestamp()
      });
      showMsg('vb-msg', '✅ حُفظت تعديلات اللاعب الافتراضي', true);
    } else {
      await setDoc(doc(collection(db, 'virtualPlayers')), {
        name: name || names[0],
        level, country,
        characterId: mainChar,
        characterIds,             // 🖼️ كل الجولات تختار شخصية عشوائية من القائمة
        names,
        vaultCap: cap,
        answerWindow: { min: timeMin, max: timeMax },
        accuracy,
        // 💰 الخزنة الصغيرة: 10 علامات + 2 جواهر من الخزان الرئيسي (طلب المستخدم)
        vaultTokens: 10,
        vaultGems: 2,
        // 📊 v25: إحصائيات حقيقية تبدأ من صفر — لا جولات وهمية
        wins: 0,
        losses: 0,
        roundsPlayed: 0,
        totalVictories: 0,
        tokensEarned: 0,
        active: true,
        createdAt: serverTimestamp()
      });
      // 🏦 الخزان الرئيسي يمول الخزنة الصغيرة (10 علامات + جوهرة ثانية من المخزون)
      try {
        await updateDoc(TANK_DOC(), {
          tankTokens: increment(-10),
          virtualDrawnTokens: increment(10),
          updatedAt: serverTimestamp()
        });
      } catch {}
      showMsg('vb-msg', `✅ أُنشئ "${name || names[0]}" (مستوى ${level}) — أخذ 10 علامات و2 جواهر من الخزان`, true);
    }
    resetVbForm();
    loadVbots();
    loadVault();
  } catch (e) {
    showMsg('vb-msg', '⛔ خطأ: ' + (e?.message || e), false);
  }
};

/** 📋 قائمة اللاعبين الافتراضيين + الإجماليات */
async function loadVbots() {
  const box = $('vb-list');
  box.innerHTML = '<p class="muted">جاري التحميل…</p>';
  try {
    const vpSnap = await getDocs(query(collection(db, 'virtualPlayers'), limit(300)));
    renderVbots(vpSnap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (e) {
    box.innerHTML = '<p class="muted">خطأ: ' + esc(e?.message || e) + '</p>';
  }
}

/**
 * 🔴 v25 — رسم قائمة اللاعبين الافتراضيين من بيانات جاهزة (لحظي):
 *  - الإجماليات من اللقطة + مجموع علامات الحقيقيين من لقطة اللاعبين
 *  - 🎨 بطاقة احترافية: بطاقة إحصائيات شبكية بعناوين وقيم + شريط الخزنة
 *  - 📊 جولات حقيقية فقط (لا أرقام مزروعة — طلب المستخدم)
 */
function renderVbots(vps) {
  const box = $('vb-list');
  if (!box) return;
  vps = [...(vps || [])].sort((a, b) => (Number(a.level) || 1) - (Number(b.level) || 1));
  vps.forEach(v => { _vbCache[v.id] = v; });

  $('vb-total').textContent = vps.length;
  const vbTokens = vps.reduce((a, v) => a + (Number(v.vaultTokens ?? v.tokensEarned) || 0), 0);
  const realTokens = _playersLatest.reduce((a, p) => a + (Number(p.tokens) || 0), 0);
  $('vb-tokens-sum').textContent = vbTokens;
  $('vb-real-tokens-sum').textContent = realTokens;
  // ⚖️ v36 — مجاميع الافتراضيين لقانون الحفظ + تحديث فحص الخزنة فورًا
  _vaultSums.vbTokens = vbTokens;
  _vaultSums.vbGems = vps.reduce((a, v) => a + Math.floor((Number(v.vaultTokens ?? v.tokensEarned) || 0) / 5), 0);
  _vaultSums.vbIntel = vps.reduce((a, v) => a + Math.floor(Math.floor((Number(v.vaultTokens ?? v.tokensEarned) || 0) / 5) / 100), 0);
  renderVaultConservation();

  if (!vps.length) {
    box.innerHTML = '<p class="muted">لا لاعبين افتراضيين بعد — أنشئ الأول من الأعلى</p>';
    return;
  }

  // 🖼️ صور الشخصيات من كتالوج المتجر اللحظي (بلا قراءات إضافية)
  const charsById = {};
  _storeItems.forEach(it => {
    if (it.type === 'character' || it.type === 'avatar') charsById[it.id] = it.image || '';
  });

  box.innerHTML = vps.map(v => {
    const level = Number(v.level) || 1;
    // 📊 جولات حقيقية فقط — لا fallback يخترع أرقامًا (طلب المستخدم)
    const wins = Number(v.wins) || 0;
    const losses = Number(v.losses) || 0;
    const played = Number(v.roundsPlayed) || 0;
    const iq = vbIQ(wins, losses);
    const namesN = Array.isArray(v.names) ? v.names.length : 0;
    const charsN = Array.isArray(v.characterIds) ? v.characterIds.length : (v.characterId ? 1 : 0);
    const img = v.characterId && charsById[v.characterId];
    const flag = (VB_FLAGS.find(f => f[0] === (v.country || 'SA')) || ['', '🏳️'])[1].split(' ')[0];
    const acc = Number(v.accuracy) || null;
    const win = v.answerWindow || {};
    const vault = Number(v.vaultTokens ?? v.tokensEarned) || 0;
    const cap = Math.max(1, Number(v.vaultCap) || 40);
    const vaultPct = Math.min(100, Math.round((vault / cap) * 100));
    const hasStats = (wins + losses + played) > 0;
    return `
      <div class="vb-row">
        <span class="vb-av-wrap">
          ${img ? `<img class="vb-av" src="${esc(img)}" alt="">` : `<span class="vb-av vb-av-flag">${flag}</span>`}
          <span class="vb-lvl-badge">${level}</span>
        </span>
        <div class="vb-main">
          <div class="vb-name">
            <span class="vb-flag">${flag}</span>
            <span class="vb-nm">${esc(v.name || 'لاعب')}</span>
            ${namesN > 1 ? `<span class="vb-chip soft">${namesN} أسماء</span>` : ''}
            ${charsN > 1 ? `<span class="vb-chip soft">${charsN} شخصيات</span>` : ''}
            <span class="vb-chip soft">مستوى ${level}</span>
          </div>
          <div class="vb-stats">
            <span class="vb-stat"><small>الجولات</small><b>${played}</b></span>
            <span class="vb-stat ok"><small>فوز</small><b>${wins}</b></span>
            <span class="vb-stat bad"><small>خسارة</small><b>${losses}</b></span>
            <span class="vb-stat"><small>الذكاء</small><b>${iq != null ? iq + '%' : 'قياس'}</b></span>
            <span class="vb-stat"><small>دقة الإجابة</small><b>${acc ? acc + '%' : '—'}</b></span>
            <span class="vb-stat"><small>نافذة الإجابة</small><b>${win.min ?? '—'}→${win.max ?? '—'} ث</b></span>
          </div>
          <div class="vb-vault">
            <span class="vb-vault-label">💰 خزنته ${vault}/${cap}</span>
            <span class="vb-vault-track"><i style="width:${vaultPct}%"></i></span>
            <span class="vb-chip soft">💎 ${Number(v.vaultGems) || 0}</span>
          </div>
        </div>
        <div class="row-actions">
          <button class="btn btn-ghost small" data-vb-hist="${v.id}">📜 السجل</button>
          <button class="btn btn-ghost small" data-vb-copy="${v.id}" title="نسخ اللاعب">📄 نسخ</button>
          ${hasStats ? `<button class="btn btn-ghost small" data-vb-reset="${v.id}" title="جولات حقيقية فقط — يصفّر ما لُعب">📊 تصفير</button>` : ''}
          <button class="btn btn-primary small" data-vb-edit="${v.id}">✏️</button>
          <button class="btn btn-danger small" data-vb-del="${v.id}">🗑️</button>
        </div>
      </div>`;
  }).join('');

  box.querySelectorAll('[data-vb-hist]').forEach(b => b.onclick = () => openVbHistory(b.dataset.vbHist));
  box.querySelectorAll('[data-vb-copy]').forEach(b => b.onclick = () => copyVbot(b.dataset.vbCopy));
  box.querySelectorAll('[data-vb-reset]').forEach(b => b.onclick = async () => {
    const v = _vbCache[b.dataset.vbReset];
    const ok = await confirmDlg(`📊 تصفير إحصائيات "${v?.name}"؟`, 'تصبح الجولات والفوز والخسارة صفرًا — يبدأ العد من جولات حقيقية جديدة فقط. الخزنة لا تتأثر.');
    if (!ok) return;
    await updateDoc(doc(db, 'virtualPlayers', b.dataset.vbReset), {
      wins: 0, losses: 0, roundsPlayed: 0, totalVictories: 0, updatedAt: serverTimestamp()
    });
    toast('صفّرت الإحصائيات — سيظهر العد الحقيقي من الآن ✓', 'ok');
  });
  box.querySelectorAll('[data-vb-edit]').forEach(b => b.onclick = () => {
    const v = _vbCache[b.dataset.vbEdit];
    if (!v) return;
    editingVbId = v.id;
    $('vb-name').value = v.name || '';
    $('vb-level').value = Number(v.level) || 1;
    $('vb-country').value = v.country || 'SA';
    $('vb-cap').value = Number(v.vaultCap) || 40;
    $('vb-time-min').value = v.answerWindow?.min ?? 3;
    $('vb-time-min-v').textContent = $('vb-time-min').value;
    $('vb-time-max').value = v.answerWindow?.max ?? 11;
    $('vb-time-max-v').textContent = $('vb-time-max').value;
    $('vb-acc').value = v.accuracy ?? 85;
    $('vb-acc-v').textContent = $('vb-acc').value;
    vbSelectedChars = new Set(Array.isArray(v.characterIds) && v.characterIds.length ? v.characterIds : (v.characterId ? [v.characterId] : []));
    document.querySelectorAll('[data-vb-char]').forEach(ch => ch.classList.toggle('on', vbSelectedChars.has(ch.dataset.vbChar)));
    renderVbNames(Array.isArray(v.names) ? v.names : []);
    $('btn-vb-save').textContent = '💾 حفظ التعديل';
    $('btn-vb-cancel').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  box.querySelectorAll('[data-vb-del]').forEach(b => b.onclick = async () => {
    const v = _vbCache[b.dataset.vbDel];
    const ok = await confirmDlg(`حذف اللاعب الافتراضي "${v?.name}" نهائيًا؟`,
      '💰 خزنته (علاماته المجمّعة) تعود إلى الخزنة الرئيسية قبل الحذف — لا تضيع معه.');
    if (!ok) return;
    // 💰 v29 (طلب المستخدم): خزنة اللاعب الافتراضي تعود إلى الخزان الرئيسي
    //    عند حذفه — عدّاد مستقل عن استرداد اللاعبين الحقيقيين
    const vaultTokens = Math.max(0, Number(v?.vaultTokens ?? v?.tokensEarned) || 0);
    if (vaultTokens > 0) {
      try { await bumpTankField(vaultTokens); }
      catch (e) { console.warn('vb tank return:', e?.message || e); }
    }
    await deleteDoc(doc(db, 'virtualPlayers', b.dataset.vbDel));
    toast(vaultTokens > 0
      ? `تم حذف اللاعب الافتراضي 🗑️ — عادت ${vaultTokens} علامة من خزنته إلى الخزنة الرئيسية 💰`
      : 'تم حذف اللاعب الافتراضي 🗑️', 'ok');
    loadVault();
  });
}

/** 💰 v29 — إعادة علامات إلى الخزان الرئيسي (عدّاد حذف الافتراضيين) */
async function bumpTankField(n) {
  try {
    await updateDoc(TANK_DOC(), {
      tankTokens: increment(n),
      virtualDeletedTokens: increment(n),
      updatedAt: serverTimestamp()
    });
  } catch (e) {
    // الوثيقة غير موجودة (أول حركة) — أنشئها بالقيم المطلقة
    await setDoc(TANK_DOC(), {
      tankTokens: n, virtualDeletedTokens: n,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
  }
  // 🧾 سجل حركات الخزان اليومي (يظهر في بحث الفترة: محذوفات الافتراضيين)
  // 🧹 v31.2 — حذف لاعب افتراضي لم يعد يُحسب في «المسترد» — عدّاد مستقل
  //    (vbDeleted) لأن الاسترداد يعكس نتيجة جولات اللاعبين الحقيقيين فقط
  try {
    await setDoc(doc(db, 'gameMeta', 'ecoLog', 'days', dayKey()),
      { vbDeleted: increment(n), updatedAt: serverTimestamp() }, { merge: true });
  } catch {}
}

/** 📄 نسخ لاعب افتراضي — كل بياناته في وثيقة جديدة (طلب المستخدم) */
async function copyVbot(vbId) {
  const v = _vbCache[vbId];
  if (!v) return;
  const ok = await confirmDlg(`نسخ اللاعب "${v.name}"؟`, 'تُنسخ كل بياناته (المستوى والأسماء والشخصيات والشريطان والخزنة) إلى لاعب جديد — يمكنك تعديله بعد النسخ.');
  if (!ok) return;
  try {
    const data = { ...v };
    delete data.id;
    data.name = (v.name || 'لاعب') + ' نسخة';
    // 📊 v25: النسخة تبدأ بإحصائيات صفر — السجل للنسخة الأصلية وحدها
    data.wins = 0;
    data.losses = 0;
    data.roundsPlayed = 0;
    data.totalVictories = 0;
    data.createdAt = serverTimestamp();
    data.updatedAt = serverTimestamp();
    await setDoc(doc(collection(db, 'virtualPlayers')), data);
    toast('تم نسخ اللاعب الافتراضي 📄 — عدّل بياناته ثم احفظ', 'ok');
    loadVbots();
  } catch (e) {
    toast('خطأ: ' + (e?.message || e), 'err');
  }
}

/** 📜 سجل جولات لاعب افتراضي — مرتب بالأحدث + بحث بفترة */
async function openVbHistory(vbId) {
  const v = _vbCache[vbId];
  dlgOpen(`📜 سجل الجولات — ${esc(v?.name || '')}`, `
    <div class="row-between" style="flex-wrap:wrap;gap:8px;margin-bottom:8px">
      <label class="muted small" style="display:flex;align-items:center;gap:5px;margin:0">من
        <input type="date" id="vh-from" style="width:125px" /> إلى <input type="date" id="vh-to" style="width:125px" />
      </label>
      <button class="btn btn-ghost small" id="vh-period">🔍 بحث بفترة</button>
      <span class="muted small" id="vh-out"></span>
    </div>
    <div id="vh-list"><p class="muted">جاري التحميل…</p></div>`,
    '<button class="btn btn-ghost" data-dlg-cancel>إغلاق</button>');

  const render = (docs) => {
    const list = $('vh-list');
    if (!docs.length) { list.innerHTML = '<p class="muted">لا جولات بعد — سيُسجل كل تحدي يلعبه تلقائيًا هنا</p>'; return; }
    list.innerHTML = docs.map(d => {
      const h = d.data();
      const win = h.result === 'win';
      const at = h.at?.toDate ? h.at.toDate().toLocaleString('ar') : '—';
      return `
        <div class="vb-hist-row ${win ? 'w' : 'l'}">
          <span class="vb-hist-res">${win ? '🏆 فوز' : '💔 خسارة'}</span>
          <span>${Number(h.myScore) || 0} — ${Number(h.oppScore) || 0}</span>
          <span class="muted small">${esc(h.opponent?.name || 'لاعب')} · ${at}</span>
        </div>`;
    }).join('');
  };

  let allDocs = [];
  try {
    const snap = await getDocs(query(collection(db, 'virtualPlayers', vbId, 'history'), orderBy('at', 'desc'), limit(80)));
    allDocs = snap.docs;
    render(allDocs);
  } catch (e) {
    $('vh-list').innerHTML = '<p class="muted">خطأ: ' + esc(e?.message || e) + '</p>';
    return;
  }

  $('vh-period').onclick = () => {
    const from = $('vh-from').value ? new Date($('vh-from').value + 'T00:00:00').getTime() : 0;
    const to = $('vh-to').value ? new Date($('vh-to').value + 'T23:59:59').getTime() : Infinity;
    const filtered = allDocs.filter(d => {
      const ms = d.data().at?.toMillis?.() || 0;
      return ms >= from && ms <= to;
    });
    const wins = filtered.filter(d => d.data().result === 'win').length;
    $('vh-out').textContent = `✅ لعب ${filtered.length} جولة في الفترة (${wins} فوز)`;
    render(filtered);
  };
}

/** 🧹 تفريغ سجلات الجولات حسب المدة المختارة */
$('btn-vb-purge').onclick = async () => {
  const days = parseInt($('vb-purge').value, 10) || 0;
  const label = days === 0 ? 'حذف كل السجلات' : `حذف السجلات الأقدم من ${days} يوم`;
  const ok = await confirmDlg(`⚠️ ${label} لكل اللاعبين الافتراضيين؟`);
  if (!ok) return;
  const msg = $('vb-purge-msg');
  msg.textContent = '⏳ جاري التفريغ…';
  msg.className = 'form-msg';
  try {
    const vps = await getDocs(collection(db, 'virtualPlayers'));
    let deleted = 0;
    for (const vp of vps.docs) {
      let snap;
      try {
        snap = days > 0
          ? await getDocs(query(collection(db, 'virtualPlayers', vp.id, 'history'), where('at', '<', new Date(Date.now() - days * 86400000)), limit(400)))
          : await getDocs(query(collection(db, 'virtualPlayers', vp.id, 'history'), limit(400)));
      } catch { continue; }
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref).catch(() => {})));
      deleted += snap.docs.length;
    }
    msg.textContent = `✅ تم تفريغ ${deleted} سجل جولة`;
    msg.className = 'form-msg ok';
    setTimeout(() => { msg.textContent = ''; }, 5000);
  } catch (e) {
    msg.textContent = '⛔ خطأ: ' + (e?.message || e);
    msg.className = 'form-msg err';
  }
};

/* ==========================================================
 * ❓ الأسئلة — إضافة وتعديل + بحث وحذف بفترة + تحديث لحظي
 * ========================================================== */
let editingQid = null;
let questionsUnsub = null;
let _qAllDocs = [];
const qCache = {};

function resetQuestionForm() {
  editingQid = null;
  ['q-ar', 'q-o1', 'q-o2', 'q-o3', 'q-o4'].forEach(id => { $(id).value = ''; });
  $('q-correct').value = '0';
  $('btn-q-save').textContent = '➕ حفظ السؤال';
  $('btn-q-cancel').classList.add('hidden');
}

$('btn-q-cancel').onclick = resetQuestionForm;

$('btn-q-save').onclick = async () => {
  const qAr = $('q-ar').value.trim();
  const opts = [$('q-o1').value.trim(), $('q-o2').value.trim(), $('q-o3').value.trim(), $('q-o4').value.trim()].filter(Boolean);
  const correct = parseInt($('q-correct').value, 10);

  if (!qAr || opts.length < 2) { showMsg('q-msg', '⚠️ أكمل السؤال وخيارين على الأقل', false); return; }
  if (correct >= opts.length) { showMsg('q-msg', '⚠️ الإجابة الصحيحة يجب أن تكون ضمن الخيارات المملوءة', false); return; }

  try {
    if (editingQid) {
      await updateDoc(doc(db, 'questions', editingQid), {
        q: qAr, options: opts, correct, updatedAt: serverTimestamp()
      });
      _bumpQuestionsVersion();   // 🏷️ v37 — أجهزة اللاعبين تعيد البناء عند الدخول القادم
      showMsg('q-msg', '✅ تم حفظ التعديل — يظهر للاعبين فورًا', true);
    } else {
      await setDoc(doc(collection(db, 'questions')), {
        q: qAr, options: opts, correct,
        active: true,
        source: 'admin',
        createdAt: serverTimestamp()
      });
      _bumpQuestionsVersion();   // 🏷️ v37 — توفير ~1000 قراءة لكل جلسة لاعب
      showMsg('q-msg', '✅ تم حفظ السؤال — يدخل توزيع الأسئلة فوراً ويُترجم تلقائيًا', true);
    }
    resetQuestionForm();
  } catch (e) {
    showMsg('q-msg', '⛔ خطأ: ' + (e?.message || e), false);
  }
};

function startEditQuestion(id) {
  const q = qCache[id];
  if (!q) return;
  editingQid = id;
  $('q-ar').value = q.text || '';
  const opts = q.options || [];
  ['q-o1', 'q-o2', 'q-o3', 'q-o4'].forEach((fid, i) => { $(fid).value = opts[i] || ''; });
  $('q-correct').value = String(q.correct ?? 0);
  $('btn-q-save').textContent = '💾 حفظ التعديل';
  $('btn-q-cancel').classList.remove('hidden');
  $('q-ar').focus();
}

async function refreshQuestionTotal() {
  try {
    const n = (await getCountFromServer(query(collection(db, 'questions')))).data().count;
    $('q-total').textContent = n;
  } catch {}
}

function loadQuestions() {
  if (questionsUnsub) questionsUnsub();
  questionsUnsub = onSnapshot(
    query(collection(db, 'questions'), orderBy('createdAt', 'desc'), limit(300)),
    (snap) => {
      _qAllDocs = snap.docs;
      refreshQuestionTotal().catch(() => {});
      renderQuestions(_qAllDocs);
    },
    (e) => { console.warn('questions listener:', e); }
  );
}

/** 📜 رسم الأسئلة — الأحدث أولًا (مع فلتر فترة اختياري) */
function renderQuestions(docs) {
  const box = $('q-list');
  if (!docs.length) {
    box.innerHTML = '<p class="muted">لا أسئلة بعد — أضف أول سؤال من الأعلى</p>';
    return;
  }
  box.innerHTML = docs.slice(0, 120).map(d => {
    const q = d.data();
    const text = typeof q.q === 'string' ? q.q : (q.q?.ar || '');
    const opts = Array.isArray(q.options) ? q.options : (q.options?.ar || []);
    qCache[d.id] = { text, options: opts, correct: q.correct, active: q.active };
    return `
      <div class="qrow ${editingQid === d.id ? 'editing' : ''}">
        <div class="q-main">
          <div class="q-title">${esc(text)}</div>
          <div class="q-sub">✅ الصحيح: ${esc(opts[q.correct] ?? '—')} · ${fmtTime(d.data().createdAt)} ${q.active ? '' : '· مخفي'}</div>
        </div>
        <button class="btn btn-ghost" data-q-edit="${d.id}" title="تعديل السؤال">✏️</button>
        <button class="btn ${q.active ? 'btn-warn' : 'btn-success'}" data-q-toggle="${d.id}" data-active="${q.active ? 1 : 0}">${q.active ? 'إخفاء' : 'تنشيط'}</button>
        <button class="btn btn-danger" data-q-del="${d.id}">🗑️</button>
      </div>`;
  }).join('');

  box.querySelectorAll('[data-q-edit]').forEach(b => b.onclick = () => startEditQuestion(b.dataset.qEdit));
  box.querySelectorAll('[data-q-toggle]').forEach(b => b.onclick = async () => {
    await updateDoc(doc(db, 'questions', b.dataset.qToggle), { active: b.dataset.active !== '1' });
  });
  box.querySelectorAll('[data-q-del]').forEach(b => b.onclick = async () => {
    const ok = await confirmDlg('حذف هذا السؤال نهائيًا؟');
    if (!ok) return;
    if (editingQid === b.dataset.qDel) resetQuestionForm();
    await deleteDoc(doc(db, 'questions', b.dataset.qDel));
    _bumpQuestionsVersion();   // 🏷️ v37 — حذف سؤال يعني كاش اللاعبين قديم
  });
}

/** 🔍 بحث الأسئلة بفترة الإضافة */
$('btn-q-period').onclick = () => {
  const from = $('q-from').value ? new Date($('q-from').value + 'T00:00:00').getTime() : 0;
  const to = $('q-to').value ? new Date($('q-to').value + 'T23:59:59').getTime() : Infinity;
  const filtered = _qAllDocs.filter(d => {
    const ms = d.data().createdAt?.toMillis?.() || 0;
    return ms >= from && ms <= to;
  });
  renderQuestions(filtered);
  toast(`عرض ${filtered.length} سؤال من الفترة المحددة`, 'ok');
};

/** 🗑️ حذف أسئلة فترة كاملة (الأسئلة القديمة التي حفظها اللاعبون) */
$('btn-q-del-period').onclick = async () => {
  const from = $('q-from').value ? new Date($('q-from').value + 'T00:00:00').getTime() : 0;
  const to = $('q-to').value ? new Date($('q-to').value + 'T23:59:59').getTime() : Infinity;
  if (!from && to === Infinity) { toast('حدد الفترة أولًا (من / إلى)', 'err'); return; }
  const targets = _qAllDocs.filter(d => {
    const ms = d.data().createdAt?.toMillis?.() || 0;
    return ms >= from && ms <= to;
  });
  if (!targets.length) { toast('لا أسئلة في هذه الفترة', 'err'); return; }
  const ok = await confirmDlg(`حذف ${targets.length} سؤال من الفترة المحددة نهائيًا؟`, 'الحذف يمنع ظهورها للاعبين من جديد — مناسب للأسئلة القديمة جدًا.');
  if (!ok) return;
  try {
    for (let i = 0; i < targets.length; i += 400) {
      const batch = writeBatch(db);
      targets.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    toast(`🗑️ حُذفت ${targets.length} سؤال`, 'ok');
  } catch (e) {
    toast('خطأ: ' + (e?.message || e), 'err');
  }
};

/* ---------------- 📥 استيراد الأسئلة المجمّع ---------------- */
$('q-import-file').onchange = () => {
  const f = $('q-import-file').files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { $('q-import').value = rd.result; };
  rd.readAsText(f);
};

$('btn-q-import').onclick = async () => {
  const raw = $('q-import').value.trim();
  if (!raw) { showMsg('q-import-msg', '⚠️ الصق JSON أو اختر ملفًا', false); return; }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { showMsg('q-import-msg', '⛔ JSON غير صالح: ' + e.message, false); return; }

  const flat = [];
  const pushQ = (q) => {
    const opts = Array.isArray(q.options) ? q.options
      : (Array.isArray(q.options?.ar) ? q.options.ar : null);
    const text = typeof q.q === 'string' ? q.q : (q.q?.ar || '');
    if (!text || !opts || opts.length < 2) return;
    if (typeof q.correct !== 'number' || q.correct >= opts.length) return;
    flat.push({ q: text, options: opts, correct: q.correct });
  };

  if (Array.isArray(parsed)) {
    parsed.forEach(pushQ);
  } else if (typeof parsed === 'object') {
    const looksLikeSeed = Object.values(parsed).some(v => v && typeof v === 'object' && Array.isArray(v.easy));
    if (looksLikeSeed) {
      Object.values(parsed).forEach(cat => {
        ['easy', 'medium', 'hard'].forEach(diff => (cat[diff] || []).forEach(pushQ));
      });
    } else {
      ['easy', 'medium', 'hard'].forEach(diff => (parsed[diff] || []).forEach(pushQ));
    }
  }

  if (!flat.length) { showMsg('q-import-msg', '⛔ لم يُعثر على أسئلة صالحة في الملف', false); return; }

  try {
    let done = 0;
    for (let i = 0; i < flat.length; i += 400) {
      const batch = writeBatch(db);
      flat.slice(i, i + 400).forEach(q => {
        batch.set(doc(collection(db, 'questions')), {
          ...q, active: true, source: 'admin', createdAt: serverTimestamp()
        });
      });
      await batch.commit();
      done += Math.min(400, flat.length - i);
    }
    _bumpQuestionsVersion();   // 🏷️ v37 — استيراد دفعة كامل يرفع الإصدار مرة واحدة
    showMsg('q-import-msg', `✅ تم استيراد ${done} سؤالًا — دخلت التوزيع فوراً`, true);
    $('q-import').value = '';
  } catch (e) {
    showMsg('q-import-msg', '⛔ خطأ: ' + (e?.message || e), false);
  }
};

/* ==========================================================
 * 🌍 اللغات — التجاوزات + إحصائية لغات اللاعبين
 * ========================================================== */
$('btn-ln-load').onclick = () => loadLangOverridesAdmin();
$('btn-ln-save').onclick = async () => {
  const lang = $('ln-lang').value;
  const key = $('ln-key').value.trim();
  const value = $('ln-value').value.trim();
  if (!key || !value) { toast('أدخل المفتاح والقيمة', 'err'); return; }
  await setDoc(doc(db, 'translations', lang), { overrides: { [key]: value } }, { merge: true });
  toast(`تم حفظ التجاوز (${lang}) ✓`, 'ok');
  $('ln-key').value = ''; $('ln-value').value = '';
  loadLangOverridesAdmin();
};

async function loadLangOverridesAdmin() {
  const lang = $('ln-lang').value;
  const box = $('ln-list');
  const snap = await getDoc(doc(db, 'translations', lang));
  const overrides = snap.exists() ? (snap.data().overrides || {}) : {};
  const keys = Object.keys(overrides);
  if (!keys.length) { box.innerHTML = '<p class="muted">لا تجاوزات لهذه اللغة — أضف واحداً من الأعلى</p>'; return; }
  box.innerHTML = keys.map(k => `
    <div class="qrow">
      <span class="ln-key">${esc(k)}</span>
      <input class="ln-val" data-ln-k="${esc(k)}" value="${esc(overrides[k])}" />
      <button class="btn btn-primary small" data-ln-save="${esc(k)}">حفظ</button>
      <button class="btn btn-danger small" data-ln-del="${esc(k)}">✖️</button>
    </div>`).join('');

  box.querySelectorAll('[data-ln-save]').forEach(b => b.onclick = async () => {
    const k = b.dataset.lnSave;
    const v = box.querySelector(`[data-ln-k="${k}"]`).value;
    await setDoc(doc(db, 'translations', lang), { overrides: { [k]: v } }, { merge: true });
    toast('تم الحفظ ✓', 'ok');
  });
  box.querySelectorAll('[data-ln-del]').forEach(b => b.onclick = async () => {
    const k = b.dataset.lnDel;
    const ok = await confirmDlg(`حذف تجاوز المفتاح "${k}"؟`, 'ستعود الترجمة المدمجة.');
    if (!ok) return;
    const payload = {};
    payload['overrides.' + k] = null;
    await updateDoc(doc(db, 'translations', lang), payload);
    loadLangOverridesAdmin();
  });
}

/** 📊 إحصائية اللغات المختارة من اللاعبين الحقيقيين — 🔴 v25 لحظي من لقطة اللاعبين */
function renderLangStatsFromPlayers() {
  const box = $('lang-stats');
  if (!box) return;
  const counts = {};
  _playersLatest.forEach(p => {
    const l = p.lang || '—';
    counts[l] = (counts[l] || 0) + 1;
  });
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!rows.length) { box.innerHTML = '<p class="muted">لا لاعبين بعد</p>'; return; }
  const max = rows[0][1] || 1;
  box.innerHTML = `
    <p class="muted small">عدد اللغات المستخدمة: <b>${rows.length}</b></p>` +
    rows.map(([lg, n]) => `
    <div class="cbar">
      <span class="cbar-label">${esc(lg)}</span>
      <span class="cbar-track"><i style="width:${Math.max(4, Math.round((n / max) * 100))}%"></i></span>
      <b class="cbar-n">${n}</b>
    </div>`).join('');
}

async function loadLangStats() {
  try {
    const snap = await getDocs(query(collection(db, 'players'), limit(1000)));
    // 🐞 v32 — نفس إصلاح الترتيب (uid = معرّف الوثيقة دائمًا)
    _playersLatest = snap.docs.map(d => ({ ...d.data(), uid: d.id }));
    renderLangStatsFromPlayers();
  } catch (e) {
    const box = $('lang-stats');
    if (box) box.innerHTML = '<p class="muted">خطأ: ' + esc(e?.message || e) + '</p>';
  }
}

/* ==========================================================
 * 🎨 التحكم في الأيقونات — v27 (طلب المستخدم)
 *  كل أيقونات اللعبة في قائمة واحدة: معاينة + تفاصيل + تغيير/استعادة.
 *  • الرفع يقبل PNG / ICO (وJPG وSVG أيضًا) — الصورة تُقصّ من المنتصف
 *    وتُصغَّر/تُكبَّر تلقائيًا لمقاس المربع المطلوب (Canvas داخل المتصفح)
 *    وتُحفظ PNG شفاف.
 *  • الحفظ في مجموعة iconOverrides/{key} بقاعدة البيانات، واللعبة
 *    تطبّقه لحظيًا على كل الأجهزة المفتوحة (مستمع onSnapshot في اللعبة).
 *  • 🧩 الشخصية الافتراضية (defaultAvatar): يأخذها كل لاعب جديد مجانًا
 *    فور انضمامه — ويمكنه لاحقًا شراء شخصيات من المتجر.
 * ========================================================== */
const ICON_CATALOG = [
  /* 🧩 الشخصية الافتراضية */
  { key: 'defaultAvatar', group: '🧩 الشخصية الافتراضية', label: 'الشخصية الافتراضية', desc: 'يأخذها كل لاعب جديد مجانًا عند الانضمام — ترفع بدقة حتى 512×512 بلا تمشيط (v30)', px: 512 },

  /* ⚔️ الجولة والأسئلة */
  { key: 'skip2', group: '⚔️ الجولة والأسئلة', label: 'تخطي السؤال', desc: 'زر تخطي السؤال داخل الجولة', px: 96 },
  { key: 'skip', group: '⚔️ الجولة والأسئلة', label: 'تخطي (قديم)', desc: 'أيقونة التخطي بتصميمها السابق', px: 96 },
  { key: 'swap', group: '⚔️ الجولة والأسئلة', label: 'تبديل السؤال', desc: 'زر تغيير السؤال', px: 96 },
  { key: 'freeze', group: '⚔️ الجولة والأسئلة', label: 'تجميد الخصم', desc: 'أداة التجميد داخل الجولة', px: 96 },
  { key: 'fifty', group: '⚔️ الجولة والأسئلة', label: 'حذف خيارين (50:50)', desc: 'أداة حذف خيارين خاطئين داخل الجولة وفي القرص والحقيبة', px: 96 },
  { key: 'search', group: '⚔️ الجولة والأسئلة', label: 'البحث', desc: 'حقول البحث في اللعبة', px: 96 },
  { key: 'pen', group: '⚔️ الجولة والأسئلة', label: 'تغيير الاسم', desc: 'أداة تغيير الاسم', px: 96 },
  { key: 'close', group: '⚔️ الجولة والأسئلة', label: 'إغلاق / انسحاب', desc: 'أزرار الإغلاق والانسحاب', px: 96 },
  { key: 'help', group: '⚔️ الجولة والأسئلة', label: 'مساعدة', desc: 'أيقونة علامة الاستفهام', px: 96 },

  /* 🏆 العملات والإحصائيات */
  { key: 'gems', group: '🏆 العملات والإحصائيات', label: 'الجواهر', desc: 'حبة الجواهر في كل الشاشات', px: 64 },
  { key: 'tokens', group: '🏆 العملات والإحصائيات', label: 'علامات الانتصار', desc: 'وسام العلامات في كل الشاشات', px: 64 },
  { key: 'intel', group: '🏆 العملات والإحصائيات', label: 'جوائز الذكاء', desc: 'أيقونة جوائز الذكاء (الدماغ)', px: 64 },
  { key: 'star', group: '🏆 العملات والإحصائيات', label: 'النجمة (المستوى)', desc: 'نجمة المستوى والتقييم', px: 64 },
  { key: 'bulb', group: '🏆 العملات والإحصائيات', label: 'المصباح', desc: 'مصباح جوائز الذكاء', px: 64 },

  /* 🧭 التنقل والقوائم */
  { key: 'home', group: '🧭 التنقل والقوائم', label: 'الرئيسية', desc: 'زر الرئيسية', px: 96 },
  { key: 'homeNav', group: '🧭 التنقل والقوائم', label: 'الرئيسية (شاشة النهاية)', desc: 'زر العودة للرئيسية بعد الجولة', px: 96 },
  { key: 'back', group: '🧭 التنقل والقوائم', label: 'رجوع', desc: 'سهم الرجوع في كل الشاشات', px: 96 },
  { key: 'start', group: '🧭 التنقل والقوائم', label: 'ابدأ المعركة', desc: 'زر البدء الرئيسي وشعار التحميل', px: 96 },
  { key: 'swords', group: '🧭 التنقل والقوائم', label: 'سيوف المعركة', desc: 'سيوف متقاطعة (زر المعركة)', px: 96 },
  { key: 'play', group: '🧭 التنقل والقوائم', label: 'تشغيل', desc: 'مثلث التشغيل', px: 96 },
  { key: 'store', group: '🧭 التنقل والقوائم', label: 'المتجر', desc: 'زر المتجر', px: 96 },
  { key: 'cart', group: '🧭 التنقل والقوائم', label: 'متجر الجوائز', desc: 'سلة متجر الجوائز', px: 96 },
  { key: 'profile', group: '🧭 التنقل والقوائم', label: 'الملف الشخصي', desc: 'زر الملف الشخصي', px: 96 },
  { key: 'avatar', group: '🧭 التنقل والقوائم', label: 'الصور الشخصية', desc: 'إطار صور الأفاتار', px: 96 },
  { key: 'friends', group: '🧭 التنقل والقوائم', label: 'الأصدقاء', desc: 'زر الأصدقاء', px: 96 },
  { key: 'history', group: '🧭 التنقل والقوائم', label: 'سجل الجولات', desc: 'زر سجل الجولات', px: 96 },
  { key: 'clock', group: '🧭 التنقل والقوائم', label: 'الساعة', desc: 'ساعة المؤقتات', px: 96 },
  { key: 'leaderboard', group: '🧭 التنقل والقوائم', label: 'المتصدرون', desc: 'كأس قائمة المتصدرين', px: 96 },
  { key: 'rooms', group: '🧭 التنقل والقوائم', label: 'الغرف', desc: 'أيقونة الغرف', px: 96 },
  { key: 'plus', group: '🧭 التنقل والقوائم', label: 'إضافة', desc: 'زر الإضافة / إنشاء', px: 96 },
  { key: 'settings', group: '🧭 التنقل والقوائم', label: 'الإعدادات', desc: 'ترس الإعدادات', px: 96 },
  { key: 'tune', group: '🧭 التنقل والقوائم', label: 'الضبط', desc: 'أشرطة الضبط', px: 96 },
  { key: 'language', group: '🧭 التنقل والقوائم', label: 'اللغة', desc: 'كرة أرضية اللغة', px: 96 },
  { key: 'logout', group: '🧭 التنقل والقوائم', label: 'خروج', desc: 'تسجيل الخروج', px: 96 },

  /* 🎁 المكافآت */
  { key: 'gift', group: '🎁 المكافآت', label: 'هدية', desc: 'أيقونة الهدايا', px: 96 },
  { key: 'box', group: '🎁 المكافآت', label: 'صندوق المكافآت', desc: 'صندوق المكافآت اليومي', px: 96 },
  { key: 'bag', group: '🎁 المكافآت', label: 'الحقيبة', desc: 'حقيبة اللاعب', px: 96 },
  { key: 'wheel', group: '🎁 المكافآت', label: 'قرص الحظ', desc: 'قرص الحظ الدوار', px: 96 },
  { key: 'video', group: '🎁 المكافآت', label: 'شاهد الإعلان', desc: 'علامة الفيديو للإعلانات', px: 96 },
  { key: 'camera', group: '🎁 المكافآت', label: 'كاميرا الإعلان', desc: 'شعار الإعلان الاحترافي', px: 96 },
  { key: 'sparkles', group: '🎁 المكافآت', label: 'تألق', desc: 'نجيمات التألق والترحيب', px: 96 },

  /* 🔧 عامة */
  { key: 'support', group: '🔧 عامة', label: 'الدعم الفني', desc: 'سماعة الدعم الفني', px: 96 },
  { key: 'warn', group: '🔧 عامة', label: 'تحذير', desc: 'مثلث التحذير', px: 96 },
  { key: 'banned', group: '🔧 عامة', label: 'محظور', desc: 'دائرة الحظر', px: 96 },
  { key: 'tools', group: '🔧 عامة', label: 'أدوات', desc: 'مفتاح ربط الأدوات', px: 96 },
  { key: 'none', group: '🔧 عامة', label: 'خانة فارغة', desc: 'دائرة القرص الفارغة', px: 96 },
  { key: 'send', group: '🔧 عامة', label: 'إرسال', desc: 'طائرة الإرسال (طلبات الصداقة)', px: 96 },
  { key: 'loader', group: '🔧 عامة', label: 'تحميل', desc: 'مؤشر التحميل الدوار', px: 96 },
  { key: 'download', group: '🔧 عامة', label: 'تنزيل', desc: 'سهم التنزيل', px: 96 },
  { key: 'soundOn', group: '🔧 عامة', label: 'الصوت مفعّل', desc: 'مكبر الصوت مع موجات', px: 96 },
  { key: 'soundOff', group: '🔧 عامة', label: 'الصوت متوقف', desc: 'مكبر الصوت مشطوب', px: 96 },
];

let _iconsOvr = {};        // key → وثيقة التجاوز { dataUrl, px, … }
let _iconsFilter = '';
let iconsUnsub = null;

/** 🔴 قائمة الأيقونات لحظية — كل تغيير يُحفظ يظهر في المعاينة فورًا */
function startIconsLive() {
  if (iconsUnsub) iconsUnsub();
  iconsUnsub = onSnapshot(collection(db, 'iconOverrides'), (snap) => {
    _iconsOvr = {};
    snap.forEach(d => { const v = d.data(); if (v?.dataUrl) _iconsOvr[d.id] = v; });
    renderIconsAdmin();
  }, (e) => { console.warn('icons listener:', e); renderIconsAdmin(); });
}

/** معاينة الأيقونة الفعّالة: التجاوز ☁️ ← المدمجة 🎨 (الشخصية الافتراضية: 👤) */
function iconPreviewHTML(key, ovr) {
  if (ovr?.dataUrl) return `<img src="${ovr.dataUrl}" alt="" draggable="false">`;
  if (key === 'defaultAvatar') return '<span class="icon-emoji">👤</span>';
  return ICONS[key] || '<span class="icon-emoji">❔</span>';
}

/** 📋 رسم شبكة الأيقونات (مجمعة بالأقسام + فلتر بحث) */
function renderIconsAdmin() {
  const box = $('icons-list');
  if (!box) return;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('ic-total', ICON_CATALOG.length);
  set('ic-ovr', Object.keys(_iconsOvr).length);

  const q = _iconsFilter.trim().toLowerCase();
  const entries = ICON_CATALOG.filter(c =>
    !q || c.label.includes(q) || c.key.toLowerCase().includes(q) || (c.desc || '').includes(q));
  if (!entries.length) { box.innerHTML = '<p class="muted" style="grid-column:1/-1">لا نتائج للبحث</p>'; return; }

  let lastGroup = '';
  box.innerHTML = entries.map(c => {
    const ovr = _iconsOvr[c.key];
    const head = (c.group !== lastGroup)
      ? `<h3 class="icons-group-title">${esc(c.group)}</h3>` : '';
    lastGroup = c.group;
    return `${head}
      <div class="icon-card ${ovr ? 'has-ovr' : ''}">
        <div class="icon-prev">${iconPreviewHTML(c.key, ovr)}</div>
        <div class="icon-meta">
          <b>${esc(c.label)} ${ovr ? '<span class="tag online">معدّلة</span>' : ''}</b>
          <span class="muted xsmall" style="direction:ltr">${esc(c.key)} · ${c.px}×${c.px}</span>
          <span class="muted small">${esc(c.desc || '')}</span>
        </div>
        <div class="icon-actions">
          <label class="btn btn-primary xsmall ic-upload" style="cursor:pointer">🖼️ تغيير
            <input type="file" hidden
              accept=".png,.ico,.jpg,.jpeg,.svg,.webp,image/png,image/x-icon,image/vnd.microsoft.icon,image/jpeg,image/svg+xml,image/webp"
              data-ico-file="${c.key}" />
          </label>
          ${ovr
            ? `<button class="btn btn-ghost xsmall" data-ico-reset="${c.key}">↩️ استعادة</button>`
            : `<span class="muted xsmall">افتراضية</span>`}
        </div>
      </div>`;
  }).join('');

  box.querySelectorAll('[data-ico-file]').forEach(inp => {
    inp.onchange = () => uploadIconOverride(inp.dataset.icoFile, inp.files?.[0], inp);
  });
  box.querySelectorAll('[data-ico-reset]').forEach(b => {
    b.onclick = async () => {
      try {
        await deleteDoc(doc(db, 'iconOverrides', b.dataset.icoReset));
        toast('أُعيدت الأيقونة إلى الافتراضية ↩️', 'ok');
      } catch (e) { toast('خطأ: ' + (e?.message || e), 'err'); }
    };
  });
}

$('icons-search').addEventListener('input', () => {
  _iconsFilter = $('icons-search').value;
  renderIconsAdmin();
});

/** 🖼️ قصّ مركزي (cover) + تصغير إلى مربع S×S — PNG شفاف.
 *  إن تعذر فك ترميز الصورة (ICO قديم مثلًا) يُحفظ الأصل كما هو.
 *  🛠️ v30 (طلب المستخدم — «الشخصية في الرئيسية واضحة وغير مغشاة»):
 *   • لا تكبير أبدًا: صورة أصغر من المقاس المطلوب تبقى بمقاسها الأصلي
 *     في المنتصف على خلفية شفافة — التكبير بالكانفس كان سبب التمشيط.
 *   • صورة مربعة PNG أصغر من المقاس تُمرَّر كما هي بلا إعادة ضغط —
 *     جودة أصلية 100% بلا أي فقدان.
 *   • التصغير يستخدم أعلى جودة تنعيم متاحة (imageSmoothingQuality). */
function toSquarePx(dataUrl, S = 96) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        // ✅ مربعة أصغر من المطلوب وPNG؟ مرّر الأصل كما هو — صفر فقدان
        if (img.width === img.height && img.width <= S
            && String(dataUrl).startsWith('data:image/png')) {
          resolve(dataUrl);
          return;
        }
        // ✅ أصغر من المطلوب؟ لا تكبير — مقاسها الأصلي في المنتصف
        const target = (img.width <= S && img.height <= S)
          ? Math.max(img.width, img.height)
          : S;
        const cv = document.createElement('canvas');
        cv.width = target; cv.height = target;
        const ctx = cv.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.clearRect(0, 0, target, target);
        // قصّ مركزي ثم احتواء — تملأ المربع كاملًا بلا تشويه النسب
        const scale = (img.width <= target && img.height <= target)
          ? 1
          : Math.max(target / img.width, target / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (target - w) / 2, (target - h) / 2, w, h);
        resolve(cv.toDataURL('image/png'));
      } catch { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);   // صيغ غير مدعومة فك الترميز → الأصل
    img.src = dataUrl;
  });
}

/** ⬆️ رفع أيقونة: قراءة → قص/تصغير تلقائي → حفظ في iconOverrides/{key} */
async function uploadIconOverride(key, file, input) {
  if (!file) return;
  const meta = ICON_CATALOG.find(c => c.key === key) || { px: 96, label: key };
  if (file.size > 600 * 1024) {
    showMsg('icons-msg', '⛔ حجم الملف يتجاوز 600KB — صغّر الصورة وأعد المحاولة', false);
    input.value = '';
    return;
  }
  showMsg('icons-msg', `⏳ جاري معالجة «${meta.label}» — قص وتصغير تلقائي…`, true);
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      let dataUrl = String(rd.result || '');
      // SVG يُحفظ كما هو (يتمدد لأي مقاس بلا فقدان جودة) — الباقي يُقصّ ويُصغَّر
      if (file.type !== 'image/svg+xml') {
        dataUrl = await toSquarePx(dataUrl, meta.px || 96);
      }
      if (!dataUrl || !dataUrl.startsWith('data:image')) {
        throw new Error('صيغة الصورة غير مقروءة — جرّب PNG أو ICO');
      }
      await setDoc(doc(db, 'iconOverrides', key), {
        key, dataUrl, px: meta.px || 96, updatedAt: serverTimestamp()
      });
      showMsg('icons-msg', `✅ حُدّثت أيقونة «${meta.label}» — تصل لكل الأجهزة المفتوحة لحظيًا`, true);
      toast('حُفظت الأيقونة ✓', 'ok');
    } catch (e) {
      showMsg('icons-msg', '⛔ خطأ: ' + (e?.message || e), false);
    }
    input.value = '';
  };
  rd.onerror = () => { showMsg('icons-msg', '⛔ تعذر قراءة الملف', false); input.value = ''; };
  rd.readAsDataURL(file);
}

/** ↩️ استعادة كل الأيقونات الافتراضية (مسح مجموعة iconOverrides) */
$('btn-ic-reset-all').onclick = async () => {
  const ok = await confirmDlg('↩️ استعادة كل الأيقونات الافتراضية؟',
    'يُحذف كل التجاوزات المرفوعة وتعود كل أيقونات اللعبة والشخصية الافتراضية إلى التصميم المدمج فورًا على كل الأجهزة.');
  if (!ok) return;
  try {
    const n = await wipeCollection('iconOverrides');
    showMsg('icons-msg', `✅ أُعيدت ${n} أيقونة إلى الافتراضي ↩️`, true);
    toast('استُعيدت الأيقونات الافتراضية ✓', 'ok');
  } catch (e) { showMsg('icons-msg', '⛔ خطأ: ' + (e?.message || e), false); }
};

/* ==========================================================
 * 📜 الشروط وسياسة الخصوصية — v30 (طلب المستخدم)
 *  التحرير من قسم الإعدادات — الحفظ في gameMeta/legal يصل
 *  لكل الأجهزة لحظيًا (مستمع onSnapshot في اللعبة ui/legal.js).
 *  الحقل الفارغ = يعود اللاعب إلى النص الافتراضي المدمج.
 * ========================================================== */
async function loadLegalEditor() {
  try {
    const snap = await getDoc(doc(db, 'gameMeta', 'legal'));
    if (snap.exists()) {
      const d = snap.data();
      // لا نغطي نص الأدمن وهو يكتب — التعبئة فقط إن كان الحقل فارغًا
      if (!$('legal-terms').value.trim()) $('legal-terms').value = String(d.terms || '');
      if (!$('legal-privacy').value.trim()) $('legal-privacy').value = String(d.privacy || '');
    }
  } catch (e) {
    showMsg('legal-msg', '⛔ خطأ في تحميل النصوص: ' + (e?.message || e), false);
  }
}

$('btn-legal-save').onclick = async () => {
  const terms = $('legal-terms').value.trim();
  const privacy = $('legal-privacy').value.trim();
  try {
    await setDoc(doc(db, 'gameMeta', 'legal'), {
      terms, privacy, updatedAt: serverTimestamp()
    }, { merge: true });
    showMsg('legal-msg', terms || privacy
      ? '✅ حُفظت النصوص — تظهر للاعبين في شاشة التسجيل وصفحة الملف الشخصي لحظيًا'
      : '✅ حُفظت — الحقول فارغة: سيظهر للاعبين النص الافتراضي المدمج', true);
    toast('حُفظت الشروط والخصوصية ✓', 'ok');
  } catch (e) {
    showMsg('legal-msg', '⛔ خطأ: ' + (e?.message || e), false);
  }
};

/* ======================= الاستعادة — آخر قسم مفتوح ======================= */
try {
  const last = localStorage.getItem('ba_admin_tab');
  if (last && $('tab-' + last)) switchTab(last);
  applyAdminLang();
} catch {}

/* ==========================================================
 * 🏭 استعادة اللعبة إلى وضع المصنع — v26 (طلب المستخدم)
 *  تحذف كل مجموعات قاعدة البيانات ما عدا:
 *    - admins: حساب دخول الأدمن (وإلا أُقفلت اللوحة نهائيًا)
 *    - serverTime: وثائق وقت السيرفر — تتجدد تلقائيًا عند أول جولة
 *
 *  🛠️ v26 — إصلاح "الحذف متأخر/غير مكتمل والحسابات تعود":
 *   1) المسح كان مستندًا بمستند تسلسليًا (بطيء جدًا مع مئات الوثائق)
 *      وبحد 1000 مستند فقط لكل مجموعة — الآن دفعات writeBatch
 *      (400 حذف/دفعة) مع تكرار حتى تفرغ المجموعة تمامًا.
 *   2) الأجهزة المفتوحة كانت تُعيد إنشاء حساباتها تلقائيًا بعد المسح
 *      (شبح) — أُغلق هذا الباب في كود اللعبة (حاجز الحجر الأمني)،
 *      والأحجار تُكتب هنا قبل المسح لمنع أي مزامنة قديمة.
 *   3) 🚩 علامة الاستعادة: بعد إتمام المسح تُكتب gameMeta/factoryReset
 *      {at: Date.now()} — كل جهاز يفتح اللعبة بعدها يمسح ملفه المحلي
 *      وينهي جلسته المجهولة ويعيد التحميل فورًا (لعبة جديدة تمامًا)،
 *      فلا يرى الأدمن حسابه القديم قائمًا أبدًا.
 * ========================================================== */

/** حذف كل وثائق مجموعة + مجموعاتها الفرعية (بطبقات معروفة) — دفعات سريعة */
async function wipeCollection(name, subcols = []) {
  let n = 0;
  try {
    // ١) المجموعات الفرعية لكل مستند (friends/history داخل players …)
    if (subcols.length) {
      const snap = await getDocs(query(collection(db, name), limit(1000)));
      for (const d of snap.docs) {
        for (const sc of subcols) {
          try {
            let sub;
            do {
              sub = await getDocs(query(collection(db, name, d.id, sc), limit(400)));
              if (!sub.docs.length) break;
              const batch = writeBatch(db);
              sub.docs.forEach(s => batch.delete(s.ref));
              await batch.commit().catch(() => {});
              n += sub.docs.length;
            } while (sub.docs.length >= 400);
          } catch {}
        }
      }
    }
    // ٢) وثائق المجموعة نفسها — دفعات متكررة حتى التفريغ الكامل
    for (let round = 0; round < 50; round++) {
      const docs = await getDocs(query(collection(db, name), limit(400)));
      if (!docs.docs.length) break;
      const batch = writeBatch(db);
      docs.docs.forEach(d => batch.delete(d.ref));
      await batch.commit().catch(() => {});
      n += docs.docs.length;
      if (docs.docs.length < 400) break;
    }
  } catch (e) { console.warn('wipe', name, e?.message || e); }
  return n;
}

$('btn-factory-reset').onclick = async () => {
  const ok1 = await confirmDlg(
    '🏭 استعادة اللعبة إلى وضع المصنع؟',
    'سيُحذف كل شيء فورًا: اللاعبون الحقيقيون وسجلهم وأصدقاؤهم، اللاعبون الافتراضيون وسجلهم، الغرف والنتائج، رسائل الدعم، المتجر والشخصيات والأدوات، الجوائز والعجلة والصندوق ومتجر الجوائز، الخزان وكل العدادات والسجلات اليومية، الأسئلة، تجاوزات اللغات، تجاوزات الأيقونات (تعود كل الأيقونات والشخصية الافتراضية للافتراضي)، والمحضورون. يبقى فقط حساب دخولك للأدمن. العملية نهائية بلا رجوع.'
  );
  if (!ok1) return;
  const ok2 = await confirmDlg(
    '⚠️ تأكيد أخير — قاعدة البيانات ستصبح فارغة تمامًا',
    'لن يبقى أي لاعب أو علامة انتصار أو جائزة أو سؤال أو إعداد. حتى حسابك في اللعبة سيُحذف: عند فتح اللعبة ستبدأ من شاشة التسجيل كأنها أول مرة. هل أنت متأكد تمامًا؟'
  );
  if (!ok2) return;

  const msg = $('factory-msg');
  msg.textContent = '⏳ جاري المسح — لا تغلق الصفحة…';
  msg.className = 'form-msg';
  try {
    // 1️⃣ مسح قائمة المحضورين القديمة أولًا (كي لا تُحذف الأحجار الجديدة لاحقًا)
    await wipeCollection('banned');

    // 2️⃣ حجر أمني سريع لكل لاعب قائم (دفعة واحدة) — يمنع مزامنة أجهزتهم
    //    من إعادة إنشاء ملفاتهم أثناء/بعد المسح
    try {
      const pSnap = await getDocs(query(collection(db, 'players'), limit(1000)));
      if (pSnap.docs.length) {
        for (let i = 0; i < pSnap.docs.length; i += 400) {
          const batch = writeBatch(db);
          pSnap.docs.slice(i, i + 400).forEach(d => {
            batch.set(doc(db, 'banned', d.id), {
              reason: 'تم حذف هذا الحساب لمخالفة بعض القوانين والشروط',
              deletedAt: serverTimestamp()
            });
          });
          await batch.commit().catch(() => {});
        }
      }
    } catch {}

    // 3️⃣ مسح كل المجموعات (بالمجموعات الفرعية) — دفعات متكررة حتى التفريغ
    const wiped = {};
    wiped['players'] = await wipeCollection('players', ['friends', 'history']);
    wiped['virtualPlayers'] = await wipeCollection('virtualPlayers', ['history']);
    wiped['gameStates'] = await wipeCollection('gameStates');
    wiped['matchmaking'] = await wipeCollection('matchmaking');
    wiped['rooms'] = await wipeCollection('rooms');
    wiped['friendRequests'] = await wipeCollection('friendRequests');
    wiped['supportTickets'] = await wipeCollection('supportTickets');
    wiped['storeItems'] = await wipeCollection('storeItems');
    wiped['storeMeta'] = await wipeCollection('storeMeta');
    wiped['awards'] = await wipeCollection('awards');
    wiped['awardClaims'] = await wipeCollection('awardClaims');
    wiped['questions'] = await wipeCollection('questions');
    wiped['translations'] = await wipeCollection('translations');
    wiped['qtrans'] = await wipeCollection('qtrans');
    wiped['iconOverrides'] = await wipeCollection('iconOverrides');   // 🎨 v27 — الأيقونات تعود للافتراضية
    wiped['gameMeta'] = await wipeCollection('gameMeta', ['days']);

    // 4️⃣ 🚩 علامة الاستعادة — تُكتب بعد المسح (gameMeta فارغ الآن):
    //    كل جهاز يفتح اللعبة يمسح ملفه المحلي ويعيد التحميل تلقائيًا
    await setDoc(doc(db, 'gameMeta', 'factoryReset'), {
      at: Date.now(), by: 'factory-reset', createdAt: serverTimestamp()
    });

    const total = Object.values(wiped).reduce((a, b) => a + b, 0);
    msg.textContent = `✅ اكتملت الاستعادة — حُذف ${total} مستندًا. اللعبة الآن كأنها جديدة تمامًا: كل الأجهزة ستبدأ من شاشة التسجيل تلقائيًا. أضف إعداداتك وأسئلتك ولاعبيك الافتراضيين من جديد.`;
    msg.className = 'form-msg ok';
    toast('🏭 اكتملت استعادة وضع المصنع ✓', 'ok');
    loadGameStats().catch(() => {});
    loadTankSummary().catch(() => {});
  } catch (e) {
    msg.textContent = '⛔ خطأ أثناء المسح: ' + (e?.message || e);
    msg.className = 'form-msg err';
  }
};


/* ==========================================================
 * 🚩 v41 — تبويب الإبلاغات (بديل الدعم الفني)
 *    قائمة بالإبلاغات الواردة من اللاعبين: أسماء مخالفة، أسئلة خاطئة،
 *    سلوك مخالف. لا رد على المُبلِّغ — مراجعة إدارية فقط.
 *    الإبلاغ عن نفس اللاعب من 3+ لاعبين → أولوية قصوى تلقائيًا.
 * ========================================================== */
let _repUnsub = null;
let _repFilter = 'new';

async function loadReports() {
  const list = $('rep-list');
  if (!list) return;
  list.innerHTML = '<p class="muted panel-card">جاري التحميل…</p>';

  // أوقف أي مستمع سابق
  if (_repUnsub) { try { _repUnsub(); } catch {} _repUnsub = null; }

  try {
    const q = query(collection(db, 'reports'), orderBy('at', 'desc'), limit(200));
    _repUnsub = onSnapshot(q, (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // عدّ الإبلاغات حسب الهدف لاكتشاف التكرار (3+ → أولوية)
      const targetCounts = {};
      all.forEach(r => {
        const key = r.targetUid || r.targetQid || r.id;
        targetCounts[key] = (targetCounts[key] || 0) + 1;
      });
      // فلترة
      let filtered = all;
      if (_repFilter === 'new') filtered = all.filter(r => !r.handled);
      // ترتيب: الأولوية القصوى (3+ إبلاغات) أولاً
      filtered.sort((a, b) => {
        const ka = targetCounts[a.targetUid || a.targetQid || a.id] || 1;
        const kb = targetCounts[b.targetUid || b.targetQid || b.id] || 1;
        if (kb !== ka) return kb - ka;
        return (b.at || 0) - (a.at || 0);
      });

      $('rep-total').textContent = all.length;
      $('rep-new-n').textContent = all.filter(r => !r.handled).length;

      if (!filtered.length) {
        list.innerHTML = '<p class="muted panel-card">✅ لا توجد إبلاغات حالياً.</p>';
        return;
      }
      list.innerHTML = filtered.map(r => {
        const key = r.targetUid || r.targetQid || r.id;
        const cnt = targetCounts[key] || 1;
        const priority = cnt >= 3 ? '<span class="chip-stat" style="color:#ff6b6b">🔴 أولوية قصوى</span>' : '';
        const typeLabel = r.type === 'name' ? 'اسم مخالف' : r.type === 'question' ? 'سؤال خاطئ' : 'سلوك مخالف';
        const date = new Date(r.at || 0).toLocaleString('ar-SA');
        const handled = r.handled ? '<span class="chip-stat" style="color:#888">✓ تمت المعالجة</span>' : '';
        return `
          <div class="panel-card rep-item">
            <div class="row-between" style="flex-wrap:wrap">
              <div>
                <b>${typeLabel}</b> ${priority} ${handled}
                <p class="muted small">من: ${r.reporterUid?.slice(0,8) || '—'} · ${date}</p>
                ${r.reason ? `<p class="small">${r.reason}</p>` : ''}
                ${r.targetUid ? `<p class="small">الهدف (لاعب): ${r.targetUid.slice(0,12)}</p>` : ''}
                ${r.targetQid ? `<p class="small">الهدف (سؤال): ${r.targetQid}</p>` : ''}
                ${cnt > 1 ? `<p class="small" style="color:#ff6b6b">⚠️ ${cnt} إبلاغات على نفس الهدف</p>` : ''}
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button class="btn btn-ghost small" data-rep-ignore="${r.id}">تجاهل</button>
                ${r.targetUid ? `<button class="btn btn-danger small" data-rep-ban="${r.targetUid}">حظر اللاعب</button>` : ''}
                ${r.targetQid ? `<button class="btn btn-danger small" data-rep-delq="${r.targetQid}">حذف السؤال</button>` : ''}
              </div>
            </div>
          </div>`;
      }).join('');

      // ربط الأزرار
      list.querySelectorAll('[data-rep-ignore]').forEach(b => {
        b.onclick = async () => {
          try { await updateDoc(doc(db, 'reports', b.dataset.repIgnore), { handled: true, handledAt: Date.now() }); toast('تم تجاهل الإبلاغ', 'ok'); }
          catch (e) { toast('خطأ: ' + (e?.message || e), 'err'); }
        };
      });
      list.querySelectorAll('[data-rep-ban]').forEach(b => {
        b.onclick = async () => {
          if (!confirm('حظر هذا اللاعب نهائياً؟')) return;
          try {
            await setDoc(doc(db, 'banned', b.dataset.repBan), { banned: true, at: Date.now(), reason: 'عبر الإبلاغات' });
            await updateDoc(doc(db, 'players', b.dataset.repBan), { banned: true, frozenUntil: Date.now() + 365*86400000 });
            toast('تم حظر اللاعب', 'ok');
          } catch (e) { toast('خطأ: ' + (e?.message || e), 'err'); }
        };
      });
      list.querySelectorAll('[data-rep-delq]').forEach(b => {
        b.onclick = async () => {
          if (!confirm('حذف هذا السؤال نهائياً؟')) return;
          try { await deleteDoc(doc(db, 'questions', b.dataset.repDelq)); toast('تم حذف السؤال', 'ok'); }
          catch (e) { toast('خطأ: ' + (e?.message || e), 'err'); }
        };
      });
    }, (e) => {
      console.warn('reports listener:', e);
      list.innerHTML = '<p class="muted panel-card">تعذّر تحميل الإبلاغات.</p>';
    });
  } catch (e) {
    list.innerHTML = '<p class="muted panel-card">تعذّر تحميل الإبلاغات: ' + (e?.message || e) + '</p>';
  }
}

// فلتر الإبلاغات
document.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-rep]');
  if (!chip) return;
  _repFilter = chip.dataset.rep;
  document.querySelectorAll('[data-rep]').forEach(c => c.classList.toggle('active', c === chip));
  loadReports();
});

/* ==========================================================
 * 🆘 v41 — استيراد البنك الاحتياطي للأسئلة إلى Firestore
 *    يرفع EMERGENCY_QUESTIONS (40 سؤالاً عربياً + إنجليزياً) من الكود
 *    إلى Firestore دفعة واحدة — لبدء سريع دون إدخال يدوي.
 *    يُربط بزر في تبويب الأسئلة.
 * ========================================================== */
async function importEmergencyBank() {
  if (!confirm('استيراد 40 سؤالاً احتياطياً إلى قاعدة البيانات؟ سيُضاف كل سؤال كوثيقة جديدة في مجموعة questions.')) return;
  toast('⏳ جارٍ الاستيراد…', 'info');
  try {
    // استورد البنك من الكود (مسار نسبي من 2-admin إلى 1-game)
    const mod = await import('../questions.js');
    const bank = mod.EMERGENCY_QUESTIONS || [];
    if (!bank.length) { toast('لا يوجد بنك احتياطي', 'err'); return; }

    let added = 0, skipped = 0;
    for (const q of bank) {
      try {
        // تحقق من عدم وجود السؤال مسبقاً (بنفس النص العربي)
        const arText = q.q?.ar || q.q;
        const existQ = query(collection(db, 'questions'), where('q.ar', '==', arText), limit(1));
        const exist = await getDocs(existQ);
        if (!exist.empty) { skipped++; continue; }

        await addDoc(collection(db, 'questions'), {
          q: q.q,
          options: q.options,
          correct: q.correct,
          active: true,
          createdAt: serverTimestamp()
        });
        added++;
      } catch (e) { console.warn('import q failed:', e); }
    }

    // ارفع إصدار البنك
    await setDoc(doc(db, 'gameMeta', 'questionsMeta'), { version: Date.now(), updatedAt: serverTimestamp() }, { merge: true });

    toast(`✅ تم استيراد ${added} سؤالاً (تخطّي ${skipped} موجود مسبقاً)`, 'ok');
    loadQuestions();
  } catch (e) {
    toast('خطأ في الاستيراد: ' + (e?.message || e), 'err');
  }
}

// ربط زر استيراد البنك الاحتياطي (يُضاف ديناميكياً لتبويب الأسئلة)
setTimeout(() => {
  const qPage = $('tab-questions');
  if (qPage && !document.getElementById('btn-import-emergency')) {
    const btn = document.createElement('button');
    btn.id = 'btn-import-emergency';
    btn.className = 'btn btn-glow-primary small';
    btn.style.margin = '8px 0';
    btn.innerHTML = '🆘 استيراد البنك الاحتياطي (40 سؤالاً)';
    btn.onclick = importEmergencyBank;
    qPage.insertBefore(btn, qPage.firstChild.nextSibling);
  }
}, 1500);
