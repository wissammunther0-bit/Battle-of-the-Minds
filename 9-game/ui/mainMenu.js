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
// 🛒 v41: حُذف متجر الجوائز بالكامل (prizeStore.js) — اللعبة مجانية بلا جوائز نقدية.
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

/* ============================================================
 * ✨ v33.5 — الهالة التفاعلية خلف إطار الشخصية (طلب المستخدم:
 * «أريد شيء تفاعلي ناعم يليق باللعبة» بين الشريط العلوي وشريط المستوى)
 *  • CSS: شفق متدرج يتنفس + شرارات صاعدة خلف السداسي (styles/v33.css)
 *  • JS هنا: parallax ناعم — الإطار يميل بلطف مع حركة المؤشر/اللمس
 *    عبر متغيرات CSS (--ax/--ay) بدون أي مكتبات، ويهتز حول مركزه
 * ============================================================ */
function bindHeroAura() {
  const hero = document.querySelector('.hero-hex');
  if (!hero || hero.dataset.auraBound) return;
  hero.dataset.auraBound = '1';

  // 🌌 حاقن الهالة: 3 شفق متحركة + نجوم وبرق وسهام — خلف الإطار مباشرة
  //    🛠️ v36: أُضيفت عناصر البرق والسهام (au-bolt/au-arrow) بطلب المستخدم
  if (!hero.querySelector('.hero-aura')) {
    const aura = document.createElement('span');
    aura.className = 'hero-aura';
    aura.setAttribute('aria-hidden', 'true');
    aura.innerHTML = '<i></i><i></i><i></i>'
      + '<b class="au-bolt b1"></b><b class="au-bolt b2"></b>'
      + '<b class="au-arrow a1"></b><b class="au-arrow a2"></b>';
    hero.prepend(aura);
  }

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (reduce) return;   // احترام تفضيل تقليل الحركة

  let raf = 0, tx = 0, ty = 0;
  const apply = () => {
    raf = 0;
    hero.style.setProperty('--ax', tx.toFixed(3));
    hero.style.setProperty('--ay', ty.toFixed(3));
  };
  const onMove = (e) => {
    const r = hero.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    // نطاق لطيف ±1 → يُترجم في CSS إلى ميل ±7 درجات ورفع ±8px
    tx = Math.max(-1, Math.min(1, (e.clientX - cx) / Math.max(140, r.width)));
    ty = Math.max(-1, Math.min(1, (e.clientY - cy) / Math.max(140, r.height)));
    if (!raf) raf = requestAnimationFrame(apply);
  };
  const onLeave = () => { tx = 0; ty = 0; if (!raf) raf = requestAnimationFrame(apply); };
  const host = document.getElementById('view-main') || document;
  host.addEventListener('pointermove', onMove, { passive: true });
  host.addEventListener('pointerleave', onLeave, { passive: true });
  // لمس الهاتف: لمسة واحدة تحرّك الهالة بلطف
  host.addEventListener('touchmove', (e) => {
    const t0 = e.touches?.[0];
    if (t0) onMove(t0);
  }, { passive: true });
}

export function initMainMenu() {
  refreshTopbar();
  bindHeroAura();   // ✨ v33.5 — هالة تفاعلية ناعمة خلف إطار الشخصية
  const levelGuideBtn = document.getElementById('lvl-guide-btn');
  if (levelGuideBtn) levelGuideBtn.onclick = openLevelGuide;

  /* --- 🎁 لافتة صندوق المكافآت (تبقى — لا جوائز نقدية بل مكافآت داخلية) --- */
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
  });

  hydrateIcons(document);   // ⚡ ملء أيقونات الشريط العلوي والبطاقات والدوك

  // ⏸️ إيقاف المؤقتات عند مغادرة الرئيسية
  document.addEventListener('viewchange', function onLeave(e) {
    if (e.detail !== 'main') {
      stopBoxTicker();
      unsubBox();
      document.removeEventListener('viewchange', onLeave);
    }
  });
}
