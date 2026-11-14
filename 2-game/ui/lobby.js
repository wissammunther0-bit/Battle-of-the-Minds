// ui/lobby.js — v8
// ============================================================
// 🎮 واجهة اللوبي — تجهيز المباراة الاحترافي
//
//  - نافذة تجهيز v8: أيقونة مباراة حديثة + عدّاد 30 ثانية +
//    فريقك مقابل فريق الخصم بلا تمرير وبلا أي دائرة سوداء،
//    زر ✕ صغير أعلى وزر "إلغاء الجولة" أسفل (يحذف الجولة نهائيًا)
//  - اللاعبون ينضمون تدريجيًا خلال آخر 5 ثوانٍ بحركة ظهور ناعمة
//  - (v8) لا استئناف للجولات — الانسحاب من جولة بدأت = خسارة نهائية
// ============================================================

import { getPlayer } from '../auth.js';
import {
  startMatchmaking, cancelMatchmaking, createCustomRoom, joinCustomRoom,
  buildMatchFromRoom, MODE_CONFIG
} from '../lobby.js';
import { resumeOrForfeit } from '../game/presence.js';
import { WAIT_TOTAL_MS } from '../game/config.js';
import { serverNow } from '../game/serverTime.js';
import { startGame } from '../app.js';
import { getFriends } from '../friends.js';
import { getFlag, notify, confirmDialog, modernDialog } from './helpers.js';
import { openModal, closeModal } from './modal.js';
import { getQuestionPoolCount } from '../questions.js';
import { getLang, t } from '../i18n.js';
import { icon } from './icons.js';
import { getProfilePicture } from '../store-catalog.js';
// 🏆 v19 — اقتصاد علامات الانتصار (طلب المستخدم):
// لا بدء للجولة دون علامة + خصم تفاعلي + لوحة إعلان عند النفاد
import {
  hasPlayBadge, spendRoundBadge, refundRoundBadge, grantExtraPlayAttempt
} from '../store.js';
import { playAd } from '../game/rewards.js';
import { refreshTopbar } from './topbar.js';
import { db } from '../firebase-config.js';

let selectedMode = '1v1';

export function initLobby() {
  document.getElementById('lobby-status').textContent = '';
  cancelMatchmaking();
  selectedMode = '1v1';

  const lobbyModes = document.querySelectorAll('#view-lobby .mode-icon-btn');
  const updateSelectedMode = () => {
    const modeNames = { '1v1': t('modeSolo'), '2v2': t('modeDuo'), '4v4': t('modeQuad') };
    const capacity = MODE_CONFIG[selectedMode].capacity;
    const summary = document.getElementById('selected-mode-label');
    if (summary) summary.textContent = `${modeNames[selectedMode]} · ${capacity} ${t('playersCount', 'لاعبين')}`;
  };
  lobbyModes.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === '1v1');
    btn.setAttribute('aria-pressed', btn.dataset.mode === '1v1' ? 'true' : 'false');
    btn.onclick = () => {
      lobbyModes.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      selectedMode = btn.dataset.mode;
      updateSelectedMode();
    };
  });
  updateSelectedMode();

  document.getElementById('btn-start-match').onclick = async () => {
    // 🚫 لا أسئلة في قاعدة البيانات؟ لا بدء — الأسئلة من الإدارة فقط (v11)
    if (getQuestionPoolCount() === 0) {
      notify('🚫 ' + (getLang() === 'ar'
        ? 'لا توجد أسئلة مطروحة حاليًا — يضيفها مطوّر اللعبة من لوحة الإدارة'
        : 'No questions available yet — the developer adds them from the admin panel'), 'warn');
      return;
    }
    // ⚰️ تسوية أي جولة قائمة (انسحاب نهائي) ثم فتح نافذة التجهيز
    await tryResumeFirst();
    // 🏆 بوابة العلامة: خصم تفاعلي أو لوحة الإعلان عند النفاد (v19)
    await enterRoundWithBadge(() => openWaitingModal(selectedMode));
  };

}

