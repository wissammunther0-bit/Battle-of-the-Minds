// game/ads.js — v31 (جديد)
// ============================================================
// 🎬 نظام الإعلانات الموحّد — Google AdMob حصريًا (قرار المستخدم)
//
//  • نظام واحد فقط: AdMob — Rewarded (إعلانات المكافآت) بلا
//    بينية ولا بانرات (قرار المستخدم النهائي).
//  • 5 مواضع في اللعبة، ولكل موضع وحدة إعلانية خاصة في حساب AdMob:
//      wheel  🎡 عجلة الجوائز        (Rewards Wheel)
//      box    🎁 صندوق المكافآت      (Rewards Box)
//      double ✖️2 مضاعفة نتيجة الجولة (Doubling the round result)
//      prize  🛒 استلام الجائزة       (Receiving the cash prize)
//      extra  🎮 محاولة لعب واحدة     (Get a chance to play)
//
//  • منصّتان:
//      1) داخل تطبيق أندرويد (Capacitor) → SDK الحقيقي
//         @capacitor-community/admob عبر Capacitor.Plugins.AdMob
//         — الجائزة تُمنح فقط عند إطلاق حدث rewarded من الـSDK
//         (المشاهدة الكاملة محققة) — لا يمكن الإجادة بالضغط على زر.
//      2) المتصفح (النسخة التجريبية على الويب) → إعلان تجريبي
//         محلي 3 ثوانٍ لاختبار المسار — ولا يعمل إلا بوضع الاختبار.
//
//  • ⚙️ كل شيء يُدار من لوحة الإدارة ← قسم «الإعلانات» (storeMeta/ads):
//      enabled    — المفتاح الرئيسي (إيقاف/تشغيل كل الإعلانات فورًا)
//      testMode   — وضع الاختبار: كل المواضع تستخدم وحدة Google
//                   الرسمية للتجربة ca-app-pub-3940256099942544/5224354917
//                   (بلا حاجة لحقول مفاتيح منفصلة — مفتاح واحد فقط!)
//                   عند الإيقاف تستخدم كل المواضع مفاتيحها الحقيقية.
//      cooldownSec — الفاصل الأدنى بين إعلانين لنفس اللاعب (افتراضي 120ث = دقيقتان)
//      dailyLimit  — أقصى عدد إعلانات للاعب في اليوم (افتراضي 20)
//      unitIds     — تجاوز مفاتيح المواضع الحقيقية (اختياري)
//
//  • 🔴 التبديل لحظي: تعديل الإعدادات من اللوحة يصل لكل الأجهزة
//    المفتوحة فورًا (onSnapshot) بلا إعادة بناء التطبيق.
//
//  • 📊 حماية التكرار: عدّاد يومي محلي + فاصل زمني — والخزان
//    (economy.tankAdViewed) يسجل كل مشاهدة سحابيًا للمراجعة.
// ============================================================

