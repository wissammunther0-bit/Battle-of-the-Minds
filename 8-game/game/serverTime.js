// game/serverTime.js
// ============================================================
// ⏱️ وحدة مزامنة وقت السيرفر (بديل .info/serverTimeOffset الخاص بـ RTDB)
//
// لأن المشروع يستخدم Firestore (وليس Realtime Database)، لا تتوفر
// خاصية .info/serverTimeOffset الجاهزة. لذلك نطبّق هنا خوارزمية
// شبيهة بـ NTP (Network Time Protocol) عبر Firestore نفسه:
//
//   1. نكتب حقلًا بقيمة serverTimestamp() (ختم السيرفر الحقيقي).
//   2. نقيس زمن الرحلة الكاملة (RTT) حول عملية الكتابة.
//   3. نقرأ الختم من السيرفر ونحسب الفارق (Offset) بين ساعته وساعتنا:
//
//        offset = serverStamp - (t0 + RTT / 2)
//
//   بعدها يصبح "الوقت الموحد" لأي جهاز:
//
//        serverNow() = Date.now() + offset
//
// وهكذا يتشارك جميع اللاعبين ساعةً منطقية واحدة بغضّ النظر عن
// انحراف ساعات أجهزتهم المحلية (Local Clock Drift).
// ============================================================

import { db } from '../firebase-config.js';
import {
  doc, setDoc, getDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

// معرّف جلسة فريد لهذا الجهاز (لتمييز مصدر الأحداث في lastEvent
// حتى لا يعيد العميل تشغيل أنيميشن حدث هو نفسه من أرسله)
export const SESSION_ID = (crypto?.randomUUID?.() ||
  ('sess_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)));

let offsetMs = 0;          // serverTime ≈ Date.now() + offsetMs
let rttMs = 0;             // زمن الرحلة الكاملة (Ping التقريبي)
let lastSyncAt = 0;        // آخر مرة نجحت فيها المزامنة
let syncPromise = null;    // منع المزامنات المتوازية
let syncFailed = false;    // هل فشلت محاولة المزامنة الأخيرة؟

const SYNC_INTERVAL_MS = 60_000;   // تحديث دوري كل دقيقة
const MIN_RETRIES_MS  = 15_000;    // أقل فاصل بين محاولتين بعد فشل

/**
 * الوقت الموحد المعتمد على ساعة السيرفر.
 * هذا هو الوقت الوحيد الذي يجب استخدامه لأي منطق متعلق بالتزامن
 * (بداية السؤال، ختم الإجابة، انتهاء المهلة... إلخ).
 * لا تستخدم Date.now() مباشرة في منطق اللعبة أبدًا.
 */
export function serverNow() {
  return Date.now() + offsetMs;
}

/** فارق الساعات بالمللي ثانية (serverTime - localTime) */
export function getOffset() {
  return offsetMs;
}

/** زمن الرحلة الكاملة بالمللي ثانية (مؤشر جودة الاتصال/Ping) */
export function getRtt() {
  return rttMs;
}

/** هل نجحت مزامنة واحدة على الأقل؟ */
export function isSynced() {
  return lastSyncAt > 0;
}

/**
 * مزامنة الوقت مع السيرفر (نمط NTP مبسّط عبر Firestore).
 * - آمن للاستدعاء المتكرر: تُهمل إن كان فاصل قصير أو تزامن جارٍ.
 * - عند فشل الصلاحيات/الشبكة نتراجع بأمان إلى offset = 0
 *   (سلوك متدهور لكنه مطابق للسلوك القديم دون انهيار).
 */
export async function syncServerTime(force = false) {
  const nowMs = Date.now();

  // منع التزامن المتوازي
  if (syncPromise) return syncPromise;

  // خفّض التكرار: لا تكتب probe جديد قبل فاصل معقول
  const minGap = syncFailed ? MIN_RETRIES_MS : SYNC_INTERVAL_MS;
  if (!force && lastSyncAt && (nowMs - lastSyncAt) < minGap) {
    return { offsetMs, rttMs, cached: true };
  }

  syncPromise = (async () => {
    try {
      // مستند probe مؤقت خاص بهذه الجلسة (لا يزاحمه عملاء آخرون)
      const probeRef = doc(db, 'serverTime', 'probe_' + SESSION_ID);

      const t0 = Date.now();
      await setDoc(probeRef, {
        clientSentAt: serverTimestamp(),
        sessionId: SESSION_ID
      });
      const snap = await getDoc(probeRef);
      const t3 = Date.now();

      const stamp = snap.data()?.clientSentAt;
      const serverMs = typeof stamp?.toMillis === 'function' ? stamp.toMillis() : null;

      // 🧹 v41 (فحص — مشكلة 23): احذف وثيقة probe فور قراءتها لمنع التراكم
      //    الدائم في Firestore. الكتابة + القراءة + الحذف في رحلة واحدة.
      try { await deleteDoc(probeRef); } catch {}

      if (serverMs != null) {
        rttMs = t3 - t0;
        // أفضل تقدير لحظة الختم على السيرفر = منتصف الرحلة (t0 + RTT/2)
        offsetMs = serverMs - (t0 + rttMs / 2);
        lastSyncAt = t3;
        syncFailed = false;
        console.info(
          `[serverTime] ✅ مزامنة ناجحة | offset=${offsetMs}ms | rtt=${rttMs}ms`
        );
      }
    } catch (e) {
      // فشل الصلاحيات أو الشبكة: نكمل بساعة محلية (سلوك قديم) دون انهيار
      syncFailed = true;
      console.warn('[serverTime] ⚠️ تعذّرت مزامنة الوقت، سيُستخدم offset=0:', e?.message || e);
    } finally {
      syncPromise = null;
    }
    return { offsetMs, rttMs, cached: false };
  })();

  return syncPromise;
}

/**
 * مزامنة مع مهلة قصوى (حتى لا تعطّل بدء المباراة لو تعثرت الشبكة).
 */
export async function syncServerTimeWithTimeout(timeoutMs = 2500) {
  try {
    return await Promise.race([
      syncServerTime(true),
      new Promise(res => setTimeout(() => res({ offsetMs, rttMs, timeout: true }), timeoutMs))
    ]);
  } catch {
    return { offsetMs: 0, rttMs: 0, failed: true };
  }
}
