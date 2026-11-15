// ui/friends.js — 👥 الأصدقاء الحقيقيون (Firestore)
//
//  - البحث يجلب لاعبين حقيقيين من دليل players
//  - الطلبات الواردة عبر المستمع العالمي (ui/badges.js) — تفتح
//    الشاشة معبأة فورًا + جلب احتياطي لمرة واحدة ضد أي تأخير
//  - الطلبات المرسلة تعرض حالتها (معلقة/مقبولة/مرفوضة)
//  - 🤖 طلبات البوتات تُرفض آليًا بعد دقيقتين (ماسح دوري)
//  - الضغط على أي اسم يفتح الملف الشخصي
//  - 💀 skeletons بدل نصوص "جاري التحميل..."

import {
  searchPlayers, sendFriendRequest, getFriendsList, removeFriend,
  getSentRequests, friendshipStatusEx,
  acceptFriendRequest, rejectFriendRequest, cancelSentRequest,
  sweepBotFriendRequests, getIncomingRequestsOnce
} from '../game/social.js';
import { onIncomingChange, getIncomingSnapshot, isIncomingLoaded } from './badges.js';
import { getFlag, confirmDialog, notify } from './helpers.js';
import { openPlayerProfile } from './profileCard.js';
import { skeletonRows } from './skeleton.js';
import { t } from '../i18n.js';

let _unsubIncoming = null;
let _sweepTimer = null;
let _liveTimer = null;   // 🔴 تحديث لحظي دوري للقوائم (طلب المستخدم v24)
let _incoming = [];