import { db } from '../firebase-config.js';
import { doc, getDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { openModal, closeModal, hideModalX } from '../ui/modal.js';
import { notify } from '../ui/helpers.js';
import { icon } from '../ui/icons.js';
import { t } from '../i18n.js';

/* ==========================================================
 * 🏷️ ثوابت AdMob — من حسابك (لقطات الشاشة)
 * ========================================================== */

/** 🆔 معرّف التطبيق في AdMob — يوضع في AndroidManifest.xml عند البناء
 *  (ثابت لا يُدار من اللوحة لأنه يُبنى داخل التطبيق نفسه) */
export const ADMOB_APP_ID = 'ca-app-pub-1430212159347635~3368025556';

/** 🧪 وحدة الاختبار الرسمية من Google — إعلانات مكافآت فيديو
 *  مفتاح واحد لكل المواضع أثناء وضع الاختبار (انقر بلا حدود،
 *  تحمل شعار «إعلان تجريبي» ولا تُحسب عليك) */
export const TEST_REWARDED_ID = 'ca-app-pub-3940256099942544/5224354917';

/** 📍 المواضع الخمسة + مفاتيحها الحقيقية الافتراضية من حساب AdMob.
 *  يمكن للأدمن تجاوز أي مفتاح من لوحة الإدارة (storeMeta/ads.unitIds). */
export const AD_PLACEMENTS = {
  wheel:  { labelAr: '🎡 عجلة الجوائز',         labelEn: 'Rewards Wheel',  unit: 'ca-app-pub-1430212159347635/8732032872' },
  box:    { labelAr: '🎁 صندوق المكافآت',        labelEn: 'Rewards Box',    unit: 'ca-app-pub-1430212159347635/8550255387' },
  double: { labelAr: '✖️2 مضاعفة نتيجة الجولة',  labelEn: 'Double result',  unit: 'ca-app-pub-1430212159347635/2573818639' },
  prize:  { labelAr: '🛒 استلام الجائزة',        labelEn: 'Cash prize',     unit: 'ca-app-pub-1430212159347635/5509159072' },
  extra:  { labelAr: '🎮 محاولة لعب واحدة',      labelEn: 'Chance to play', unit: 'ca-app-pub-1430212159347635/5916353188' }
};

/** ⚙️ الإعدادات الافتراضية (تُستخدم قبل أي حفظ من اللوحة) */
const DEFAULTS = Object.freeze({
  enabled: true,
  testMode: true,        // 🔴 نبدأ بوضع الاختبار — يُطفأ من اللوحة بعد النشر فقط
  cooldownSec: 120,      // دقيقتان بين كل إعلانين لنفس الجهاز
  dailyLimit: 20,        // حد أقصى 20 إعلانًا يوميًا
  unitIds: {}            // تجاوزات المفاتيح الحقيقية (فارغ = الافتراضية بالأعلى)
});

/* ==========================================================
 * ☁️ تحميل إعدادات الإدارة + 🔴 مستمع لحظي
 * ========================================================== */
let remoteCfg = null;          // آخر نسخة سحابية (null = لم تُضبط بعد)
let _cfgWatchers = [];

/** دمج الافتراضي مع السحابي */
export function getAdsConfig() {
  if (!remoteCfg) return { ...DEFAULTS, unitIds: { ...DEFAULTS.unitIds } };
  return {
    enabled: remoteCfg.enabled !== false,
    testMode: remoteCfg.testMode !== false,
    cooldownSec: Math.max(0, Math.floor(Number(remoteCfg.cooldownSec) || DEFAULTS.cooldownSec)),
    dailyLimit: Math.max(1, Math.floor(Number(remoteCfg.dailyLimit) || DEFAULTS.dailyLimit)),
    unitIds: { ...(remoteCfg.unitIds || {}) }
  };
}

/** قراءة واحدة أولية + تجهيز المستمعين (يُستدعى مرة من app.js) */
export async function initAds() {
  try {
    const snap = await getDoc(doc(db, 'storeMeta', 'ads'));
    remoteCfg = snap.exists() ? snap.data() : null;
  } catch { /* بلا اتصال — نكمل بالافتراضي */ }

  try {
    _cfgWatchers.push(onSnapshot(doc(db, 'storeMeta', 'ads'), (s) => {
      remoteCfg = s.exists() ? s.data() : null;
      try { window.dispatchEvent(new CustomEvent('adsconfigchange')); } catch {}
    }, () => {}));
  } catch { /* بلا اتصال */ }
}

/** المفتاح الفعّال للموضع: وضع الاختبار → وحدة Google الموحدة */
export function resolveUnitId(kind) {
  const cfg = getAdsConfig();
  if (cfg.testMode) return TEST_REWARDED_ID;
  const p = AD_PLACEMENTS[kind] || {};
  return String(cfg.unitIds?.[kind] || p.unit || '') || TEST_REWARDED_ID;
}

/* ==========================================================
 * 🚧 بوابة التكرار — الفاصل الزمني + الحد اليومي
 * ========================================================== */
const LOG_KEY = 'bqa_ads_log';

function _dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function _readLog() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOG_KEY) || 'null');
    if (raw && raw.date === _dayKey()) return raw;
  } catch {}
  return { date: _dayKey(), count: 0, lastAt: 0 };
}

function _writeLog(log) {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch {}
}

/** كم إعلانًا شاهده هذا الجهاز اليوم؟ (لعرضه في الواجهة) */
export function adsTodayCount() {
  return _readLog().count || 0;
}

/**
 * 🚧 هل يمكن عرض إعلان الآن؟ يعيد { ok, waitSec, reason }
 *  — لا يعرض شيئًا، مجرد فحص يُستخدم قبل تشغيل مسار الإعلان.
 */
