// game/moderation.js
// ============================================================
// 🚫 الحظر والإدارة — v11
//
//  - الحظر: players/{uid}.banned = true (+ bannedReason/bannedAt)
//    أو وثيقة tombstone في banned/{uid} (للاعبين المحذوفين).
//  - ❄️ التجميد العقابي (v11): players/{uid}.frozenUntil = timestamp —
//    اللاعب لا يلعب حتى تنتهي المدة التي حددها المطور (بدون حظر نهائي).
//  - اللاعب المحظور يرى شاشة الحظر + زر «متابعة» يعيده لاعبًا جديدًا
//    (يمسح الجلسة المحلية والمجهولة ثم يفتح شاشة التسجيل من جديد).
//  - الفحص: عند إقلاع التطبيق وعند كل عودة للقائمة الرئيسية.
// ============================================================

import { ensureAuth, db } from '../firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

let _bannedCache = null;   // null = غير مفحوص، false = سليم، {} = محظور
let _lastCheck = 0;

/**
 * 🧮 v28 — تقييم حالة اللاعب من بيانات الوثيقتين (دالة نقيّة بلا قراءات).
 * تُستخدم من فحص الإقلاع (checkBanStatus) ومن المستمع اللحظي (liveSync)
 * حتى يصبح الحظر/التجميد لحظيًا من لوحة الإدارة بلا انتظار أو إعادة تحميل.
 * @param {object|null} playerData بيانات players/{uid} (null = لا وثيقة)
 * @param {object|null} tombData   بيانات banned/{uid} (null = لا وثيقة)
 * @returns {{banned:boolean, deleted?:boolean, frozen?:boolean,
 *                 reason?:string, bannedAt?:number|null,
 *                 frozenUntil?:number, frozenReason?:string}}
 */
export function statusFromDocs(playerData, tombData, now = Date.now()) {
  // ⚰️ وثيقة tombstone = حذف نهائي من الإدارة (حظر دائم)
  if (tombData) {
    return { banned: true, deleted: true, reason: tombData.reason || '' };
  }
  if (playerData) {
    if (playerData.banned) {
      return {
        banned: true,
        deleted: false,
        reason: playerData.bannedReason || '',
        bannedAt: playerData.bannedAt?.toMillis?.() || null
      };
    }
    // ❄️ تجميد عقابي مؤقت — يمنع اللعب حتى frozenUntil
    const frozenUntilMs = playerData.frozenUntil?.toMillis?.() || 0;
    if (frozenUntilMs && frozenUntilMs > now) {
      return {
        banned: false,
        frozen: true,
        frozenUntil: frozenUntilMs,
        frozenReason: playerData.frozenReason || ''
      };
    }
  }
  return { banned: false, frozen: false };
}

/**
 * فحص حالة الحظر/التجميد للاعب الحالي
 * @returns {null|{banned:boolean, reason:string, deleted:boolean,
 *                   frozen:boolean, frozenUntil:number, frozenReason:string}}
 *   null → لا يوجد مستخدم/فشل الفحص (لا نحظر بالخطأ)
 */
export async function checkBanStatus() {
  try {
    const u = await ensureAuth();
    if (!u) return null;

    // كاش قصير (10 ثوان) لتقليل القراءات
    if (_bannedCache && Date.now() - _lastCheck < 10000) return _bannedCache;

    const [playerSnap, tombSnap] = await Promise.all([
      getDoc(doc(db, 'players', u.uid)),
      getDoc(doc(db, 'banned', u.uid)).catch(() => null)
    ]);

    _lastCheck = Date.now();

    // 🧮 v28 — نفس التقييم النقيّ المستخدم في المستمع اللحظي (مصدر واحد للحقيقة)
    _bannedCache = statusFromDocs(
      playerSnap.exists() ? playerSnap.data() : null,
      (tombSnap && tombSnap.exists()) ? tombSnap.data() : null
    );
    return _bannedCache;
  } catch {
    return null;
  }
}

/** إلغاء الكاش (بعد انتهاء جولة مثلاً) */
export function invalidateBanCache() {
  _bannedCache = null;
  _lastCheck = 0;
}