/** ↩️ فحص جولة قائمة قبل بحث جديد — (v8: لا عودة للجولات المنسحب منها) */
async function tryResumeFirst() {
  let res;
  try {
    res = await resumeOrForfeit();
  } catch { return false; }

  if (res.action === 'forfeited') {
    notify('⏳ ' + t('forfeitedMsg', 'حُسبت جولتك السابقة انسحابًا وخسارة'), 'warn');
  }
  return false;
}

/* ==========================================================
 * ⏳ نافذة تجهيز المباراة v13 — هيكل موحّد من الأعلى للأسفل:
 *    أيقونة مباراة حديثة | "تجهيز المباراة" | العدّاد | فريقك
 *    | فريق الخصم | الحالة | زر إلغاء الجولة
 *    (طلب المستخدم v13: حُذف زر ✕ المكرر من زاوية النافذة —
 *     الإغلاق بعلامة ✕ الوحيدة أعلى النافذة العامة)
 * ========================================================== */
const ICO_MATCH = icon('start');

function openWaitingModal(mode) {
  const me = getPlayer();
  const cfg = MODE_CONFIG[mode];
  const cap = cfg.capacity;
  const teamSize = cfg.teamSize;
  const isTeamMode = teamSize > 1;

  let displayedPlayers = [{
    id: me.id,
    name: me.name,
    country: me.country,
    level: me.level,
    characterId: me.equippedCharacter || me.equippedAvatar || null
  }];
  const prevFilled = new Set(); // 🔍 لرصد المقاعد الممتلئة حديثًا (حركة ظهور)

  let currentRoomId = null;      // 🎯 غرفتي/غرفة الانضمام الحالية (لزر ✕)
  let amCreator = true;          // هل أنا منشئ الجولة؟ (زر ✕ للمنشئ فقط)
  let roomCreatedAtMs = 0;       // ⏱️ الساعة الموحدة — لحظة إنشاء الغرفة

  const modeName = mode === '1v1' ? t('modeSolo') : mode === '2v2' ? t('modeDuo') : t('modeQuad');

  const bodyHTML = `
    <div class="prep-win">
      <div class="prep-mode">${modeName} · ${cap} ${t('playersCount', 'لاعبين')}</div>
      <div class="prep-hero">
        <div class="prep-ico">${ICO_MATCH}</div>
        <div class="prep-title">${t('lobbyTitle')}</div>
      </div>
      <div class="prep-countdown">
        <div class="prep-timer" id="wait-timer">${Math.round(WAIT_TOTAL_MS / 1000)}</div>
        <div class="prep-timer-label">${t('secondsToStart', 'ثانية للبدء')}</div>
      </div>
      <div class="wait-teams" id="wait-teams"></div>
      <div class="prep-status-wrap">
        <span class="prep-status-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <div class="wait-status" id="wait-status">${t('searchPhase', 'جاري البحث عن اللاعبين...')}</div>
      </div>
      <div class="waiting-actions">
        <button class="btn btn-ghost-danger prep-cancel" id="btn-wait-cancel">${t('cancelRound', 'إلغاء الجولة')}</button>
      </div>
    </div>
  `;

  openModal('', bodyHTML, '');
  const mbox = document.querySelector('.modal-box');
  if (mbox) mbox.classList.add('modal-wide', 'prep-modal');
  document.getElementById('modal')?.classList.add('prep-overlay');

  const seatHTML = (p, colorIdx) => {
    if (p) {
      const isMe = p.id === me.id;
      const fresh = !prevFilled.has(p.id) && displayedPlayers.length > 1;
      if (fresh) prevFilled.add(p.id);
      const picture = getProfilePicture({
        equippedCharacter: p.characterId || p.equippedCharacter || p.equippedAvatar
      });
      const avatar = picture?.image
        ? `<img src="${escapeHtml(picture.image)}" alt="" draggable="false">`
        : picture?.emoji ? escapeHtml(picture.emoji) : escapeHtml(getFlag(p.country));
      // 🎨 v24 (طلب المستخدم): كل لاعب لونه — الأخضر أنا، والأحمر ثم
      //    الأزرق والأصفر و… لكل خصم (تحدي فيما بينهم لا تحالف)
      const pc = isMe ? 'pc-1' : `pc-${Math.min(8, Math.max(2, colorIdx))}`;
      // ✕ v24: زر إزالة الخصم — لمنشئ الجولة فقط وعلى غير مقعده
      const xBtn = (amCreator && !isMe)
        ? `<button class="seat-x" data-seat-x="${escapeHtml(p.id)}" data-seat-name="${escapeHtml(p.name || '')}" title="${t('seatRemoveTitle', 'إزالة هذا اللاعب من التحدي')}">✕</button>`
        : '';
      return `
        <div class="wait-seat filled pc-seat ${pc} ${isMe ? 'me' : ''} ${fresh ? 'pop' : ''}" style="animation-delay:${colorIdx * 40}ms">
          ${xBtn}
          <div class="slot-avatar">${avatar}</div>
          <div class="slot-info">
            <div class="slot-name">${escapeHtml(p.name)} ${isMe ? `<span class="prep-you-tag">${t('youTag')}</span><span class="pc-dot"></span>` : `<span class="pc-dot"></span>`}</div>
            <span class="slot-lvl">${t('lvlTag', 'مستوى')} ${Number(p.level) || (isMe ? 1 : '—')}</span>
            ${isMe ? `<div class="slot-status">${t('readyTag')}</div>` : ''}
          </div>
        </div>`;
    }
    return `
      <div class="wait-seat empty">
        <div class="slot-avatar">${icon('search')}</div>
        <div class="slot-info">
          <div class="slot-name">${t('waitingPlayer')}</div>
          <div class="slot-status">${t('searchingNow')}</div>
        </div>
      </div>`;
  };

  const renderSeats = () => {
    const box = document.getElementById('wait-teams');
    if (!box) return;
    // 🧭 v24 (إصلاح طلب المستخدم): مقعدي أولًا دائمًا — اسمي لا يذهب
    //    إلى مكان الخصم ولو انضممت لجولة منشأة من لاعب آخر
    const others = displayedPlayers.filter(p => p.id !== me.id);
    const ordered = [displayedPlayers.find(p => p.id === me.id) || { id: me.id, name: me.name, country: me.country, characterId: me.equippedCharacter || null, level: me.level }, ...others];

    // 🎨 شبكة واحدة: كل اللاعبين — الأخضر أنا وكل لاعب لونه الخاص
    //    (فردي: أخضر ضد أحمر · رباعي: 4 ألوان · 8ضد8: 8 ألوان)
    let html = `<section class="prep-team all">
      <div class="wait-team-label"><i></i>${t('playersInRound', 'اللاعبون')} (${ordered.length}/${cap})</div>
      <div class="wait-seats">`;
    for (let i = 0; i < cap; i++) {
      html += seatHTML(ordered[i] || null, i === 0 ? 1 : i + 1);
    }
    html += '</div></section>';
    box.innerHTML = html;

    // ✕ إزالة لاعب — منشئ الجولة فقط
    box.querySelectorAll('[data-seat-x]').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const pid = btn.dataset.seatX;
        const pname = btn.dataset.seatName || '';
        const ok = await confirmDialog({
          title: t('seatRemoveTitle', 'إزالة هذا اللاعب من التحدي'),
          message: `${t('seatRemoveMsg', 'سيُعاد هذا اللاعب إلى الصفحة الرئيسية مع رسالة إزالة')}<br><b>${escapeHtml(pname)}</b>`,
          icon: 'warn',
          okText: t('seatRemoveGo', 'إزالة'),
          cancelText: t('cancel', 'إلغاء'),
          danger: true
        });
        if (!ok) return;
        try {
          const { doc, updateDoc, arrayRemove } = await import(
            'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js');
          await updateDoc(doc(db, 'matchmaking', currentRoomId || mode), {
            players: arrayRemove(displayedPlayers.find(p => p.id === pid) || { id: pid })
          });
          notify(t('seatRemoved', 'تمت إزالة اللاعب من التحدي'), 'success');
        } catch (err) {
          console.warn('[lobby] seat remove:', err);
        }
      };
    });
  };

  renderSeats();

  // ⏲️ عدّاد التجهيز — v24: الساعة الموحدة (لحظة إنشاء الغرفة من السيرفر)
  //    فيكون وقت الجولة واحدًا لكل اللاعبين لا تقدمًا لأحدهم
  const timerEl = document.getElementById('wait-timer');
  const statusEl = document.getElementById('wait-status');
  const localStart = Date.now();
  let joinPhase = false;
  const computeLeftSec = () => {
    if (roomCreatedAtMs > 0) {
      const elapsed = Math.max(0, serverNow() - roomCreatedAtMs);
      return Math.max(0, Math.ceil((WAIT_TOTAL_MS - elapsed) / 1000));
    }
    return Math.max(0, Math.ceil((WAIT_TOTAL_MS - (Date.now() - localStart)) / 1000));
  };
  const interval = setInterval(() => {
    const left = computeLeftSec();
    if (timerEl) timerEl.textContent = left;
    if (!joinPhase && left <= 5 && left > 0) {
      joinPhase = true;
      if (statusEl) {
        statusEl.textContent = t('joiningNow', 'جاري الانضمام...');
        statusEl.classList.add('hot');
      }
    }
    if (left <= 0) clearInterval(interval);
  }, 250);

  const cancelRound = () => {
    clearInterval(interval);
    // 🧹 حذف الجولة من قاعدة البيانات — وأي خطأ شبكة لا يمنع الإغلاق/الاسترجاع
    try { cancelMatchmaking(); } catch (e) { console.warn('[lobby] cancel:', e); }
    // ↩️ الجولة لم تبدأ — نُرجع علامة الدخول (v19)
    refundRoundBadge();
    refreshTopbar();
    notify(t('badgeRefunded', 'أُعيدت علامة الانتصار إلى رصيدك'), 'success', 'tokens');
    closeModal();
  };
  document.getElementById('btn-wait-cancel').onclick = cancelRound;
  document.getElementById('modal-x').onclick = cancelRound;
  document.getElementById('modal').onclick = () => {};

  /** 🚪 v24: عودتي للرئيسية — إما إلغاء منشئ الجولة أو إزالتي بعلامة ✕ */
  const backHomeWith = (reason) => {
    clearInterval(interval);
    refundRoundBadge();
    refreshTopbar();
    closeModal();
    if (reason === 'removed') {
      notify('🚪 ' + t('removedFromRound', 'تمت إزالتك من هذا التحدي'), 'warn');
    } else {
      notify('🚪 ' + t('cancelRoundMsg', 'تم إلغاء الجولة — عدت إلى الصفحة الرئيسية'), 'warn');
    }
  };

  startMatchmaking(
    mode,
    (msg, players, meta) => {
      // ⏱️ الساعة الموحدة + هوية الغرفة (زر ✕ + ترتيب المقاعد)
      if (meta?.createdAtMs) roomCreatedAtMs = meta.createdAtMs;
      if (meta?.roomId) currentRoomId = meta.roomId;
      // 👥 نعرض كل من في الغرفة — الانضمام يبدو طبيعيًا واحدًا تلو الآخر
      if (players && players.length) {
        displayedPlayers = players.slice(0, cap);
        // 🎯 المنشئ = صاحب أول مقعد في الغرفة (زر ✕ ظاهر له فقط)
        amCreator = displayedPlayers[0]?.id === me.id;
        renderSeats();
      }
    },
    (match) => {
      clearInterval(interval);
      closeModal();
      startGame(match);
    },
    { onRoomClosed: backHomeWith }
  );
}