const _esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export function initFriends() {
  const searchInput = document.getElementById('friend-search-input');
  const resultsBox = document.getElementById('friend-search-results');
  if (searchInput) searchInput.value = '';
  if (resultsBox) resultsBox.innerHTML = '';

  // 💀 هياكل فورية لكل القوائم — صفر نصوص انتظار
  document.getElementById('friend-requests').innerHTML = skeletonRows(2);
  document.getElementById('friend-sent').innerHTML = skeletonRows(2);
  document.getElementById('friend-list').innerHTML = skeletonRows(3);

  const doSearch = async () => {
    const q = searchInput?.value || '';
    if (!q || q.trim().length < 2) {
      resultsBox.innerHTML = `<p class="friend-empty">${t('searchHint')}</p>`;
      return;
    }
    resultsBox.innerHTML = skeletonRows(2);
    const results = await searchPlayers(q);
    if (!results.length) {
      resultsBox.innerHTML = `<p class="friend-empty">${t('noResultsHint')}</p>`;
      return;
    }
    // 🩺 v24 (إصلاح طلب المستخدم): حالة العلاقة تُجلب لكل نتيجة —
    //    صديق 🤝 / طلبي معلّق ⏳ / هو أرسل لي 📩 / ➕ إضافة فقط عند لا علاقة
    //    (كان زر ➕ يظهر لعيب علامة تعجب حتى مع الصديق أو الطلب المعلق)
    const withState = await Promise.all(results.map(async r => ({
      ...r,
      rel: await friendshipStatusEx(r.uid).catch(() => ({ status: 'none', request: null }))
    })));
    resultsBox.innerHTML = withState.map(r => {
      let action;
      if (r.rel.status === 'friends') {
        action = `<button class="btn btn-ghost small" disabled title="${t('alreadyFriends', 'صديقان بالفعل')}">🤝 ${t('alreadyFriends', 'صديقان بالفعل')}</button>`;
      } else if (r.rel.status === 'pending_sent') {
        action = `<button class="btn btn-ghost small" disabled title="${t('requestPending', 'طلبك معلّق حتى الموافقة')}">⏳ ${t('pendingTag', 'معلق')}</button>`;
      } else if (r.rel.status === 'pending_received') {
        action = `<button class="btn btn-success small" data-accept-search="${_esc(r.rel.request.id)}">📩 ${t('acceptReq', 'قبول')}</button>`;
      } else {
        action = `<button class="btn btn-primary small" data-send="${_esc(r.uid)}"
                data-name="${_esc(r.name)}" data-country="${_esc(r.country)}">➕ ${t('addFriend')}</button>`;
      }
      return `
      <div class="friend-item">
        <button class="info as-name" data-uid="${_esc(r.uid)}"
                data-name="${_esc(r.name)}" data-country="${_esc(r.country)}">
          <span>${getFlag(r.country)}</span>
          <span>${_esc(r.name)}</span>
          <span class="fr-lvl">${t('lvl')} ${r.level || 1}</span>
        </button>
        <div class="actions">${action}</div>
      </div>`;
    }).join('');
    bindResults(resultsBox);
  };

  const bindResults = (box) => {
    box.querySelectorAll('[data-send]').forEach(btn => {
      btn.onclick = async () => {
        btn.disabled = true;
        const res = await sendFriendRequest({
          uid: btn.dataset.send,
          name: btn.dataset.name,
          country: btn.dataset.country
        });
        if (res.ok) {
          // ✈️ v24: سهم مُرسل + إشعار واضح (نفس شاشة النهاية)
          btn.classList.add('sent');
          btn.innerHTML = '✈️';
          notify(`✈️ ${t('friendReqSentTo', 'أرسلت طلب إضافة إلى')} (${btn.dataset.name})`, 'success');
        } else {
          btn.innerHTML = '⚠️';
          btn.disabled = false;
        }
      };
    });
    box.querySelectorAll('[data-accept-search]').forEach(btn => {
      btn.onclick = async () => {
        btn.disabled = true;
        btn.innerHTML = '⏳';
        const req = await _getRequestById(btn.dataset.acceptSearch);
        if (req) await acceptFriendRequest(req);
        doSearch();
        renderFriendsList();
      };
    });
    box.querySelectorAll('.as-name').forEach(btn => {
      btn.onclick = () => openPlayerProfile(btn.dataset.uid, {
        name: btn.dataset.name, country: btn.dataset.country
      });
    });
  };

  /** 📩 جلب وثيقة طلب بالمعرف (لزر القبول في نتائج البحث) */
  async function _getRequestById(id) {
    try {
      const { doc, getDoc } = await import(
        'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js');
      const { db } = await import('../firebase-config.js');
      const snap = await getDoc(doc(db, 'friendRequests', id));
      return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    } catch { return null; }
  }

  const searchBtn = document.getElementById('btn-friend-search');
  if (searchBtn) searchBtn.onclick = doSearch;
  if (searchInput) {
    searchInput.onkeydown = (e) => { if (e.key === 'Enter') doSearch(); };
  }

  /* --- 📩 الطلبات الواردة: المستمع العالمي (يبدأ من إقلاع التطبيق) ---
     إذا كانت بياناته غير جاهزة بعد → جلب احتياطي فوري مرة واحدة */
  _incoming = getIncomingSnapshot();
  renderIncoming();

  if (_unsubIncoming) { try { _unsubIncoming(); } catch {} _unsubIncoming = null; }
  _unsubIncoming = onIncomingChange((reqs) => {
    _incoming = reqs || [];
    renderIncoming();
  });

  if (!isIncomingLoaded()) {
    getIncomingRequestsOnce().then(reqs => {
      if (reqs.length && !_incoming.length) {
        _incoming = reqs;
        renderIncoming();
      }
    });
  }

  renderSent();
  renderFriendsList();

  // 🤖 ماسح رفض طلبات البوتات (دوري)
  sweepBotFriendRequests().catch(() => {});
  if (_sweepTimer) clearInterval(_sweepTimer);
  _sweepTimer = setInterval(() => {
    sweepBotFriendRequests().catch(() => {});
    renderSent();
  }, 10000);

  // 🔴 v24 (طلب المستخدم): تحديث لحظي احترافي — قائمة الأصدقاء
  //    والطلبات المرسلة تتجدد دوريًا أثناء بقاء الشاشة مفتوحة
  if (_liveTimer) clearInterval(_liveTimer);
  _liveTimer = setInterval(() => {
    renderSent().catch(() => {});
    renderFriendsList().catch(() => {});
  }, 12000);
  document.addEventListener('viewchange', function onFriendsLeave(e) {
    if (e.detail !== 'friends') {
      if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null; }
      document.removeEventListener('viewchange', onFriendsLeave);
    }
  });
}

