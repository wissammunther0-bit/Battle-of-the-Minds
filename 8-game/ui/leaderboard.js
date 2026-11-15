// ui/leaderboard.js
// ============================================================
// 🏆 قائمة أعلى 100 لاعب — v23 حقيقية:
//   الحقيقيون والافتراضيون مرتبين بالمستوى، وكل صف يعرض:
//   الصورة · الاسم · المستوى · نسبة الذكاء · الفوز · الخسارة
//   الضغط على أي اسم يفتح الملف الشخصي + إضافة/إلغاء صداقة.
// ============================================================

import { getPlayer } from '../auth.js';
import { fetchLeaderboard } from '../game/leaderboard.js';
import { getFlag } from './helpers.js';
import { openPlayerProfile } from './profileCard.js';
import { skeletonRows } from './skeleton.js';
import { getProfilePicture, getCharacterItemById } from '../store-catalog.js';
import { icon } from './icons.js';
import { t } from '../i18n.js';

const CACHE_KEY = 'ba_cache_leaderboard_v1';

let _liveTimer = null;   // 🔴 مؤقت التحديث اللحظي (v24)

const _esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** صورة اللاعب: الشخصية المجهزة وإلا علم الدولة */
function avatarOf(e) {
  const item = getCharacterItemById(e.equippedCharacter)
    || getCharacterItemById(e.equippedAvatar);
  if (item?.image) return `<img class="lb-av" src="${_esc(item.image)}" alt="" draggable="false">`;
  if (item?.emoji) return `<span class="lb-av">${_esc(item.emoji)}</span>`;
  return `<span class="lb-av lb-av-flag">${getFlag(e.country)}</span>`;
}

function renderEntries(box, entries) {
  const me = getPlayer();
  box.innerHTML = entries.map((e, i) => {
    const rank = i + 1;
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
    const mine = e.uid === me?.id;
    const top3 = rank <= 3 ? ' top3' : '';
    // 🧠 v24 (طلب المستخدم): أيقونة ذكاء احترافية بدل السمايل،
    //    ومؤشر قياس احترافي بدل الساعة الرملية
    const iq = e.intelligence != null
      ? `<span class="lb-iq" title="${t('intelPercent', 'نسبة الذكاء')}">${icon('intel')} ${e.intelligence}%</span>`
      : `<span class="lb-iq waiting" title="${t('intelTestingTitle', 'نسبة الذكاء قيد القياس')}">${icon('loader')}</span>`;
    return `
      <div class="lb-row${top3}${mine ? ' me' : ''}">
        <div class="lb-rank">${medal}</div>
        ${avatarOf(e)}
        <button class="lb-name" data-uid="${_esc(e.uid)}"
                data-name="${_esc(e.name)}" data-country="${_esc(e.country)}"
                data-level="${Number(e.level) || 1}">
          <span class="lb-nm">${getFlag(e.country)} ${_esc(e.name)}</span>
          <span class="lb-sub">${t('lvl')} ${e.level}</span>
        </button>
        ${iq}
        <div class="lb-score" title="${t('wins')} / ${t('losses')}">
          <b class="w">${e.wins}</b><i>/</i><b class="l">${e.losses}</b>
        </div>
      </div>`;
  }).join('');

  box.querySelectorAll('.lb-name').forEach(btn => {
    btn.onclick = () => openPlayerProfile(btn.dataset.uid, {
      name: btn.dataset.name,
      country: btn.dataset.country,
      level: Number(btn.dataset.level) || 1
    });
  });
}

export async function initLeaderboard() {
  const box = document.getElementById('leaderboard-list');
  const myChip = document.getElementById('lb-my-rank');
  if (!box) return;

  // ⚡ 1) عرض فوري من الكاش المحلي
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch {}
  if (cached?.entries?.length) {
    renderEntries(box, cached.entries);
    if (myChip) {
      myChip.textContent = cached.myRank
        ? `${t('rank')}: #${cached.myRank}`
        : t('climbHint');
    }
  } else {
    box.innerHTML = skeletonRows(8);
  }

  // 2) جلب حي وتحديث
  const { entries, myRank } = await fetchLeaderboard();
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ entries, myRank })); } catch {}
  if (!box.isConnected) return;

  if (myChip) {
    myChip.textContent = myRank
      ? `${t('rank')}: #${myRank}`
      : t('climbHint');
  }

  if (!entries.length) {
    box.innerHTML = `<p class="friend-empty">${t('emptyList')}</p>`;
    return;
  }
  renderEntries(box, entries);

  // 🔴 v24 (طلب المستخدم): تحديث لحظي احترافي — القائمة تتجدد دوريًا
  //    طوال بقاء الشاشة مفتوحة (المستويات والنتائج تتغير مع كل جولة)
  // 🛠️ v37 — توفير القراءات: 15ث → 90ث + إيقاف عند إخفاء التبويب.
  //    كل تحديث يقرأ قائمة الصدارة من Firestore — الـ15ث كانت تحرق
  //    الحصة اليومية بسرعة (50 ألف قراءة) مع بقاء الشاشة مفتوحة
  if (_liveTimer) clearInterval(_liveTimer);
  _liveTimer = setInterval(async () => {
    if (!box.isConnected) { clearInterval(_liveTimer); _liveTimer = null; return; }
    if (document.hidden) return;               // 🆕 v37 — لا قراءات والتبويب مخفي
    try {
      const fresh = await fetchLeaderboard();
      if (!box.isConnected) return;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(fresh)); } catch {}
      if (fresh.entries.length) renderEntries(box, fresh.entries);
    } catch {}
  }, 90000);
}