/** 🛡️ تهريب نصوص الأسماء داخل HTML */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/** ➕ نافذة إنشاء غرفة — مُصدَّرة لتُفتح مباشرة من بطاقة الرئيسية (v16)
 *  🗑️ v17: لم تعد تُفتح من اللوبي — الإنشاء من الرئيسية فقط
 *  ✕ v19: حُذف زر «إلغاء» السفلي — الإغلاق بعلامة ✕ وحدها (طلب المستخدم) */
export function openCreateRoomModal() {
  openModal('➕ ' + t('createRoom'),
    `<label>${t('roomType')}:</label>
     <div class="mode-icons-row" style="margin-bottom:12px">
       <button class="mode-icon-btn active" data-cr-mode="1v1">
         <span class="mi-label">${t('modeSolo')}</span>
       </button>
       <button class="mode-icon-btn" data-cr-mode="2v2">
         <span class="mi-label">${t('modeDuo')}</span>
       </button>
       <button class="mode-icon-btn" data-cr-mode="4v4">
         <span class="mi-label">${t('modeQuad')}</span>
       </button>
     </div>
     <label>${t('roomCode')} (3–10):
       <input id="create-room-code" type="text" maxlength="10" style="text-transform:uppercase" />
     </label>`,
    `<button class="btn btn-primary" id="modal-ok">${t('create')}</button>`
  );

  let chosenMode = '1v1';
  document.querySelectorAll('[data-cr-mode]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('[data-cr-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      chosenMode = btn.dataset.crMode;
    };
  });

  document.getElementById('modal-ok').onclick = async () => {
    const code = document.getElementById('create-room-code').value.trim();
    const res = await createCustomRoom(chosenMode, code);
    if (!res.ok) { notify(res.msg); return; }
    closeModal();
    openRoomPlayersModal(res.room);
  };
}

