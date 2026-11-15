// game/liveSync.js — v28 (طلب المستخدم)
// ============================================================
// 🔴 التحديث اللحظي لجهة اللاعب — بلا إعادة تحميل الصفحة
//
//  ماذا يستمع؟
//   1) players/{uid}  — وثيقة اللاعب نفسها:
//      🚫 الحظر الفوري (banned=true) وشاشة الحظر فورًا
//      ❄️ التجميد الفوري (frozenUntil) بشاشة التجميد
//      ✅ رفع الحظر/التجميد لحظيًا عند إلغائه من لوحة الإدارة
//      💎 تحديث المتغيرات لحظيًا: الجواهر، علامات الانتصار، جوائز
//         الذكاء، الأدوات (boosters)، الشخصيات المملوكة/المجهزة،
//         الاسم… أي تعديل من لوحة الإدارة يصل للاعب فورًا ويُحدّث
//         الشريط العلوي والشاشة الحالية دون إعادة تحميل.
//   2) banned/{uid}   — وثيقة الحذف النهائي (tombstone):
//      حذف اللاعب من الإدارة يظهر له شاشة الحذف فورًا حتى وهو
//      داخل جولة.
//   3) gameMeta/factoryReset — علامة استعادة وضع المصنع لحظيًا:
//      أي جهاز مفتوح أثناء الاستعادة يُمسّح ويعيد التحميل فورًا
//      دون انتظار تنقّل أو إعادة تشغيل.
//
//  ⚠️ منع حلقة الكتابة: التحديثات القادمة من السحابة تُحفظ محليًا
//     بـ savePlayer(local, false) — أي بدون مزامنة عكسية — وكذلك
//     صدورة كتاباتنا نحن (updatedAt قريب من وقت الكتابة) تُتجاهل.
// ============================================================

import { ensureAuth, db } from '../firebase-config.js';
import { statusFromDocs } from './moderation.js';
import { getPlayer, savePlayer } from '../auth.js';
import { refreshTopbar } from '../ui/topbar.js';
// 🤫 v32.1 — أُزيل استيراد notify: التطبيق السحابي صامت تمامًا للاعب
//   (إشعار «تم تحديث حسابك من لوحة الإدارة» كان يفضح آلية اللعبة الداخلية)

let _started = false;
let _cbModeration = null;

// آخر بيانات سحابية (لتقييم الحظر مع وثيقة tombstone معًا)
let _playerData = null;
let _tombData = null;

/**
 * الحقول التي تُطبَّق من السحابة على الجهاز لحظيًا.
 * ملاحظة: askedQuestionIds مستثناة عمدًا — مالكها الوحيد game/rotation.js.
 */
const SYNC_FIELDS = [
  'name', 'country', 'email',
  'tokens', 'gems', 'intel',
  'wins', 'losses', 'totalVictories',
  'correctAnswers', 'wrongAnswers', 'roundsPlayed',
  'ownedCharacters', 'equippedCharacter',
  'ownedAvatars', 'equippedAvatar',
  'boosters', 'bagPrizes', 'soundEnabled', 'soundSet', 'lastAdTokenAt'
];

function same(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function onPlayerDoc(snap) {
  _playerData = snap.exists() ? snap.data() : null;
  _evaluate();
}

function onTombDoc(snap) {
  _tombData = snap.exists() ? snap.data() : null;
  _evaluate();
}

/** تقييم الحالة (حظر/تجميد) + تطبيق المتغيرات — مع كل نبضة سحابية */
function _evaluate() {
  const st = statusFromDocs(_playerData, _tombData);
  try { if (_cbModeration) _cbModeration(st); }
  catch (e) { console.warn('[liveSync] moderation callback failed:', e); }
  _applyVariables();
}

/**
 * 💎 تطبيق المتغيرات السحابية على الملف المحلي — أي تعديل من لوحة
 * الإدارة (جواهر/علامات/أدوات/شخصيات…) يظهر فورًا عند اللاعب.
 */
function _applyVariables() {
  if (!_playerData) return;
  const local = getPlayer();
  if (!local || !local.name) return;   // لاعب لم يسجل بعد — لا شيء للتطبيق

  // 🔇 صدورة كتابتنا الخاصة؟ (المزامنة المحلية وصلت للسحابة الآن)
  //    updatedAt قريب من وقت كتابتنا → تجاهل كي لا نعيد تطبيق ما كتبناه
  const upd = _playerData.updatedAt?.toMillis?.() || 0;
  const lastWrite = window.__bqaLastWrite || 0;
  if (upd && lastWrite && Math.abs(upd - lastWrite) < 3000) return;

  const changed = [];
  SYNC_FIELDS.forEach(f => {
    if (_playerData[f] === undefined) return;               // حقل غير موجود سحابيًا — لا مساس
    if (!same(_playerData[f], local[f])) {
      local[f] = _playerData[f];
      changed.push(f);
    }
  });
  if (!changed.length) return;

  // 🚫 بلا مزامنة عكسية (syncToCloud=false) — منع حلقة سحابة↔جهاز
  savePlayer(local, false);

  try { refreshTopbar(); } catch {}   // الشريط العلوي: الجواهر/العلامات/الاسم/الأفاتار

  // 🔔 إبلاغ كل الشاشات المفتوحة (المتجر/الملف/الحقيبة/الرئيسية) لإعادة الرسم
  try { document.dispatchEvent(new CustomEvent('cloudplayer', { detail: { changed } })); } catch {}

  // 🤫 v32.1 (طلب المستخدم): التطبيق صامت تمامًا — لا إشعار يذكر الإدارة
  //    للاعب إطلاقًا. جائزة الصندوق/القرص أو أي تحديث موارد يصل اللاعب
  //    «جاهزًا» من اللعبة نفسها، وما يظهر في الكونسول للإصلاح التقني فقط.
  console.info('[liveSync] silent cloud apply:', changed.join(', '));
}

/** 🚀 تفعيل المستمعات اللحظية — يُستدعى مرة من app.js عند الإقلاع */
export function initPlayerLiveSync({ onModeration } = {}) {
  if (_started) return;
  _started = true;
  _cbModeration = onModeration || null;

  (async () => {
    try {
      const FS = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js');
      const u = await ensureAuth();

      // 1) وثيقة اللاعب — تعمل حتى قبل التسجيل (تطلق أول نبضة عند إنشاء الوثيقة)
      FS.onSnapshot(FS.doc(db, 'players', u.uid), onPlayerDoc,
        (e) => console.warn('[liveSync] player watch:', e?.message || e));

      // 2) وثيقة الحذف النهائي (tombstone)
      FS.onSnapshot(FS.doc(db, 'banned', u.uid), onTombDoc,
        () => {});   // صامتة — فشلها لا يعطل اللعبة

      // 3) علامة استعادة وضع المصنع — لحظية لكل الأجهزة المفتوحة
      FS.onSnapshot(FS.doc(db, 'gameMeta', 'factoryReset'), (snap) => {
        const at = snap.exists() ? (Number(snap.data().at) || 0) : 0;
        if (at) {
          try { window.dispatchEvent(new CustomEvent('factoryreset', { detail: { at } })); } catch {}
        }
      }, () => {});
    } catch (e) {
      console.warn('[liveSync] init failed:', e?.message || e);
    }
  })();
}
