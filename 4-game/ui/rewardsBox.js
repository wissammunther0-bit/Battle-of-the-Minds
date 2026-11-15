// ui/rewardsBox.js — v14 (جديد)
// ============================================================
// 🎁 أيقونة صندوق المكافآت في الصفحة الرئيسية (طلب المستخدم):
//
//  • الصندوق لا يتوفر في كل لحظة — وقت الإتاحة يحدده المطور من
//    صفحة الأدمن (كل ساعة/نصف ساعة/ساعتين/…).
//  • عندما يُفعّل يبدأ بالاهتزاز ويظهر عليه علامة فيديو 🎬 —
//    "شاهد الفيديو لتحصل على مكافأة".
//  • المكافأة عشوائية — لا يعرفها اللاعب قبل المشاهدة، وبعد
//    مشاهدة الإعلان تظهر له ثم يبدأ عدّاد الوقت الذي حدده المطور.
//  • الإعلان حاليًا تجريبي (بيئة جاهزة للربط لاحقًا — طلب المستخدم).
// ============================================================

import {
  boxReadyAtMs, availabilityState, fmtRemaining, fmtCountdown,
  playAd, claimBoxReward
} from '../game/rewards.js';
import { getBoxConfig } from '../store-catalog.js';
import { openModal, closeModal } from './modal.js';
import { notify } from './helpers.js';
import { icon, hydrateIcons } from './icons.js';
import { t } from '../i18n.js';
import { refreshTopbar } from './topbar.js';

let _timer = null;
let _cooldownNotifyAt = 0;

/** 🚀 رسم صندوق المكافآت — يُستدعى من initMainMenu وعند تغيّر الإعدادات
 *  🎨 v16: لافتة أيقونة هدية ذهبية + نصوص + زر أحمر "افتح" في الطرف
 *  ⏱️ حين لا تكون المكافأة جاهزة يظهر عدّاد التفعيل داخل اللافتة
 *     مكان الزر — والاهتزاز فقط عندما تصبح جاهزة (طلب المستخدم) */
export function renderRewardsBox() {
  const mount = document.getElementById('box-mount');
  if (!mount) return;

  const cfg = getBoxConfig();
  const st = availabilityState(boxReadyAtMs());

  // 🎁 الحالات: معطّل (رمادي) / عدّاد / متاح (اهتزاز + 🎬 + زر أحمر)
  let stateCls, badge = '', subTxt = '', actionHTML = '';
  if (st.disabled) {
    stateCls = 'disabled';
    subTxt = t('boxDisabled', 'الصندوق معطّل حاليًا');
    actionHTML = `<span class="rbx-open-btn">${t('openAd', 'افتح')}</span>`;
  } else if (st.available) {
    stateCls = 'ready';
    badge = `<span class="rbx-video">${icon('video')}</span>`;
    subTxt = t('boxReady', 'شاهد فيديو قصير واحصل على مكافئة الصندوق اليومية');
    actionHTML = `<span class="rbx-open-btn">${t('openAd', 'افتح')}</span>`;
  } else {
    stateCls = 'waiting';
    subTxt = t('nextRewardIn', 'المكافأة القادمة بعد');
    actionHTML = `<span class="rbx-cd"><span class="rbx-cd-icon">${icon('clock')}</span><span class="rbx-cd-num">${fmtCountdown(st.remainingMs)}</span></span>`;
  }

  mount.innerHTML = `
    <button class="rbx-btn ${stateCls}" id="btn-reward-box" aria-label="${t('rewardsBox', 'صندوق المكافآت')}">
      ${badge}
      <span class="rbx-ico">${icon('gift')}</span>
      <span class="rbx-texts">
        <span class="rbx-label">${t('rewardsBox', 'صندوق المكافآت')}</span>
        <span class="rbx-sub">${subTxt}</span>
      </span>
      <span class="rbx-open">${actionHTML}</span>
    </button>`;

  const btn = document.getElementById('btn-reward-box');
  btn.onclick = onBoxClick;
}

/** 👆 الضغط على الصندوق */
async function onBoxClick() {
  const st = availabilityState(boxReadyAtMs());

  if (st.disabled) {
    notify(t('boxDisabled', 'الصندوق معطّل حاليًا'), 'warn');
    return;
  }

  if (!st.available) {
    // ⏱️ لا سبام إشعارات — مرة كل 4 ثوانٍ كحد أقصى
    const now = Date.now();
    if (now - _cooldownNotifyAt > 4000) {
      _cooldownNotifyAt = now;
      notify(`⏱️ ${t('boxNotReady', 'الصندوق غير متاح بعد')} — ${fmtRemaining(st.remainingMs)}`, 'warn');
    }
    return;
  }

  // 🎬 مشاهدة الإعلان أولًا — بيئة جاهزة للربط بالإعلانات الحقيقية
  const watched = await playAd('box');   // 🎬 إعلان فتح الصندوق
  if (!watched) return;

  const res = await claimBoxReward();
  if (!res.ok) {
    notify(res.msg || t('error', 'خطأ'), 'error');
    renderRewardsBox();
    return;
  }

  refreshTopbar();
  renderRewardsBox();
  _showRewardPopup(res.label);
}

/** 🎉 نافذة كشف المكافأة (عشوائية — تظهر بعد المشاهدة فقط)
 *  💎 جواهر / 🏆 علامات / 🧠 جوائز ذكاء / 🧰 أدوات — حسب قائمة الإدارة */
function _showRewardPopup(label) {
  openModal('🎁 ' + t('rewardGot', 'مبروك! حصلت على مكافأة'), `
    <div class="box-reveal">
      <div class="br-glow"></div>
      <div class="br-gems">${label || '🎁'}</div>
      <p class="br-hint">${t('rewardAddedHint', 'أُضيفت المكافأة إلى حسابك مباشرة — عدّاد المكافأة القادمة بدأ الآن')}</p>
    </div>`, '');
}

/** ⏲️ مؤقت تحديث العدّاد كل ثانية (يعمل فقط والرئيسية ظاهرة) */
export function startBoxTicker() {
  stopBoxTicker();
  _timer = setInterval(() => {
    const view = document.getElementById('view-main');
    if (!view || !view.classList.contains('active')) return;
    const st = availabilityState(boxReadyAtMs());
    const btn = document.getElementById('btn-reward-box');
    if (!btn) { renderRewardsBox(); return; }
    if (st.available && btn.classList.contains('waiting')) renderRewardsBox();
    else if (!st.available && btn.classList.contains('waiting')) {
      const tEl = btn.querySelector('.rbx-cd-num');
      if (tEl) tEl.textContent = fmtCountdown(st.remainingMs);
    }
  }, 1000);
}

export function stopBoxTicker() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