/** 🔍 نافذة الانضمام لغرفة — ✕ v19: بلا زر إلغاء سفلي (الإغلاق بعلامة ✕) */
function openJoinRoomModal() {
  openModal('🔍 ' + t('joinRoom'),
    `<label>${t('roomCode')}:
       <input id="join-room-code" type="text" maxlength="10" style="text-transform:uppercase" />
     </label>`,
    `<button class="btn btn-primary" id="modal-ok">${t('join')}</button>`
  );
  document.getElementById('modal-ok').onclick = async () => {
    const code = document.getElementById('join-room-code').value.trim();
    const res = await joinCustomRoom(code);
    if (!res.ok) { notify(res.msg); return; }
    // 🏆 دخول غرفة = بدء جولة — بوابة العلامة أولًا (v19)
    const ok = await enterRoundWithBadge(async () => {
      const match = await buildMatchFromRoom(res.room);
      startGame(match);
    }, { skipSplash: true });
    if (ok) closeModal();
  };
}

function openRoomPlayersModal(room) {
  const me = getPlayer();
  const cap = room.capacity;
  const modeName = room.mode === '1v1' ? t('modeSolo') : room.mode === '2v2' ? t('modeDuo') : t('modeQuad');

  const renderSlots = (players) => {
    let html = '';
    for (let i = 0; i < cap; i++) {
      const p = players?.[i];
      if (p) {
        const isMe = p.id === me.id;
        html += `
          <div class="room-slot ${isMe ? 'owner' : ''}">
            <div class="slot-avatar">${getFlag(p.country)}</div>
            <div class="slot-name">${p.name} ${isMe ? t('youTag') : ''}</div>
          </div>`;
      } else {
        html += `
          <div class="room-slot">
            <div class="slot-avatar">➕</div>
            <div class="slot-name" style="color:var(--muted)">${t('emptySeat')}</div>
            <button class="slot-add" data-invite="${i}">${t('invite')}</button>
          </div>`;
      }
    }
    return html;
  };

  const bodyHTML = `
    <div class="waiting-modal">
      <p style="color:var(--muted);font-size:13px">${t('roomType')}: ${modeName} — ${t('roomCode')}: <b style="color:var(--primary)">${room.code}</b></p>
      <div class="waiting-players" id="room-players">
        ${renderSlots(room.players)}
      </div>
      <div class="waiting-actions">
        <button class="btn btn-primary" id="btn-room-start">▶️ ${t('startRound')}</button>
      </div>
    </div>
  `;

  openModal('👥 ' + t('roomPlayers'), bodyHTML, '');

  document.getElementById('room-players').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-invite]');
    if (!btn) return;
    const friends = getFriends();
    if (!friends.length) {
      notify(t('noFriendsYet'), 'warn');
      return;
    }

    // 🪟 منتقي عصري بدل prompt() التقليدي — زر لكل صديق
    const picked = await modernDialog({
      title: '👥 ' + t('invitePickTitle', 'استدعاء صديق للغرفة'),
      icon: 'info',
      buttons: [
        ...friends.slice(0, 8).map((f, i) => ({
          label: `${getFlag(f.country)} ${f.name}`,
          value: f,
          cls: 'primary'
        })),
        { label: t('cancel', 'إلغاء'), value: null, cls: 'ghost' }
      ]
    });
    if (!picked) return;
    const friend = picked;

    const { db } = await import('../firebase-config.js');
    const { doc, getDoc, updateDoc } = await import(
      'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js'
    );
    const ref = doc(db, 'rooms', 'custom_' + room.code);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const data = snap.data();
    const newPlayers = [...data.players, {
      id: 'friend_' + friend.name.toLowerCase(),
      name: friend.name,
      country: friend.country,
      isBot: false,
      joinedAt: Date.now()
    }];
    await updateDoc(ref, { players: newPlayers });
    room.players = newPlayers;
    document.getElementById('room-players').innerHTML = renderSlots(newPlayers);
  });

  // ✕ v19: بلا زر إلغاء سفلي — الإغلاق بعلامة ✕ وحدها، والبدء يستهلك علامة
  document.getElementById('btn-room-start').onclick = async () => {
    // 🏆 بدء جولة الغرفة = استقطاع علامة انتصار أولًا (v19)
    const ok = await enterRoundWithBadge(async () => {
      closeModal();
      const match = await buildMatchFromRoom(room);
      startGame(match);
    });
  };
}

