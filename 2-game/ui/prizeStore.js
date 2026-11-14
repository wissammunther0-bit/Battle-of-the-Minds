// ui/prizeStore.js — v19 (جديد)
// ============================================================
// 🛒 متجر الجوائز في الصفحة الرئيسية — بلا نافذة (طلب المستخدم):
//
//  • الجوائز تظهر مباشرة في الرئيسية كبطاقات قابلة للنقر تفتح
//    تفاصيل المهام داخل البطاقة نفسها: كل شرط بجانبه مربع شفاف
//    يتفعل (✓) عند استيفاء الشرط.
//  • زر استلام الجائزة يظهر عندما تكتمل الشروط — ولا يعمل إلا
//    بعد مشاهدة إعلان (الإعلان شرط للاستلام — طلب المستخدم).
//  • عند الضغط على الاستلام: يُرسل الطلب إلى صفحة المطور،
//    ويظهر زر «استلام الجائزة» الشفاف التفاعلي ويظهر أسفله
//    عدّاد 96 ساعة — وعند انتهائه يتفعل الزر.
//  • الضغط على الزر المفعّل: شاشة تفاعلية «مبروك حصولك على
//    الجائزة» ثم الانتقال إلى نافذة حقيبتي ويُجد الجائزة هناك.
//  • الجائزة تظهر في الحقيبة ببيانات استلامها وتختفي بعد 30
//    يومًا — وتعود بطاقتها في المتجر بحالتها الأولى (نفس الشروط).
// ============================================================

import {
  loadAwards, evaluateAwardConditions,
  activeClaimFor, sendPrizeRequest, collectPrize, getPrizeClaims
} from '../game/awards.js';
import { openModal } from './modal.js';
import { notify, intelIcon } from './helpers.js';
import { icon, hydrateIcons } from './icons.js';
import { t } from '../i18n.js';
import { getPlayer } from '../auth.js';
import { playAd } from '../game/rewards.js';
import { openMyBag } from './bag.js';

const _esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

let _awards = [];
let _ticker = null;
const _open = new Set();        // 📂 البطاقات المفتوحة (الشروط ظاهرة)

