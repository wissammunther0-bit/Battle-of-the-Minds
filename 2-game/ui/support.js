// ui/support.js
// ============================================================
// 🛠️ الدعم الفني — v8 "محادثة ماسنجر"
//
//  - نافذة محادثة حديثة: أيقونة احترافية في المنتصف + اسم القسم
//    أسفلها + زر إغلاق صغير ✕ في زاوية أعلى.
//  - محادثة كأنها واتساب/ماسنجر: رسائلي في جهة وردود الدعم في
//    الجهة المقابلة، مع الوقت تحت كل رسالة وشريط كتابة أسفل.
//  - 🔔 v23: رد الدعم يُظهر إشعارًا على أيقونة الدعم في الملف
//    الشخصي وعلى أيقونة الملف في الصفحة الرئيسية — ويختفي فور
//    فتح المحادثة — ولحظة المشاهدة تُحفظ مع بيانات اللاعب في Firebase.
// ============================================================

import { getPlayer, updatePlayer } from '../auth.js';
import { ensureAuth, db } from '../firebase-config.js';
import {
  collection, addDoc, query, where, limit, getDocs, onSnapshot,
  serverTimestamp, deleteDoc, updateDoc, doc
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { getPlayerProfile } from '../game/social.js';
import { levelFromWins } from '../game/levels.js';
import { openModal, closeModal, hideModalX } from './modal.js';
import { notify } from './helpers.js';
import { t } from '../i18n.js';

const K_SEEN = 'ba_support_seen_ms';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;   // ⏳ عمر الرسالة — أسبوع واحد

const _esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

let _unsub = null;
let _tickets = [];

/* ==========================================================
 * 🔴 شارة الردود الجديدة على أيقونة الدعم
 * ========================================================== */
function lastSeenMs() {
  // ☁️ v23: لحظة آخر مشاهدة تُقرأ من ملف اللاعب (Firebase) أولًا
  try {
    const p = getPlayer();
    if (p?.lastSupportSeenAt) return Math.max(p.lastSupportSeenAt, _localSeen());
  } catch {}
  return _localSeen();
}

function _localSeen() {
  try { return parseInt(localStorage.getItem(K_SEEN) || '0', 10) || 0; } catch { return 0; }
}

function msOf(t) {
  return t?.lastReplyAt?.toMillis?.() || 0;
}

function updateSupportBadge() {
  // 🔔 شارتان معًا: أيقونة الدعم في الملف الشخصي + أيقونة الملف في الرئيسية
  const seen = lastSeenMs();
  const hasNew = _tickets.some(tk => msOf(tk) > seen);
  ['badge-support', 'badge-profile'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('hidden', !hasNew);
    if (hasNew) {
      el.classList.add('pop');
      setTimeout(() => el.classList.remove('pop'), 400);
    }
  });
}

export function markSupportSeen() {
  try { localStorage.setItem(K_SEEN, String(Date.now())); } catch {}
  // ☁️ حفظ لحظة المشاهدة مع بيانات اللاعب في Firebase — تُزال الشارة
  //    فور فتح المحادثة على كل أجهزة اللاعب
  try {
    const p = getPlayer();
    if (p) updatePlayer({ lastSupportSeenAt: Date.now() });
  } catch {}
  updateSupportBadge();
}

/** 🚀 مستمع لحظي لرسائلي — يُستدعى مرة من app.js بعد تسجيل اللاعب */
export function initSupport() {
  if (_unsub) { try { _unsub(); } catch {} _unsub = null; }
  ensureAuth().then(u => {
    _unsub = onSnapshot(query(
      collection(db, 'supportTickets'),
      where('uid', '==', u.uid),
      limit(30)
    ), snap => {
      _tickets = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      updateSupportBadge();
    }, () => {});
  }).catch(() => {});
  document.addEventListener('viewchange', () => updateSupportBadge());
  purgeExpiredMessages().catch(() => {});
}

/* ==========================================================
 * ⏳ منظّف الأسبوع — كل رسالة (أو رد) مضى عليها أسبوع تختفي
 *    - رسالة أقدم من أسبوع → تُحذف وثيقتها كاملة
 *    - ردود أقدم من أسبوع داخل رسالة حديثة → تُزال من المصفوفة
 * ========================================================== */
export async function purgeExpiredMessages() {
  try {
    const u = await ensureAuth();
    const snap = await getDocs(query(
      collection(db, 'supportTickets'),
      where('uid', '==', u.uid),
      limit(30)
    ));
    const now = Date.now();
    for (const d of snap.docs) {
      const tk = d.data();
      const created = tk.createdAt?.toMillis?.() || 0;

      // 🗑️ الرسالة نفسها مضى عليها أسبوع → حذف المحادثة كاملة
      if (created && now - created > WEEK_MS) {
        await deleteDoc(d.ref).catch(() => {});
        continue;
      }

      // 🧹 ردود مضى عليها أسبوع داخل رسالة حديثة → إزالتها فقط
      const replies = Array.isArray(tk.replies) ? tk.replies : [];
      const fresh = replies.filter(r => {
        const at = typeof r?.at === 'number' ? r.at : 0;
        return !at || now - at <= WEEK_MS;
      });
      if (fresh.length !== replies.length) {
        await updateDoc(doc(db, 'supportTickets', d.id), { replies: fresh }).catch(() => {});
      }
    }
  } catch {}
}