/* ==========================================================
 * ↩️ استئناف جولة قائمة — أُلغي نهائيًا (v8)
 * الانسحاب من جولة بدأت = خسارة نهائية بلا عودة (انظر presence.js)
 * ========================================================== */

/* ==========================================================
 * 🏆 اقتصاد علامات الانتصار — بوابة دخول الجولة (v19 — طلب المستخدم)
 *  • لا يمكن بدء جولة دون علامة انتصار واحدة على الأقل
 *  • عند الدخول تُخصم علامة وتظهر شاشة تفاعلية
 *    «تم استقطاع علامة انتصار واحدة»
 *  • عند نفاد العلامات: لوحة «شاهد إعلانًا للحصول على محاولة
 *    لعب واحدة» — المشاهدة تمنح +1 وتبدأ الجولة مباشرة
 * ========================================================== */

/**
 * 🚪 بوابة دخول الجولة الموحدة — تُستدعى قبل كل بدء جولة:
 * @param {Function} proceed ما يُنفذ بعد نجاح البوابة (فتح التجهيز/بدء اللعب)
 * @param {{skipSplash?:boolean}} opts انضمام غرفة جاهزة = بلا شاشة الانتظار
 * @returns {Promise<boolean>} هل تم الدخول؟
 */
export async function enterRoundWithBadge(proceed, opts = {}) {
  // 🚫 لا علامات؟ لوحة الإعلان للمحاولة الواحدة (طلب المستخدم)
  if (!hasPlayBadge()) {
    const granted = await openBadgeRefillPanel();
    if (!granted) return false;
    // 🎬 المحاولة الممنوحة تُستهلك فورًا كعلامة دخول —
    //    إعلان واحد = جولة واحدة بالضبط (محاولة لعب واحدة)
  }

  // 🎟️ استقطاع علامة الانتصار + الشاشة التفاعلية
  const spent = spendRoundBadge();
  if (!spent.ok) { notify(t('needOneBadge', 'تحتاج علامة انتصار واحدة على الأقل لبدء الجولة'), 'warn'); return false; }
  refreshTopbar();
  if (!opts.skipSplash) await _showBadgeDeductSplash(spent.tokens);

  try { proceed(); } catch (e) { console.warn('[badge-gate]', e); }
  return true;
}