export function adsGate() {
  const cfg = getAdsConfig();
  if (!cfg.enabled) {
    return { ok: false, waitSec: 0, reason: t('adsDisabled', 'الإعلانات معطّلة حاليًا من إدارة اللعبة') };
  }
  const log = _readLog();
  if (log.count >= cfg.dailyLimit) {
    return { ok: false, waitSec: 0, reason: t('adsDailyCap', 'وصلت الحد اليومي للإعلانات — عد غدًا لمزيد من المكافآت 🌙') };
  }
  const since = (Date.now() - (Number(log.lastAt) || 0)) / 1000;
  if (cfg.cooldownSec > 0 && log.lastAt && since < cfg.cooldownSec) {
    return { ok: false, waitSec: Math.ceil(cfg.cooldownSec - since), reason: '' };
  }
  return { ok: true, waitSec: 0, reason: '' };
}

/* ==========================================================
 * 📱 المنصة 1 — SDK الحقيقي داخل تطبيق أندرويد (Capacitor)
 * ========================================================== */

let _admobInit = null;

/** تهيئة SDK مرة واحدة لكل جلسة */
function _admobPlugin() {
  // عبر Capacitor Bridge — بلا أي حزمة npm في الواجهة:
  // الإضافة الأصلية تسجّل نفسها تلقائيًا داخل التطبيق المبني.
  return (typeof window !== 'undefined' && window.Capacitor?.Plugins?.AdMob) || null;
}

async function _admobInitOnce(testMode) {
  const plugin = _admobPlugin();
  if (!plugin) return null;
  if (!_admobInit) {
    _admobInit = plugin.initialize({
      initializeForTesting: !!testMode,
      requestTestAds: !!testMode   // توافق مع الإصدارات الأقدم
    }).catch((e) => { _admobInit = null; throw e; });
  }
  await _admobInit;
  return plugin;
}

/**
 * 📱 تشغيل إعلان مكافآت حقيقي — الجائزة فقط عند حدث rewarded
 * من الـSDK (المشاهدة اكتملت). أي إغلاق مبكر = false بلا جائزة.
 */
async function _showRealRewarded(kind) {
  const cfg = getAdsConfig();
  const unitId = resolveUnitId(kind);
  const p = AD_PLACEMENTS[kind] || {};

  let plugin;
  try {
    plugin = await _admobInitOnce(cfg.testMode);
  } catch (e) {
    console.warn('[ads] initialize failed:', e?.message || e);
    return false;
  }
  if (!plugin) return false;

  let earned = false;
  let unsubReward = () => {};
  let unsubClosed = () => {};
  let unsubFailLoad = () => {};
  let unsubFailShow = () => {};
  let closedResolve;
  const closedPromise = new Promise((res) => { closedResolve = res; });

  try {
    // 🔑 حدث «rewarded» هو الدليل الوحيد على اكتمال المشاهدة —
    //    لا تُمنح الجائزة إلا إذا أطلقه الـSDK بنفسه
    const rl = await plugin.addListener('rewarded', () => { earned = true; });
    unsubReward = () => { try { rl?.remove?.(); } catch {} };
    const cl = await plugin.addListener('closed', () => { closedResolve(); });
    unsubClosed = () => { try { cl?.remove?.(); } catch {} };
    const fl = await plugin.addListener('failedToLoad', (e) => {
      console.warn('[ads] failedToLoad:', e?.message || e);
      closedResolve();
    });
    unsubFailLoad = () => { try { fl?.remove?.(); } catch {} };
    const fl2 = await plugin.addListener('failedToShow', (e) => {
      console.warn('[ads] failedToShow:', e?.message || e);
      closedResolve();
    });
    unsubFailShow = () => { try { fl2?.remove?.(); } catch {} };

    // تجهيز ثم عرض — أي فشل هنا يعني لا إعلان ولا جائزة
    await plugin.prepareRewardVideoAd({ adId: unitId });
    const result = await plugin.showRewardVideoAd().catch(() => null);
    // بعض الإصدارات تعيد العنصر المُكافأ هنا أيضًا — نقبّله كدليل ثانٍ
    if (result && typeof result === 'object' && result.amount != null) earned = true;

    await closedPromise;               // ننتظر إغلاق الشاشة (أو فشل التحميل)
    return earned;                     // ✅ فقط عند تأكيد الـSDK
  } catch (e) {
    console.warn('[ads] rewarded flow failed:', e?.message || e);
    return false;
  } finally {
    unsubReward(); unsubClosed(); unsubFailLoad(); unsubFailShow();
  }
}

/* ==========================================================
 * 🖥️ المنصة 2 — الإعلان التجريبي في المتصفح (اختبار المسار فقط)
 * ========================================================== */

/** 🧪 جسد الإعلان التجريبي — 3 ثوانٍ بلا إغلاق ثم نجاح تلقائي.
 *  يعمل فقط في وضع الاختبار وفي المتصفح (الويب لا يعرض إعلانات حقيقية). */
