// ui/bag.js — v19
// ============================================================
// 🎒 حقيبتي — نافذة تعرض ممتلكات اللاعب:
//   الأرصدة + 🏆 جوائزي (المستلمة من متجر الجوائز — تختفي بعد
//   30 يومًا، والضغط عليها يعرض بيانات استلام الجائزة) +
//   شخصياتي + أدواتي.
//
//   🗑️ (v15): حُذف قسم "آخر المكافآت" — الحقيبة ممتلكات فقط.
//   🏆 (v19 طلب المستخدم): الجائزة المستلمة تُجد داخل الحقيبة،
//      والضغط عليها يعرض رسالة ببيانات استلام الجائزة.
// ============================================================

import { getPlayer } from '../auth.js';
import { getStoreItems } from '../store-catalog.js';
import { openModal } from './modal.js';
import { intelIcon } from './helpers.js';
import { hydrateIcons, icon } from './icons.js';
import { t } from '../i18n.js';
import { bagPrizes, PRIZE_BAG_MS } from '../game/awards.js';
import { openPrizeClaimData } from './prizeStore.js';
import { equipCharacter } from '../store.js';
import { refreshTopbar } from './topbar.js';
import { notify } from './helpers.js';
import { markBagSeen } from './badges.js';

const _esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** اسم أداة من معرفها (من كتالوج الإدارة أو أسماء الأدوات المدمجة) */
function toolName(id) {
  const item = getStoreItems('boosters').find(b => b.id === id);
  if (item) return typeof item.name === 'string' ? item.name : (item.name?.ar || id);
  const map = {
    skip: t('toolSkip', 'تخطي'), swap: t('toolSwap', 'تبديل'),
    freeze: t('toolFreeze', 'تجميد'), fifty: 'حذف خيارين (50:50)', rename: t('toolRename', 'تغيير الاسم')
  };
  return map[id] || id;
}

/** 🖼️ وسيط الأداة: أيقونة PNG من الإدارة إن وُجدت وإلا أيقونة اللعبة.
 *  🎨 v29 (طلب المستخدم): كانت الأدوات تُرسم إيموجي ثابت ⏭️🔄❄️✂️✏️
 *  غير قابل للتغيير — الآن كلها من نظام الأيقونات القابل للتعديل
 *  من قسم الأيقونات في لوحة الإدارة */
function toolMedia(id) {
  const item = getStoreItems('boosters').find(b => b.id === id);
  if (item?.image) {
    return `<img class="bg-item-img" src="${_esc(item.image)}" alt="" draggable="false">`;
  }
  const icoMap = { skip: 'skip2', swap: 'swap', freeze: 'freeze', fifty: 'fifty', rename: 'pen' };
  if (icoMap[id]) return `<span class="bg-item-emoji">${icon(icoMap[id])}</span>`;
  return `<span class="bg-item-emoji">${_esc(item?.emoji || '🧰')}</span>`;
}

