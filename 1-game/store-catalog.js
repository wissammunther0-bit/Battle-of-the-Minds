// store-catalog.js — v14
// ============================================================
// 🛒 كتالوج المتجر الموحّد — من قاعدة البيانات فقط (طلب المستخدم)
//
//  • 🗑️ حُذفت كل الافتراضيات: لا شخصيات وهمية ولا أدوات داخل الكود —
//    كل شيء يضيفه المطور من صفحة الإدارة (collection: storeItems)
//    وإن لم يُضف شيئًا تظهر رسالة "لا توجد عناصر جديدة حاليًا".
//
//  • 🔴 تحديث لحظي (إصلاح v14 — طلب المستخدم): عناصر المتجر تُستمع
//    الآن عبر onSnapshot — أي عنصر يضيفه المطور يظهر فورًا في متجر
//    كل اللاعبين بلا إعادة تحميل الصفحة (كان السبب في "أضفت أفاتارًا
//    ولم يظهر في المتجر" عدم وجود مستمع لحظي + كاش قديم).
//
//  • 🧩 توحيد الشخصيات والأفاتار (طلب المستخدم v14): هما الشيء نفسه —
//    صورة بروفايل للاعب تُشرى بالجواهر. قسم واحد "الشخصيات" يعرض
//    عناصر type='character' وأيضًا type='avatar' القديمة، ولا يظهر
//    أي عنصر إلا إذا أضافه المطور من صفحة الإدارة.
//
//  • ⚙️ إعدادات اقتصاد التحويل + ⏰ إعدادات صندوق المكافآت وقرص الحظ
//    (storeMeta/economy · storeMeta/box · storeMeta/wheel)
// ============================================================

// 🧩 v29 — الشخصية الافتراضية من لوحة الإدارة (قسم الأيقونات)
import { getOverrideDataUrl } from './ui/icons.js';

const state = {
  loaded: false,
  custom: [],            // عناصر الأدمن من Firestore
  storeVersion: 2,       // يُحدَّث من storeMeta/version
  economy: null,         // ⚙️ شروط تحويل جوائز الذكاء
  boxConfig: null,       // 🎁 إعدادات صندوق المكافآت
  wheelConfig: null,     // 🎡 إعدادات قرص الحظ
  listeners: new Set()
};

const K_CACHE = 'ba_store_cache_v2';

function cacheRead() {
  try { return JSON.parse(localStorage.getItem(K_CACHE) || 'null'); } catch { return null; }
}
function cacheWrite(data) {
  try { localStorage.setItem(K_CACHE, JSON.stringify(data)); } catch {}
}

/** دمج العناصر النشطة فقط (active=false مخفي) */
function mergeType(customOfType) {
  return customOfType.filter(c => c && c.id && c.active !== false);
}

/* ==========================================================
 * 🧩 الأقسام — كلها من الإدارة بلا أي افتراضيات
 * ========================================================== */
export function getStoreItems(type) {
  const custom = state.custom;
  switch (type) {
    // 🧩 توحيد v14: "الشخصيات" = character + avatar (الأفاتار القديم
    // يُعرض في نفس القسم — هما الشيء نفسه بحسب طلب المستخدم)
    case 'characters':
      return mergeType(custom.filter(c => c.type === 'character' || c.type === 'avatar'));
    case 'boosters':   return mergeType(custom.filter(c => c.type === 'booster'));
    case 'avatars':    return mergeType(custom.filter(c => c.type === 'avatar')); // توافق قديم
    // 🎁 مكافآت صندوق الجوائز — جواهر يضيفها المطور
    case 'rewards':    return mergeType(custom.filter(c => c.type === 'reward'));
    default:           return [];
  }
}

/** بحث عن عنصر بالمعرّف داخل الشخصيات الموحّدة (يشمل الأفاتار القديم) */
export function getCharacterItemById(id) {
  if (!id) return null;
  return getStoreItems('characters').find(c => c.id === id) || null;
}