function _playWebStub() {
  return new Promise((resolve) => {
    const AD_MS = 3000; // ⏱️ مدة الإعلان التجريبي
    openModal('🎬 ' + t('adTitle', 'إعلان تجريبي'), `
      <div class="ad-stub">
        <div class="ad-screen">
          <span class="ad-cam">${icon('camera')}</span>
          <div class="ad-wave"><i></i><i></i><i></i><i></i><i></i></div>
        </div>
        <div class="ad-count" id="ad-count">3</div>
        <p class="ad-note">${t('adNote', 'وضع الاختبار — في التطبيق النهائي سيظهر هنا إعلان Google الحقيقي')}</p>
      </div>`, '');
    // 🚫 لا إغلاق أثناء الإعلان — تُستكمل المدة ثم يُغلق تلقائيًا
    hideModalX();
    const m = document.getElementById('modal');
    if (m) m.onclick = null;
    let left = Math.ceil(AD_MS / 1000);
    const iv = setInterval(() => {
      left -= 1;
      const el = document.getElementById('ad-count');
      if (el) el.textContent = String(Math.max(0, left));
      if (left <= 0) {
        clearInterval(iv);
        closeModal();
        resolve(true);
      }
    }, 1000);
  });
}

/* ==========================================================
 * 🎬 الواجهة الموحدة — playAd(kind)
 * ========================================================== */

/**
 * 🎬 مشاهدة إعلان — الواجهة الموحدة (تعيد true عند اكتمال المشاهدة
 *  وتأكيد الـSDK). كل مواضع اللعبة الخمسة تستدعي هذه الدالة فقط.
 *  🚧 تمر من بوابة التكرار (فاصل دقيقتين + حد يومي) أولًا.
 *  📊 كل نجاح يُسجّل محليًا + في الخزان بنوعه ودولة اللاعب.
 *  @param {string} kind نوع موضع الإعلان: wheel|box|double|prize|extra|other
 */
export async function showRewardedAd(kind = 'other') {
  // 🚧 البوابة أولًا — المفتاح الرئيسي والحد اليومي والفاصل
  const gate = adsGate();
  if (!gate.ok) {
    if (gate.reason) notify('🚫 ' + gate.reason, 'warn');
    else if (gate.waitSec > 0) {
      const min = Math.floor(gate.waitSec / 60);
      const sec = gate.waitSec % 60;
      notify('⏳ ' + t('adsCooldown', `انتظر ${min > 0 ? min + ' دقيقة و' : ''}${sec} ثانية قبل الإعلان التالي`), 'warn');
    }
    return false;
  }

  const cfg = getAdsConfig();
  const isApp = !!(typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.());

  let ok = false;
  if (isApp) {
    // 📱 التطبيق المبني — إعلان Google حقيقي (تجريبي أو رسمي حسب الوضع)
    ok = await _showRealRewarded(kind);
    if (!ok && cfg.testMode) {
      // 🧪 في وضع الاختبار داخل التطبيق: إن فشل تحميل SDK (جهاز بلا
      //    خدمات Google مثل المحاكيات) نكمل بالجسد التجريبي لنختبر المسار
      ok = await _playWebStub();
    }
  } else {
    // 🖥️ المتصفح — بيئة اختبار فقط
    if (cfg.testMode) {
      ok = await _playWebStub();
    } else {
      // وضع رسمي على الويب: لا SDK إعلانات في المتصفح (قرار النظام الواحد)
      notify('📱 ' + t('adsAppOnly', 'الإعلانات الحقيقية متاحة في نسخة التطبيق — هذه نسخة تجريبية على الويب'), 'warn');
      return false;
    }
  }

  // 📊 نجاح المشاهدة — تسجيل محلي + الخزان
  if (ok) {
    const log = _readLog();
    _writeLog({ date: _dayKey(), count: (log.count || 0) + 1, lastAt: Date.now() });
    try {
      const { tankAdViewed } = await import('./economy.js');
      const { getPlayer } = await import('../auth.js');
      // 🧪 v31.1 — مشاهدة وضع الاختبار تُسجَّل في عدّادات منفصلة كي لا تختلط بالحقيقية
      tankAdViewed(1, kind, (getPlayer() || {}).country || '', !!cfg.testMode);
    } catch {}
  }
  return ok;
}

/** 🧹 إيقاف المستمعين (للاختبار/التنظيف) */
export function stopAdsWatchers() {
  _cfgWatchers.forEach(u => { try { u(); } catch {} });
  _cfgWatchers = [];
}
