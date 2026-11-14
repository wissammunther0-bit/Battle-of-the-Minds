// ui/badges.js — v30
// ============================================================
// 🔴 نظام شارات التنبيه (Badges) — يبدأ مع تشغيل التطبيق:
//
//  - 👥 أيقونة الأصدقاء: دائرة حمراء بعدد الطلبات الواردة
//    (مستمع لحظي واحد عالمي — يعمل من لحظة الدخول للقائمة الرئيسية
//    فيصل التنبيه حتى وأنت في أي شاشة، وقائمة الأصدقاء تفتح معبأة).
//
//  - 🛒 أيقونة المتجر: لافتة «جديد» مكتوبة عند إضافة عناصر جديدة —
//    الإصدار يُقرأ من Firestore (storeMeta/version) ويزيده المطور
//    من صفحة الأدمن → لافتة تلقائية لكل اللاعبين دون تحديث الكود.
//    🔴 v30 (طلب المستخدم): اللافتة صارت لحظية أيضًا — عنصر يُضاف
//    من لوحة الإدارة وأنت داخل اللعبة يظهر «جديد» فورًا بلا تحديث،
//    وهي نص مكتوب «جديد» لا مجرد نقطة، وتختفي عند فتح المتجر.
//
//  - 🎒 أيقونة الحقيبة: لافتة «جديد» عند وصول شيء جديد إلى الحقيبة
//    (أداة مشتراة · شخصية جديدة · جائزة مستلمة · تعديل من لوحة
//    الإدارة) — تختفي عند فتح الحقيبة (طلب المستخدم v30).
// ============================================================

import { listenIncomingRequests } from '../game/social.js';
import { getStoreVersion, onCatalogChange } from '../store-catalog.js';
import { getPlayer } from '../auth.js';
import { t } from '../i18n.js';

/* ⚠️ احتياط فقط — الإصدار الفعلي يأتي من Firestore (storeMeta/version)
   ويُدار من صفحة الأدمن مباشرة. */
export const STORE_VERSION = 2;

const K_SEEN = 'ba_seen_store_version';
const K_BAG_SEEN = 'ba_seen_bag_signature';

let incoming = [];
let incomingLoaded = false;
const subs = new Set();

/** اشتراك أي شاشة بتحديثات الطلبات الواردة */
export function onIncomingChange(cb) {
  subs.add(cb);
  if (incomingLoaded) cb(incoming); // بيانات جاهزة — رد فوري
  return () => subs.delete(cb);
}

/** لقطة الطلبات الواردة الحالية (بلا انتظار) */
export function getIncomingSnapshot() {
  return incoming;
}

export function isIncomingLoaded() {
  return incomingLoaded;
}

/** 👥 تحديث شارة الأصدقاء في الشريط السفلي */
function updateFriendsBadge() {
  const el = document.getElementById('badge-friends');
  if (!el) return;
  const n = incoming.length;
  if (n > 0) {
    el.textContent = n > 99 ? '99+' : String(n);
    el.classList.remove('hidden', 'dot');
    el.classList.add('pop');
    setTimeout(() => el.classList.remove('pop'), 400);
  } else {
    el.classList.add('hidden');
    el.textContent = '';
  }
}

/** 💫 إظهار لافتة «جديد» بنبضة — على أي بطاقة (متجر/حقيبة) */
function _paintNewBadge(el, isNew) {
  if (!el) return;
  el.textContent = isNew ? t('newBadge', 'جديد') : '';
  el.classList.toggle('hidden', !isNew);
  if (isNew) {
    el.classList.remove('pop');
    void el.offsetWidth;   // إعادة تشغيل الأنيميشن
    el.classList.add('pop');
    setTimeout(() => el.classList.remove('pop'), 400);
  }
}

/** 🛒 لافتة «جديد» على المتجر — إصدار الكتالوج أعلى من آخر زيارة؟ */
function updateStoreBadge() {
  const el = document.getElementById('badge-store');
  if (!el) return;
  let seen = 0;
  try { seen = parseInt(localStorage.getItem(K_SEEN) || '0', 10) || 0; } catch {}
  _paintNewBadge(el, getStoreVersion() > seen);
}

/** 🎒 بصمة محتويات الحقيبة — أي إضافة جديدة تغيّر البصمة */
function bagSignature() {
  const p = getPlayer() || {};
  return JSON.stringify({
    b: p.boosters || {},                                        // الأدوات
    c: [...(p.ownedCharacters || [])].sort(),                   // الشخصيات
    a: [...(p.ownedAvatars || [])].sort(),                      // الأفاتار القديم
    z: (p.prizeClaims || [])
      .filter(c => c.collectedAt)                               // الجوائز المستلمة فقط
      .map(c => `${c.id || c.awardId}:${c.collectedAt || 0}`)
  });
}

/** 🎒 لافتة «جديد» على الحقيبة — البصمة الحالية مختلفة عن آخر فتح؟ */
function updateBagBadge() {
  const el = document.getElementById('badge-bag');
  if (!el) return;
  if (!getPlayer()) { el.classList.add('hidden'); el.textContent = ''; return; }
  let seen = '';
  try { seen = localStorage.getItem(K_BAG_SEEN) || ''; } catch {}
  _paintNewBadge(el, !!seen && bagSignature() !== seen);
}

/** زيارة المتجر → إخفاء اللافتة (يُخزَّن رقم إصدار الكتالوج الحالي) */
export function markStoreSeen(version = null) {
  const v = version ?? getStoreVersion();
  try { localStorage.setItem(K_SEEN, String(v)); } catch {}
  updateStoreBadge();
}

/** فتح الحقيبة → إخفاء اللافتة (تُحفظ بصمة المحتويات الحالية) */
export function markBagSeen() {
  try { localStorage.setItem(K_BAG_SEEN, bagSignature()); } catch {}
  updateBagBadge();
}

/** 🚀 بدء النظام — يُستدعى مرة واحدة من app.js بعد تسجيل اللاعب */
export function initBadges() {
  // 🎒 أول تشغيل للنظام الجديد؟ اعتمد محتويات الحقيبة الحالية أساسًا —
  //    اللافتة تظهر فقط لما يُضاف بعد ذلك (لا إزعاج بقديم)
  try {
    if (!localStorage.getItem(K_BAG_SEEN)) {
      localStorage.setItem(K_BAG_SEEN, bagSignature());
    }
  } catch {}

  updateStoreBadge();
  updateBagBadge();

  // 👥 مستمع لحظي عالمي واحد — طوال عمر الجلسة
  listenIncomingRequests((reqs) => {
    incoming = reqs || [];
    incomingLoaded = true;
    updateFriendsBadge();
    subs.forEach(cb => { try { cb(incoming); } catch {} });
  });

  // 🛒 كتالوج المتجر لحظي — عنصر يُضاف من لوحة الإدارة وأنت داخل
  //    اللعبة = لافتة «جديد» فورية على بطاقة المتجر (طلب المستخدم)
  onCatalogChange(() => updateStoreBadge());

  // 🎒 أي تغيّر في ملف اللاعب (شراء/استلام جائزة/تعديل الإدارة)
  //    أو حدث شراء صريح → أعد تقييم شارة الحقيبة فورًا
  document.addEventListener('cloudplayer', updateBagBadge);
  document.addEventListener('bagchange', updateBagBadge);

  // إعادة تطبيق الشارات عند العودة للقائمة الرئيسية
  document.addEventListener('viewchange', (e) => {
    if (e.detail === 'main') {
      updateFriendsBadge();
      updateStoreBadge();
      updateBagBadge();
    }
  });
}
