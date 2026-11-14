// ui/mainMenu.js
// ============================================================
// 🏠 القائمة الرئيسية — النسخة v16 (تصميم جديد وفق نموذج المستخدم)
//
// (جديد v16): واجهة الرئيسية أعيد بناؤها بالكامل:
//  • 🪪 ترحيب + اسم أعلى اليمين — إعدادات/جواهر/مصباح أعلى اليسار
//  • 🛡️ أفاتار سداسي ذهبي + شريط مستوى + زر "ابدأ المعركة" الذهبي
//  • 🗂️ ثلاث بطاقات: حقيبتي | إنشاء غرفة | المتجر
//  • 🎁 لافتة صندوق المكافآت بزر "افتح" أحمر (rewardsBox.js)
//  • 🧠 صف متجر الجوائز بتقدم نحو أقرب جائزة (awardsRow.js)
//  • 🎛️ شريط سفلي أيقوني: أصدقاء/سجل/متصدرون/رئيسية
//
// (قديم v14): الصندوق يهتز ويظهر عليه علامة فيديو عند توفره، والمكافأة
//    عشوائية بمشاهدة إعلان (بيئة جاهزة — الإعلانات لاحقًا).
// ============================================================

import { refreshTopbar } from './topbar.js';
import { renderRewardsBox, startBoxTicker, stopBoxTicker } from './rewardsBox.js';
// 🛒 v19: متجر الجوائز يظهر مباشرة في الرئيسية بلا نافذة (طلب المستخدم)
import { renderPrizeStore, startPrizeTicker, stopPrizeTicker, bindPrizeStoreRefresh } from './prizeStore.js';
import { openMyBag } from './bag.js';
import { openCreateRoomModal } from './lobby.js';
import { navigate } from '../app.js';
import { onCatalogChange } from '../store-catalog.js';
import { hydrateIcons } from './icons.js';
import { getPlayer } from '../auth.js';
import { progressInLevel, winsForLevel } from '../game/levels.js';
import { openModal } from './modal.js';
import { t } from '../i18n.js';

function openLevelGuide() {
  const progress = progressInLevel(getPlayer()?.wins || 0);
  const remaining = Math.max(0, progress.needed - progress.current);
  const brackets = [
    t('levelGuideBracket1', 'المستويات 1–10: كل مستوى يحتاج 10 انتصارات'),
    t('levelGuideBracket2', 'المستويات 11–30: كل مستوى يحتاج 20 انتصارًا'),
    t('levelGuideBracket3', 'المستويات 31–50: كل مستوى يحتاج 30 انتصارًا'),
    t('levelGuideBracket4', 'المستويات 51–70: كل مستوى يحتاج 40 انتصارًا'),
    t('levelGuideBracket5', 'من المستوى 71 فصاعدًا: كل مستوى يحتاج 50 انتصارًا')
  ];

  openModal('📈 ' + t('levelGuideTitle', 'كيف أرفع مستواي؟'), `
    <div class="level-guide">
      <p>${t('levelGuideIntro', 'الفوز بالمباراة الكاملة يمنحك انتصارًا واحدًا، والخسارة تخصم انتصارًا واحدًا. لا يقل رصيدك عن صفر، والفوز بالسؤال وحده لا يرفع المستوى.')}</p>
      <div class="level-guide-progress">
        <b>${t('levelGuideCurrent', 'مستواك الحالي')}: ${progress.level}</b>
        <span>${t('levelGuideProgress', 'تقدمك للمستوى التالي')}: ${progress.current}/${progress.needed}</span>
        <span>${t('levelGuideRemaining', 'الانتصارات المتبقية')}: ${remaining}</span>
      </div>
      <h4>${t('levelGuideRulesTitle', 'متطلبات الترقية')}</h4>
      <ul>${brackets.map(rule => `<li>${rule}</li>`).join('')}</ul>
      <p class="level-guide-next">${t('levelGuideNext', 'للوصول إلى المستوى التالي تحتاج')} ${winsForLevel(progress.level)} ${t('levelGuideWins', 'انتصارات مباريات كاملة')}.</p>
    </div>`, '');
}

export function initMainMenu() {
  refreshTopbar();
  const levelGuideBtn = document.getElementById('lvl-guide-btn');
  if (levelGuideBtn) levelGuideBtn.onclick = openLevelGuide;

  /* --- 🛒 متجر الجوائز (بطاقات مباشرة في الرئيسية) --- */
  renderPrizeStore();
  bindPrizeStoreRefresh();
  startPrizeTicker();

  /* --- 🎁 لافتة صندوق المكافآت --- */
  renderRewardsBox();
  startBoxTicker();

  /* --- 🗂️ البطاقات الثلاث --- */
  const bagBtn = document.getElementById('btn-my-bag');
  if (bagBtn) bagBtn.onclick = openMyBag;

  const createBtn = document.getElementById('btn-create-room');
  if (createBtn) {
    createBtn.onclick = () => {
      navigate('lobby');          // افتح شاشة اللوبي خلف النافذة
      openCreateRoomModal();      // ثم افتح نافذة إنشاء الغرفة فورًا
    };
  }

  // 🔴 وصلت إعدادات/عناصر جديدة من Firestore → أعد رسم الصندوق فورًا
  const unsubBox = onCatalogChange(() => {
    if (document.getElementById('box-mount')) renderRewardsBox();
    if (document.getElementById('prize-store-mount')) renderPrizeStore();
  });

  hydrateIcons(document);   // ⚡ ملء أيقونات الشريط العلوي والبطاقات والدوك

  // ⏸️ إيقاف المؤقتات عند مغادرة الرئيسية
  document.addEventListener('viewchange', function onLeave(e) {
    if (e.detail !== 'main') {
      stopBoxTicker();
      stopPrizeTicker();
      unsubBox();
      document.removeEventListener('viewchange', onLeave);
    }
  });
}