/** توافق قديم: getAvatarById يبقى يعمل (يشمل كل الشخصيات الموحّدة) */
export function getAvatarById(id) {
  return getCharacterItemById(id);
}

/* ==========================================================
 * 🖼️ صورة البروفايل الموحّدة للاعب
 *   الشخصية المجهزة أولًا ← الأفاتار القديم المجهز ← 🧩 الشخصية
 *   الافتراضية من لوحة الإدارة (v29) ← لا شيء
 *
 *   🧩 v29 (طلب المستخدم — إصلاح "الشخصية الافتراضية تظهر صغيرة
 *   داخل الإطار"): من لا يملك شخصية مشتراة تظهر له الشخصية الافتراضية
 *   المرفوعة من قسم الأيقونات في "كل" مواضع الصور (السداسي في الرئيسية،
 *   مقاعد التحضير، شريط المواجهة، شاشة النتيجة، الملف الشخصي، بطاقة
 *   اللاعب) — وبنفس مسار <img> الشخصيات المشتراة فتملأ الإطار بالكامل
 *   (كانت تُرسم بأيقونة صغيرة class="ico" بمقاس ثابت 70px).
 * ========================================================== */
export function getProfilePicture(player) {
  if (!player) return null;
  const item = getCharacterItemById(player.equippedCharacter)
    || getCharacterItemById(player.equippedAvatar);
  if (!item) {
    const def = getOverrideDataUrl('defaultAvatar');
    if (def) return { image: def, emoji: '', name: 'الشخصية الافتراضية' };
    return null;
  }
  return { image: item.image || '', emoji: item.emoji || '', name: item.name || '' };
}

/** 🆕 هل العنصر "جديد"؟ (أُضيف خلال آخر 48 ساعة — شارة إشعار المتجر) */
export function isItemFresh(item) {
  try {
    const t = item?.createdAt?.toMillis?.() || item?.createdAtMs || 0;
    return t > 0 && (Date.now() - t) < 48 * 3600 * 1000;
  } catch { return false; }
}

export function getStoreVersion() {
  return state.storeVersion;
}

export function isCatalogLoaded() {
  return state.loaded;
}

/** ⚙️ إعدادات اقتصاد التحويل { convertConditions, convertMode } */
export function getEconomyConfig() {
  return state.economy;
}

/** 🎁 إعدادات صندوق المكافآت { enabled, intervalMinutes } */
export function getBoxConfig() {
  return state.boxConfig;
}

/** 🎡 إعدادات قرص الحظ { enabled, intervalMinutes, slots[10] } */
export function getWheelConfig() {
  return state.wheelConfig;
}

export function onCatalogChange(cb) {
  state.listeners.add(cb);
  if (state.loaded) cb();
  return () => state.listeners.delete(cb);
}

function _applySnapshot({ custom, version, economy, boxConfig, wheelConfig }) {
  const changed = JSON.stringify({ custom, version, economy, boxConfig, wheelConfig }) !==
    JSON.stringify({
      custom: state.custom, version: state.storeVersion, economy: state.economy,
      boxConfig: state.boxConfig, wheelConfig: state.wheelConfig
    });
  state.custom = custom;
  state.storeVersion = version;
  state.economy = economy;
  state.boxConfig = boxConfig;
  state.wheelConfig = wheelConfig;
  state.loaded = true;
  cacheWrite({ custom, version, economy, boxConfig, wheelConfig });
  if (changed) state.listeners.forEach(cb => { try { cb(); } catch {} });
}