/**
 * 🖥️ الشاشة التفاعلية: «تم استقطاع علامة انتصار واحدة» —
 * تظهر لحظة دخول الجولة ثم تنطفئ تلقائيًا (~2.1 ثانية)
 */
function _showBadgeDeductSplash(remaining) {
  return new Promise((resolve) => {
    document.getElementById('badge-splash')?.remove();
    const ov = document.createElement('div');
    ov.id = 'badge-splash';
    ov.innerHTML = `
      <div class="bs-card">
        <div class="bs-ring"><span class="bs-ico">${icon('tokens')}</span></div>
        <div class="bs-title">${t('badgeDeductTitle', 'تم استقطاع علامة انتصار واحدة')}</div>
        <div class="bs-sub">${t('badgeDeductSub', 'باقي في رصيدك')}: <b>${remaining}</b> ${t('badgeTokensWord', 'علامات انتصار')}</div>
      </div>`;
    document.body.appendChild(ov);
    setTimeout(() => {
      ov.classList.add('bye');
      setTimeout(() => { ov.remove(); resolve(); }, 380);
    }, 1900);
  });
}

/**
 * 🎬 لوحة النفاد: «شاهد إعلانًا للحصول على محاولة لعب واحدة» —
 * تعيد true إذا شاهد الإعلان وحصل على المحاولة (ويُكمل الدخول تلقائيًا)
 */