/* ==========================================================
 * ✉️ إرسال رسالة إلى قاعدة البيانات (يقرأها الأدمن ويرد)
 * ========================================================== */
export async function sendSupportMessage(message) {
  const text = String(message || '').trim();
  if (text.length < 3) return { ok: false, msg: t('supportHint') };
  try {
    const u = await ensureAuth();
    const p = getPlayer();
    const profile = await getPlayerProfile(u.uid).catch(() => null);
    await addDoc(collection(db, 'supportTickets'), {
      uid: u.uid,
      name: p?.name || profile?.name || 'لاعب',
      country: p?.country || profile?.country || 'SA',
      level: profile?.level || levelFromWins(p?.wins || 0),
      email: p?.email || '',
      message: text.slice(0, 2000),
      status: 'open',          // open → answered (من الأدمن)
      replies: [],
      lastReplyAt: null,
      createdAt: serverTimestamp()
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: e?.message || 'فشل الإرسال' };
  }
}

/* ==========================================================
 * 🪟 نافذة المحادثة — إرسال + عرض الردود بأسلوب ماسنجر
 * ========================================================== */
export function openSupportModal() {
  render();
  markSupportSeen();
  purgeExpiredMessages().catch(() => {});
}

/** تنسيق وقت الرسالة (ساعة:دقيقة) */
function fmtClock(ms) {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

/** تجميع كل الرسائل (رسائلي + ردود الدعم) في تسلسل زمني واحد */
function buildTimeline() {
  const items = [];
  const now = Date.now();
  [..._tickets]
    .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0))
    .forEach(tk => {
      const created = tk.createdAt?.toMillis?.() || 0;
      if (created && now - created > WEEK_MS) return; // ⏳ منتهية — لا تُعرض
      items.push({ side: 'me', text: tk.message, at: created });
      (tk.replies || []).forEach(r => {
        const at = typeof r?.at === 'number' ? r.at : 0;
        if (at && now - at > WEEK_MS) return;          // ⏳ رد منتهي
        items.push({ side: 'sup', text: r.msg, at });
      });
    });
  return items;
}

function bubbleHTML(m) {
  const time = fmtClock(m.at);
  const tag = m.side === 'me' ? t('supportYouTag', 'أنت') : t('supportReplyTag', 'الدعم الفني');
  return `
    <div class="sup-bub ${m.side}">
      <div class="sup-bub-head">${_esc(tag)}</div>
      <p>${_esc(m.text)}</p>
      ${time ? `<time>${_esc(time)}</time>` : ''}
    </div>`;
}

function render() {
  const items = buildTimeline();
  const threadHTML = items.length
    ? items.map(bubbleHTML).join('')
    : `<div class="sup-empty">${t('supportEmpty')}</div>`;

  openModal('', `
    <div class="sup-chat">
      <!-- 🗑️ علامة ✕ العامة مخفية هنا — للنافذة زر إغلاقها المخصص (v13) -->
      <button class="sup-close" id="sup-close" aria-label="${t('close')}" title="${t('close')}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"
             stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>

      <!-- 🛠️ ترويسة المحادثة: أيقونة احترافية + الاسم أسفلها -->
      <div class="sup-hero">
        <div class="sup-hero-ico">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>
          </svg>
        </div>
        <div class="sup-hero-title">${t('supportTitle')}</div>
      </div>

      <!-- 💬 سلسلة الرسائل -->
      <div class="sup-thread" id="sup-thread">${threadHTML}</div>

      <!-- ✍️ شريط الكتابة -->
      <div class="sup-inputbar">
        <input type="text" id="sup-input" maxlength="2000"
          placeholder="${t('supportPlaceholder')}" autocomplete="off" />
        <button class="sup-send" id="sup-send" aria-label="${t('supportSend')}" title="${t('supportSend')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>
          </svg>
        </button>
      </div>
    </div>`, '');

  const box = document.querySelector('#modal .modal-box');
  if (box) box.classList.add('chat-modal');
  hideModalX();   // 🗑️ علامة ✕ العامة مخفية — النافذة لها زر إغلاق مخصص

  document.getElementById('sup-close').onclick = closeModal;

  const thread = document.getElementById('sup-thread');
  if (thread) thread.scrollTop = thread.scrollHeight;

  const doSend = async () => {
    const input = document.getElementById('sup-input');
    const btn = document.getElementById('sup-send');
    const text = input.value;
    if (!text.trim()) return;
    btn.disabled = true;
    input.disabled = true;
    const res = await sendSupportMessage(text);
    btn.disabled = false;
    input.disabled = false;
    if (res.ok) {
      input.value = '';
      // جلب فوري ثم إعادة رسم — المستمع اللحظي يغطي البقية
      const u = await ensureAuth().catch(() => null);
      if (u) {
        try {
          const snap = await getDocs(query(
            collection(db, 'supportTickets'),
            where('uid', '==', u.uid),
            limit(30)
          ));
          _tickets = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        } catch {}
      }
      notify(t('supportSent'), 'success');
      render();
    } else {
      notify(res.msg, 'error');
    }
  };

  document.getElementById('sup-send').onclick = doSend;
  document.getElementById('sup-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSend();
  });
}