/** ⏱️ تنسيق عدّاد 96 ساعة: 95س 59د 12ث */
function _fmt96(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${h}س ${pad(m)}د ${pad(sec)}ث`;
}

/* ==========================================================
 * 🚀 رسم متجر الجوائز داخل الصفحة الرئيسية
 * ========================================================== */
export async function renderPrizeStore() {
  const mount = document.getElementById('prize-store-mount');
  if (!mount) return;

  try { _awards = await loadAwards(); } catch { _awards = []; }
  const p = getPlayer() || {};
  const intel = p.intel || 0;

  if (!_awards.length) {
    mount.classList.add('hidden');
    mount.innerHTML = '';
    return;
  }
  mount.classList.remove('hidden');

  const cards = _awards.map(a => _cardHTML(a)).join('');

  mount.innerHTML = `
    <div class="pz-head">
      <span class="pzh-ico">${icon('cart')}</span>
      <span class="pzh-title">${t('awardsTitle', 'متجر الجوائز')}</span>
      <span class="pzh-balance">${intelIcon()} <b>${intel}</b> ${t('intelBalance', 'جوائز ذكاء')}</span>
    </div>
    <div class="pz-cards">${cards}</div>`;

  _bindEvents(mount);
  hydrateIcons(mount);
}

/* ==========================================================
 * 🃏 بطاقة جائزة واحدة
 * ========================================================== */
function _cardHTML(award) {
  const ev = evaluateAwardConditions(award);
  const claim = activeClaimFor(award.id);
  const price = ev.price;

  const media = award.image
    ? `<img class="pz-img" src="${_esc(award.image)}" alt="" draggable="false">`
    : `<span class="pz-gift">${icon('gift')}</span>`;

  /* --- منطقة الاستلام حسب الحالة --- */
  let claimHTML = '';
  if (claim) {
    const ready = Date.now() >= (claim.readyAt || 0);
    claimHTML = ready
      ? `
        <button class="pz-claim-btn ready" data-collect="${_esc(claim.id)}">
          ${t('prizeClaimBtn', 'استلام الجائزة')}
        </button>`
      : `
        <span class="pz-claim-btn ghost" aria-disabled="true">
          ${t('prizeClaimBtn', 'استلام الجائزة')}
        </span>
        <div class="pz-cd">${t('prizeReadyIn', 'الاستلام بعد')} <b data-cd="${_esc(claim.id)}">${_fmt96(claim.readyAt - Date.now())}</b></div>`;
  }

  const expanded = _open.has(award.id);

  return `
    <div class="pz-card ${claim ? 'pending' : ''}" data-award="${_esc(award.id)}">
      <button class="pz-top pz-trigger" type="button" data-toggle="${_esc(award.id)}"
              aria-expanded="${expanded}" aria-controls="pz-conds-${_esc(award.id)}">
        <span class="pz-media">${media}</span>
        <span class="pz-info">
          <span class="pz-name" title="${_esc(award.name)}">${_esc(award.name)}</span>
          <span class="pz-cta">${t('prizeTaskCta', 'أكمل المهمة واحصل على الجائزة')}</span>
        </span>
        <span class="pz-chevron ${expanded ? 'on' : ''}" aria-hidden="true">⌄</span>
      </button>

      <div class="pz-conds ${expanded ? '' : 'hidden'}" id="pz-conds-${_esc(award.id)}"
           data-conds="${_esc(award.id)}">
        ${(ev.conds || []).map(c => `
          <div class="pz-cond ${c.met ? 'met' : ''}">
            <span class="pz-box ${c.met ? 'on' : ''}">${c.met ? '✓' : ''}</span>
            <span class="pz-cond-txt">${_esc(c.label)}</span>
          </div>`).join('') || `
          <div class="pz-cond met">
            <span class="pz-box on">✓</span>
            <span class="pz-cond-txt">${t('noAwardConditions', 'لا شروط — يكفي رصيد جوائز الذكاء')}</span>
          </div>`}
        <div class="pz-cond ${ev.enoughIntel ? 'met' : ''}">
          <span class="pz-box ${ev.enoughIntel ? 'on' : ''}">${ev.enoughIntel ? '✓' : ''}</span>
          <span class="pz-cond-txt">${t('intelEnough', 'رصيد جوائز ذكاء كافٍ')}
            (${Math.min(ev.intel, price)}/${price})</span>
        </div>

        ${claim ? `
          <div class="pz-claim-zone">
            ${claimHTML}
            ${Date.now() >= (claim.readyAt || 0)
              ? `<p class="pz-hint ok">${t('prizeReadyHint', 'جهزت جائزتك — اضغط للاستلام الآن!')}</p>`
              : `<p class="pz-hint">${t('prizePendingHint', 'وصل طلبك إلى المطور ويجري تجهيز الجائزة')}</p>`}
          </div>`
        : ev.claimable ? `
          <div class="pz-claim-zone">
            <label class="pz-mail-label">${t('claimEmail', 'البريد الإلكتروني لاستلام الجائزة')}</label>
            <input class="pz-mail" data-mail="${_esc(award.id)}" type="email"
                   placeholder="name@email.com" value="${_esc(getPlayer()?.email || '')}">
            <button class="pz-claim-btn go" data-claim="${_esc(award.id)}">
              <span class="pz-vid">${icon('video')}</span>
              ${t('prizeClaimAd', 'شاهد إعلانًا واستلم الجائزة')}
            </button>
            <p class="pz-hint">${t('prizeAdHint', 'لا يمكن الاستلام إلا بعد مشاهدة إعلان — ثم يُرسل طلبك إلى المطور')}</p>
          </div>`
        : `
          <div class="pz-locked">🔒 ${t('claimLocked', 'أكمل الشروط أعلاه ليظهر زر التبادل')}</div>`}
      </div>
    </div>`;
}

/* ==========================================================
 * 👆 ربط الأحداث
 * ========================================================== */
function _bindEvents(mount) {
  /* 📂 الضغط على بطاقة الجائزة — يفتح/يغلق تفاصيل المهمة */
  mount.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.toggle;
      const panel = mount.querySelector(`[data-conds="${CSS.escape(id)}"]`);
      if (!panel) return;
      const willOpen = panel.classList.contains('hidden');
      panel.classList.toggle('hidden', !willOpen);
      btn.setAttribute('aria-expanded', String(willOpen));
      btn.querySelector('.pz-chevron')?.classList.toggle('on', willOpen);
      if (willOpen) _open.add(id); else _open.delete(id);
    };
  });

  /* 🎬 طلب الاستلام — الإعلان شرط قبله (طلب المستخدم) */
  mount.querySelectorAll('[data-claim]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.claim;
      const award = _awards.find(a => a.id === id);
      if (!award) return;

      const email = mount.querySelector(`[data-mail="${CSS.escape(id)}"]`)?.value?.trim() || '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        notify(t('prizeNeedEmail', 'أدخل بريدًا إلكترونيًا صحيحًا لاستلام الجائزة'), 'warn');
        return;
      }

      btn.disabled = true;
      btn.classList.add('busy');

      // 🎬 لا استلام دون مشاهدة الإعلان — ثم يُرسل الطلب للمطور
      const watched = await playAd('prize');   // 🎬 إعلان الحصول على جائزة
      if (!watched) {
        btn.disabled = false;
        btn.classList.remove('busy');
        return;
      }

      const res = await sendPrizeRequest(award, email);
      if (!res.ok) {
        notify(res.msg || t('error', 'خطأ'), 'error');
        btn.disabled = false;
        btn.classList.remove('busy');
        return;
      }

      notify('📨 ' + t('prizeRequestSent', 'تم إرسال طلب الجائزة إلى المطور ✓'), 'success');
      renderPrizeStore();
    };
  });

  /* 🎉 الاستلام النهائي بعد انتهاء عدّاد الـ96 ساعة */
  mount.querySelectorAll('[data-collect]').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      const res = collectPrize(btn.dataset.collect);
      if (!res.ok) { notify(res.msg || t('error', 'خطأ'), 'error'); btn.disabled = false; return; }
      _showCongrats(res.claim);
    };
  });
}

/* ==========================================================
 * 🎉 شاشة تفاعلية: مبروك حصولك على الجائزة → حقيبتي
 * ========================================================== */
function _showCongrats(claim) {
  document.getElementById('prize-congrats')?.remove();
  const ov = document.createElement('div');
  ov.id = 'prize-congrats';
  const media = claim?.awardImage
    ? `<img src="${_esc(claim.awardImage)}" alt="" draggable="false">`
    : `<span class="pc-gift">${icon('gift')}</span>`;
  ov.innerHTML = `
    <div class="pc-card">
      <div class="pc-burst"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="pc-media">${media}</div>
      <div class="pc-title">${t('prizeCongratsTitle', 'مبروك حصولك على الجائزة!')}</div>
      <div class="pc-name">${_esc(claim?.awardName || '')}</div>
      <div class="pc-sub">${t('prizeCongratsSub', 'جاري الانتقال إلى حقيبتك...')}</div>
    </div>`;
  document.body.appendChild(ov);

  setTimeout(() => {
    ov.classList.add('bye');
    setTimeout(() => {
      ov.remove();
      renderPrizeStore();
      openMyBag();               // 🎒 الانتقال إلى نافذة حقيبتي — والجائزة هناك
    }, 420);
  }, 2000);
}

/* ==========================================================
 * 📋 بيانات استلام الجائزة (تُعرض عند الضغط عليها في الحقيبة)
 * ========================================================== */
export function openPrizeClaimData(claim) {
  if (!claim) return;
  const fmt = (ts) => ts ? new Date(ts).toLocaleDateString(getLang_(), { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
  const daysLeft = Math.max(0, Math.ceil(((claim.expireAt || 0) - Date.now()) / 86400000));

  const media = claim.awardImage
    ? `<img class="pcd-img" src="${_esc(claim.awardImage)}" alt="" draggable="false">`
    : `<span class="pcd-gift">${icon('gift')}</span>`;

  openModal('🏆 ' + t('prizeClaimData', 'بيانات استلام الجائزة'), `
    <div class="prize-data">
      <div class="pcd-head">
        <div class="pcd-media">${media}</div>
        <div class="pcd-name">${_esc(claim.awardName || '')}</div>
      </div>
      <div class="pcd-rows">
        <div class="pcd-row"><span>${t('claimName', 'اسم اللاعب')}</span><b>${_esc(getPlayer()?.name || '')}</b></div>
        <div class="pcd-row"><span>${t('claimEmail', 'بريد الاستلام')}</span><b dir="ltr">${_esc(claim.email || '—')}</b></div>
        <div class="pcd-row"><span>${t('prizeReqDate', 'تاريخ الطلب')}</span><b>${fmt(claim.requestedAt)}</b></div>
        <div class="pcd-row"><span>${t('prizeGotDate', 'تاريخ الاستلام')}</span><b>${fmt(claim.collectedAt)}</b></div>
        <div class="pcd-row warn"><span>${t('prizeExpireIn', 'تختفي من الحقيبة بعد')}</span><b>${daysLeft} ${t('days', 'يوماً')}</b></div>
      </div>
    </div>`, '');
}

function getLang_() {
  try { return getPlayer()?.lang || 'ar'; } catch { return 'ar'; }
}

/* ==========================================================
 * ⏲️ مؤشر عدّادات الـ96 ساعة — كل ثانية والرئيسية ظاهرة
 * ========================================================== */
export function startPrizeTicker() {
  stopPrizeTicker();
  _ticker = setInterval(() => {
    const view = document.getElementById('view-main');
    if (!view || !view.classList.contains('active')) return;

    let needRender = false;
    document.querySelectorAll('[data-cd]').forEach(el => {
      const claim = getPrizeClaims().find(c => c.id === el.dataset.cd);
      if (!claim) { needRender = true; return; }
      const left = (claim.readyAt || 0) - Date.now();
      if (left <= 0) { needRender = true; return; }   // انتهى العد → تفعيل الزر
      el.textContent = _fmt96(left);
    });
    if (needRender) renderPrizeStore();
  }, 1000);
}

export function stopPrizeTicker() {
  if (_ticker) { clearInterval(_ticker); _ticker = null; }
}

/** 🔔 إعادة الرسم عند تغيّر الجوائز أو الاستلام (يُستمع له في mainMenu) */
export function bindPrizeStoreRefresh() {
  document.addEventListener('awards-changed', () => {
    if (document.getElementById('prize-store-mount')) renderPrizeStore();
  });
}