function openBadgeRefillPanel() {
  return new Promise((resolve) => {
    openModal(t('badgePanelTitle', 'نفدت علامات الانتصار!'), `
      <div class="badge-refill">
        <div class="br-orb">
          <span class="br-ico">${icon('video')}</span>
          <span class="br-orb-glow"></span>
        </div>
        <p class="br-desc">${t('badgePanelDesc', 'لا يمكنك بدء جولة دون علامة انتصار — شاهد فيديو قصيرًا للحصول على محاولة لعب واحدة الآن.')}</p>
        <button class="btn btn-glow-success br-watch" id="btn-badge-ad">
          <span class="br-btn-vid">${icon('video')}</span>
          ${t('badgeAdBtn', 'شاهد الإعلان واحصل على محاولة')}
        </button>
      </div>`, '');

    document.getElementById('btn-badge-ad').onclick = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.innerHTML = '⏳ ' + t('loading', 'جاري التحميل...');

      const watched = await playAd('extra');   // 🎬 إعلان محاولة لعب واحدة
      if (!watched) {
        btn.disabled = false;
        btn.innerHTML = `<span class="br-btn-vid">${icon('video')}</span> ${t('badgeAdBtn', 'شاهد الإعلان واحصل على محاولة')}`;
        resolve(false);
        return;
      }

      grantExtraPlayAttempt();       // 🏆 +1 محاولة لعب
      refreshTopbar();
      notify('🏆 ' + t('badgeGotOne', 'حصلت على محاولة لعب واحدة ✓'), 'success');
      resolve(true);
    };
  });
}