/** 🔧 إحضار إعدادات storeMeta الثلاثة بطلبة متوازية */
async function _fetchMeta(FS, db) {
  const [versionSnap, ecoSnap, boxSnap, wheelSnap] = await Promise.all([
    FS.getDoc(FS.doc(db, 'storeMeta', 'version')),
    FS.getDoc(FS.doc(db, 'storeMeta', 'economy')),
    FS.getDoc(FS.doc(db, 'storeMeta', 'box')),
    FS.getDoc(FS.doc(db, 'storeMeta', 'wheel'))
  ]);
  return {
    version: versionSnap.exists() ? (versionSnap.data().v || 2) : 2,
    economy: ecoSnap.exists() ? ecoSnap.data() : null,
    boxConfig: boxSnap.exists() ? boxSnap.data() : null,
    wheelConfig: wheelSnap.exists() ? wheelSnap.data() : null
  };
}

/** 🚀 تحميل الكتالوج + 🔴 مستمع لحظي — يُستدعى مرة من app.js عند الإقلاع */
export async function loadStoreCatalog() {
  // 1) الكاش فوراً (إحساس لحظي + عمل أوفلاين)
  const cached = cacheRead();
  if (cached) {
    state.custom = cached.custom || [];
    state.storeVersion = cached.version || 2;
    state.economy = cached.economy || null;
    state.boxConfig = cached.boxConfig || null;
    state.wheelConfig = cached.wheelConfig || null;
    state.loaded = true;
  }

  // 2) جلب أولي + 🔴 مستمع لحظي دائم (إصلاح "أضفت عنصرًا ولم يظهر")
  try {
    const [{ db }, FS] = await Promise.all([
      import('./firebase-config.js'),
      import('https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js')
    ]);

    const snap = await FS.getDocs(FS.collection(db, 'storeItems'));
    const meta = await _fetchMeta(FS, db);
    _applySnapshot({
      custom: snap.docs.map(d => ({ id: d.id, ...d.data() })),
      ...meta
    });

    // 🔴 onSnapshot — كل تغيير من صفحة الإدارة يصل للاعبين فورًا
    FS.onSnapshot(FS.collection(db, 'storeItems'), (s) => {
      _applySnapshot({
        custom: s.docs.map(d => ({ id: d.id, ...d.data() })),
        version: state.storeVersion,
        economy: state.economy,
        boxConfig: state.boxConfig,
        wheelConfig: state.wheelConfig
      });
    }, (e) => console.warn('[store-catalog] items listener:', e?.message || e));

    // 🔴 مستمع إعدادات المتجر (إصدار/اقتصاد/صندوق/قرص)
    FS.onSnapshot(FS.doc(db, 'storeMeta', 'version'), (d) => {
      if (d.exists()) _applySnapshot({
        custom: state.custom, version: d.data().v || 2,
        economy: state.economy, boxConfig: state.boxConfig, wheelConfig: state.wheelConfig
      });
    }, () => {});
    FS.onSnapshot(FS.doc(db, 'storeMeta', 'economy'), (d) => {
      _applySnapshot({
        custom: state.custom, version: state.storeVersion,
        economy: d.exists() ? d.data() : null,
        boxConfig: state.boxConfig, wheelConfig: state.wheelConfig
      });
    }, () => {});
    FS.onSnapshot(FS.doc(db, 'storeMeta', 'box'), (d) => {
      _applySnapshot({
        custom: state.custom, version: state.storeVersion, economy: state.economy,
        boxConfig: d.exists() ? d.data() : null, wheelConfig: state.wheelConfig
      });
    }, () => {});
    FS.onSnapshot(FS.doc(db, 'storeMeta', 'wheel'), (d) => {
      _applySnapshot({
        custom: state.custom, version: state.storeVersion, economy: state.economy,
        boxConfig: state.boxConfig, wheelConfig: d.exists() ? d.data() : null
      });
    }, () => {});
  } catch (e) {
    console.warn('[store-catalog] load failed:', e?.message || e);
    state.loaded = true;
  }
  return state;
}

/** إشعار باقي الوحدات أن المتجر تغيّر (بعد شراء/تجهيز مثلاً) */
export function notifyCatalogChange() {
  state.listeners.forEach(cb => { try { cb(); } catch {} });
}
