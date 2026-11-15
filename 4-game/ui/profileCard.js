// ui/profileCard.js
// ============================================================
// 👤 بطاقة الملف الشخصي لأي لاعب (من السجل/المتصدرين/الأصدقاء)
//    — الإحصائيات + شريط التقدم + إضافة كصديق / قبول طلب وارد /
//      إلغاء الصداقة — البوتات تظهر بملفات كاملة كاللاعبين الحقيقيين
//    — 💀 skeleton بدل "جاري التحميل..."
// ============================================================

import { getPlayer } from '../auth.js';
import {
  getPlayerProfile, sendFriendRequest, friendshipStatusEx,
  acceptFriendRequest, removeFriend
} from '../game/social.js';
import { progressInLevel } from '../game/levels.js';
import { intelligenceOf } from '../game/virtualPlayers.js';
import { getFlag } from './helpers.js';
import { openModal, closeModal } from './modal.js';
import { skeletonCard } from './skeleton.js';
import { t } from '../i18n.js';
import { getProfilePicture } from '../store-catalog.js';

const _esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** صورة اللاعب: الشخصية المجهزة (= الأفاتار — v14) ← 🧩 الشخصية الافتراضية
 *  من لوحة الإدارة (v29 — تملأ الإطار كشخصيات المتجر) ← علم الدولة */
function avatarMedia(data) {
  const pic = getProfilePicture(data);
  if (pic?.image) return `<img src="${pic.image}" alt="" class="pcard-avatar-img">`;
  if (pic?.emoji) return pic.emoji;
  return getFlag(data.country);
}

/**
 * فتح بطاقة ملف لاعب
 * @param {string} uid معرف اللاعب (حقيقي أو بوت)
 * @param {object} preset بيانات معروفة مسبقًا (من السجل/القائمة) — احتياط
 */
export async function openPlayerProfile(uid, preset = {}) {
  if (!uid) return;
  // ✕ v19: بلا زر إغلاق سفلي — الإغلاق بعلامة ✕ وحدها (طلب المستخدم)
  openModal('👤 ' + t('profile'), skeletonCard(), '');

  const p = await getPlayerProfile(uid).catch(() => null);
  const data = p || {
    uid,
    name: preset.name || 'لاعب',
    country: preset.country || 'SA',
    level: preset.level || 1,
    wins: preset.wins || 0,
    losses: preset.losses || 0,
    totalVictories: 0,
    isBot: !!preset.isBot
  };

  const me = getPlayer();
  const isMe = data.uid === me?.id || uid === me?.id;
  const prog = progressInLevel(data.wins || 0);
  // 🧠 نسبة ذكاء اللاعب (كما في ملفه — قيد القياس أول 20 جولة)
  const iqData = intelligenceOf(data.wins || 0, data.losses || 0);
  const iqLabel = iqData.testing ? '⏳' : (iqData.value + '%');
  const rel = isMe
    ? { status: 'me', request: null }
    : await friendshipStatusEx(uid).catch(() => ({ status: 'none', request: null }));
  const st = rel.status;

  let actionHTML = '';
  if (!isMe) {
    if (st === 'friends') {
      actionHTML = `<button class="btn btn-glow-danger" id="pc-friend">🗑️ ${t('removeFriend', 'إلغاء الصداقة')}</button>`;
    } else if (st === 'pending_sent') {
      actionHTML = `<button class="btn btn-secondary" disabled>⏳ ${t('waitingApproval', 'في انتظار الموافقة')}</button>`;
    } else if (st === 'pending_received' && rel.request) {
      // 📩 هو من أرسل لي الطلب — زر قبول أخضر
      actionHTML = `<button class="btn btn-glow-success" id="pc-accept">📩 ${t('acceptReq', 'قبول الطلب')}</button>`;
    } else {
      actionHTML = `<button class="btn btn-glow-primary" id="pc-friend">➕ ${t('addAsFriend', 'إضافة كصديق')}</button>`;
    }
  }

  openModal('👤 ' + t('profile'), `
    <div class="pcard">
      <div class="pcard-head">
        <div class="pcard-avatar">${avatarMedia(data)}</div>
        <div class="pcard-id">
          <div class="pcard-name">${_esc(data.name)}</div>
          <div class="pcard-lvl">${t('level')} ${data.level || 1}</div>
        </div>
      </div>
      <div class="pcard-progress">
        <div class="pcard-progress-fill" style="width:${prog.pct}%"></div>
        <span>${prog.current}/${prog.needed} — ${t('level')} ${prog.level + 1}</span>
      </div>
      <!-- 💰 خزنة اللاعب تظهر لبقية اللاعبين (طلب المستخدم v23) -->
      <div class="pcard-vault">
        <div class="pcv-chip tokens"><b>🏆 ${Number(data.tokens) || 0}</b><span>${t('vaultTokens', 'علامات الانتصار')}</span></div>
        <div class="pcv-chip gems"><b>💎 ${Number(data.gems) || 0}</b><span>${t('vaultGems', 'الجواهر')}</span></div>
        <div class="pcv-chip intel"><b>🧠 ${Number(data.intel) || 0}</b><span>${t('vaultIntel', 'جوائز الذكاء')}</span></div>
        <div class="pcv-chip iq"><b>${iqLabel}</b><span>${t('intelPercent', 'نسبة الذكاء')}</span></div>
      </div>
      <div class="pcard-stats">
        <div class="es"><b>${data.wins || 0}</b><span>${t('wins')}</span></div>
        <div class="es"><b>${data.losses || 0}</b><span>${t('losses')}</span></div>
        <div class="es"><b>${data.totalVictories || 0}</b><span>${t('questionWins', 'انتصارات أسئلة')}</span></div>
        <div class="es"><b>${data.level || 1}</b><span>${t('level')}</span></div>
      </div>
      ${actionHTML ? `<div class="pcard-actions">${actionHTML}</div>` : ''}
    </div>`, '');

  const fBtn = document.getElementById('pc-friend');
  if (fBtn) {
    fBtn.onclick = async () => {
      if (st === 'friends') {
        if (!confirm(t('unfriendConfirm', 'إلغاء الصداقة مع هذا اللاعب؟'))) return;
        await removeFriend(uid);
        openPlayerProfile(uid, preset); // إعادة الفتح بالحالة الجديدة
        return;
      }
      fBtn.disabled = true;
      fBtn.innerHTML = `⏳ ${t('sending', 'جاري الإرسال...')}`;
      const res = await sendFriendRequest({
        uid,
        name: data.name,
        country: data.country,
        isBot: !!data.isBot
      });
      fBtn.innerHTML = res.ok ? '⏳ في انتظار الموافقة' : ('⚠️ ' + (res.msg || 'فشل'));
      if (!res.ok) fBtn.disabled = false;
    };
  }

  // 📩 القبول من داخل البطاقة
  const aBtn = document.getElementById('pc-accept');
  if (aBtn) {
    aBtn.onclick = async () => {
      aBtn.disabled = true;
      aBtn.innerHTML = `⏳ ${t('accepting', 'جاري القبول...')}`;
      const res = await acceptFriendRequest(rel.request);
      aBtn.innerHTML = res.ok ? '🤝 أصبحتما صديقين!' : ('⚠️ ' + (res.msg || 'فشل'));
    };
  }
}