/** 🚀 فتح نافذة حقيبتي */
export function openMyBag() {
  // 🔴 v30 (طلب المستخدم): فتح الحقيبة يخفي لافتة «جديد» —
  //    اللاعب شاهد محتوياتها الآن
  try { markBagSeen(); } catch {}

  const p = getPlayer() || {};

  /* --- 🏆 جوائزي (المستلمة — تختفي بعد 30 يومًا) --- */
  const prizes = bagPrizes();
  const prizesHTML = prizes.length ? prizes.map(z => {
    const daysLeft = Math.max(0, Math.ceil(((z.expireAt || (z.collectedAt + PRIZE_BAG_MS)) - Date.now()) / 86400000));
    const media = z.awardImage
      ? `<img class="bg-item-img" src="${_esc(z.awardImage)}" alt="" draggable="false">`
      : `<span class="bg-item-emoji">🏆</span>`;
    return `
      <button class="bag-item prize" data-prize="${_esc(z.id)}" title="${t('prizeClaimData', 'بيانات استلام الجائزة')}">
        <div class="bi-media">${media}</div>
        <div class="bi-name">${_esc(z.awardName || '')}</div>
        <div class="bi-tag warn">⏳ ${daysLeft} ${t('days', 'يوماً')}</div>
      </button>`;
  }).join('') : `<p class="bag-empty">${t('noBagPrizes', 'لا جوائز مستلمة بعد — استلم جائزتك من متجر الجوائز')}</p>`;

  /* --- 👤 شخصياتي (الموحدة: character + avatar القديم) --- */
  const ownedIds = new Set([...(p.ownedCharacters || []), ...(p.ownedAvatars || [])]);
  const myChars = getStoreItems('characters').filter(c => ownedIds.has(c.id));
  const charsHTML = myChars.length ? myChars.map(c => {
    const equipped = p.equippedCharacter === c.id || p.equippedAvatar === c.id;
    const media = c.image
      ? `<img class="bg-item-img" src="${_esc(c.image)}" alt="" draggable="false">`
      : `<span class="bg-item-emoji">${_esc(c.emoji || '✨')}</span>`;
    // 🖼️ v24 (طلب المستخدم): الضغط على صورة الشخصية في الحقيبة = تجهيزها
    return `
      <div class="bag-item ${equipped ? 'equipped' : ''}" ${equipped ? '' : `data-equip-char="${_esc(c.id)}"`}
           ${equipped ? '' : `title="${t('equip', 'تجهيز')}"`}> 
        <div class="bi-media">${media}</div>
        <div class="bi-name">${_esc(typeof c.name === 'string' ? c.name : (c.name?.ar || ''))}</div>
        ${equipped ? `<div class="bi-tag">${t('equippedTag', 'مجهزة')}</div>` : `<button class="bag-equip-btn" type="button">${t('equip', 'تجهيز')}</button>`}
      </div>`;
  }).join('') : `<p class="bag-empty">${t('noCharactersYet', 'لا شخصيات بعد — اشترِ من المتجر')}</p>`;

  /* --- 🧰 أدواتي (بأيقوناتها — PNG من الإدارة إن وُجدت) --- */
  const stock = p.boosters || {};
  const toolIds = Object.keys(stock).filter(id => (stock[id] || 0) > 0);
  const toolsHTML = toolIds.length ? toolIds.map(id => `
    <div class="bag-item tool">
      <div class="bi-media">${toolMedia(id)}</div>
      <div class="bi-name">${_esc(toolName(id))}</div>
      <div class="bi-tag">× ${stock[id]}</div>
    </div>`).join('') : `<p class="bag-empty">${t('noToolsYet', 'لا أدوات مساعدة بعد — اشترِ من المتجر')}</p>`;

  openModal('🎒 ' + t('myBag', 'حقيبتي'), `
    <div class="my-bag">

      <div class="bag-balances">
        <div class="bb-chip gems"><span class="pill-ico" data-ico="gems"></span><b>${p.gems || 0}</b></div>
        <div class="bb-chip tokens"><span class="pill-ico" data-ico="tokens"></span><b>${p.tokens || 0}</b></div>
        <div class="bb-chip intel">${intelIcon()} <b>${p.intel || 0}</b></div>
      </div>

      <h4 class="bag-sec-title">${t('bagPrizesMine', 'جوائزي')} (${prizes.length})</h4>
      <div class="bag-grid">${prizesHTML}</div>

      <h4 class="bag-sec-title">${t('bagCharacters', 'شخصياتي')} (${myChars.length})</h4>
      <div class="bag-grid">${charsHTML}</div>

      <h4 class="bag-sec-title">${t('bagTools', 'أدواتي المساعدة')}</h4>
      <div class="bag-grid">${toolsHTML}</div>
    </div>`, '');

  // 📋 الضغط على جائزة → رسالة ببيانات استلام الجائزة
  document.querySelectorAll('[data-prize]').forEach(btn => {
    btn.onclick = () => {
      const z = bagPrizes().find(x => x.id === btn.dataset.prize);
      if (z) openPrizeClaimData(z);
    };
  });

  document.querySelectorAll('[data-equip-char]').forEach(el => {
    el.onclick = () => {
      const res = equipCharacter(el.dataset.equipChar);
      if (!res.ok) {
        notify(res.msg || t('error', 'حدث خطأ'), 'error');
        return;
      }
      notify(t('characterEquipped', 'تم تجهيز الشخصية'), 'success');
      refreshTopbar();
      openMyBag();
    };
  });

  hydrateIcons(document.getElementById('modal-body'));
}