async function renderIncoming() {
  const box = document.getElementById('friend-requests');
  if (!box) return;
  const reqs = _incoming;
  if (!reqs.length) {
    box.innerHTML = `<p class="friend-empty">${t('noIncoming')}</p>`;
    return;
  }
  box.innerHTML = reqs.map(r => `
    <div class="friend-item incoming">
      <button class="info as-name" data-uid="${_esc(r.from)}"
              data-name="${_esc(r.fromName)}" data-country="${_esc(r.fromCountry)}">
        <span>${getFlag(r.fromCountry)}</span>
        <span>${_esc(r.fromName)}</span>
        <span class="fr-lvl">${t('lvl')} ${r.fromLevel || 1}</span>
      </button>
      <div class="actions">
        <button class="btn btn-success small" data-accept="${_esc(r.id)}">✅ ${t('acceptReq')}</button>
        <button class="btn btn-ghost small" data-reject="${_esc(r.id)}">✖️ ${t('rejectReq')}</button>
      </div>
    </div>`).join('');

  box.querySelectorAll('[data-accept]').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      const req = _incoming.find(x => x.id === btn.dataset.accept);
      if (req) {
        btn.innerHTML = '⏳';
        await acceptFriendRequest(req);
      }
      _incoming = _incoming.filter(x => x.id !== btn.dataset.accept);
      renderIncoming();
      renderFriendsList();
    };
  });
  box.querySelectorAll('[data-reject]').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      await rejectFriendRequest(btn.dataset.reject);
      _incoming = _incoming.filter(x => x.id !== btn.dataset.reject);
      renderIncoming();
    };
  });
  box.querySelectorAll('.as-name').forEach(btn => {
    btn.onclick = () => openPlayerProfile(btn.dataset.uid, {
      name: btn.dataset.name, country: btn.dataset.country
    });
  });
}

async function renderSent() {
  const box = document.getElementById('friend-sent');
  if (!box) return;
  const sent = await getSentRequests();
  const active = sent.filter(s => s.status === 'pending' || s.status === 'rejected');
  if (!active.length) {
    box.innerHTML = `<p class="friend-empty">${t('noSent')}</p>`;
    return;
  }
  box.innerHTML = active.map(s => {
    const badge = s.status === 'pending'
      ? `<span class="fr-badge pending">⏳ ${t('pendingTag', 'معلق')}</span>`
      : `<span class="fr-badge rejected">❌ ${t('rejectedTag', 'مرفوض')}</span>`;
    return `
      <div class="friend-item">
        <button class="info as-name" data-uid="${_esc(s.to)}"
                data-name="${_esc(s.toName)}" data-country="${_esc(s.toCountry)}">
          <span>${getFlag(s.toCountry)}</span>
          <span>${_esc(s.toName)}</span>
          ${badge}
        </button>
        <div class="actions">
          ${s.status === 'pending'
            ? `<button class="btn btn-ghost small" data-cancel="${_esc(s.id)}">إلغاء</button>`
            : ''}
        </div>
      </div>`;
  }).join('');

  box.querySelectorAll('[data-cancel]').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      await cancelSentRequest(btn.dataset.cancel);
      renderSent();
    };
  });
  box.querySelectorAll('.as-name').forEach(btn => {
    btn.onclick = () => openPlayerProfile(btn.dataset.uid, {
      name: btn.dataset.name, country: btn.dataset.country
    });
  });
}

async function renderFriendsList() {
  const listBox = document.getElementById('friend-list');
  if (!listBox) return;
  const friends = await getFriendsList();
  if (!friends.length) {
    listBox.innerHTML = `<p class="friend-empty">${t('noFriendsYet')}</p>`;
    return;
  }
  listBox.innerHTML = friends.map(f => `
    <div class="friend-item">
      <button class="info as-name" data-uid="${_esc(f.uid)}"
              data-name="${_esc(f.name)}" data-country="${_esc(f.country)}">
        <span>${getFlag(f.country)}</span>
        <span>${_esc(f.name)}</span>
        <span class="fr-lvl">${t('lvl')} ${f.level || 1}</span>
      </button>
      <div class="actions">
        <button class="btn btn-ghost small" data-remove="${_esc(f.uid)}" data-name="${_esc(f.name)}">${t('remove')}</button>
      </div>
    </div>`).join('');

  listBox.querySelectorAll('[data-remove]').forEach(btn => {
    btn.onclick = async () => {
      // 🎨 v24 (طلب المستخدم): نافذة تأكيد بتصميم اللعبة بدل رسالة
      //    المتصفح الافتراضية (confirm)
      const fname = btn.dataset.name || '';
      const ok = await confirmDialog({
        title: t('removeFriendTitle', 'إزالة صديق'),
        message: `${t('removeFriendQ', 'هل تريد إزالة هذا الصديق من قائمة أصدقائك؟')}${fname ? `<br><b>${_esc(fname)}</b>` : ''}`,
        icon: 'warn',
        okText: t('remove', 'إزالة'),
        cancelText: t('cancel', 'إلغاء'),
        danger: true
      });
      if (!ok) return;
      btn.disabled = true;
      await removeFriend(btn.dataset.remove);
      renderFriendsList();
    };
  });
  listBox.querySelectorAll('.as-name').forEach(btn => {
    btn.onclick = () => openPlayerProfile(btn.dataset.uid, {
      name: btn.dataset.name, country: btn.dataset.country
    });
  });
}
