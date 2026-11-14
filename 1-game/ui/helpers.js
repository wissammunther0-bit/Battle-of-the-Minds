// ui/helpers.js
// ============================================================
// 🎨 أدوات الواجهة المشتركة — v7
//
//  - notify():     🔔 توست عائم عصري (بديل alert التقليدي)
//  - confirmDialog(): نافذة تأكيد زجاجية عصرية (بديل confirm)
//  - زجاج متدرج + أيقونة ملوّنة حسب النوع + حركة دخول/خروج ناعمة
//  - تدعم RTL/LTR تلقائيًا وتُكدَّس فوق أي شاشة (حتى داخل المباراة)
// ============================================================

/* ============================================================
 * 🌍 أعلام الدول — توليد تلقائي من رمز ISO-3166 (v11)
 * (طلب المستخدم: كل اللاعبين الافتراضيين لهم علم دولة — لا علم أبيض)
 * الطريقة: تحويل كل حرف من رمز الدولة إلى "Regional Indicator
 * Symbol" فينتج علم الدولة الصحيح لأي رمز معروف — تغطية كاملة
 * لدول البوتات الـ39 ودول التسجيل كلها دون خريطة يدوية ناقصة.
 * ============================================================ */

/** رموز غير صالحة → علم عشوائي ثابت حسب الرمز (نفس الرمز = نفس العلم)
 *  يضمن ألا يظهر علم أبيض 🏳️ أبدًا لأي لاعب أو لاعب افتراضي */
const FALLBACK_FLAGS = ['🇸🇦','🇪🇬','🇦🇪','🇰🇼','🇶🇦','🇯🇴','🇲🇦','🇩🇿','🇮🇶','🇵🇸',
  '🇱🇧','🇸🇩','🇴🇲','🇧🇭','🇾🇪','🇹🇳','🇱🇾','🇺🇸','🇬🇧','🇫🇷',
  '🇩🇪','🇪🇸','🇮🇹','🇹🇷','🇧🇷','🇲🇽','🇮🇳','🇵🇰','🇮🇩','🇲🇾',
  '🇳🇬','🇰🇪','🇷🇺','🇺🇦','🇨🇳','🇯🇵','🇰🇷','🇦🇺','🇨🇦','🇻🇳'];

function flagFromCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return null;
  // Regional Indicator: U+1F1E6 = 'A' … كل حرف يُزاح 127397 نقطة
  return String.fromCodePoint(...[...c].map(ch => 127397 + ch.charCodeAt(0)));
}

/** علم دولة من رمزها — يعيد علمًا حقيقيًا دائمًا (لا 🏳️ أبدًا) */
export function getFlag(code) {
  const f = flagFromCode(code);
  if (f) return f;
  const s = String(code || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return FALLBACK_FLAGS[h % FALLBACK_FLAGS.length];
}

/** علم عشوائي حقيقي — للاعب افتراضي بلا دولة */
export function randomFlag() {
  return FALLBACK_FLAGS[Math.floor(Math.random() * FALLBACK_FLAGS.length)];
}

/* ============================================================
 * 🧠 أيقونة الذكاء — استبدال أيقونة الكأس لعلامات الانتصار
 * (طلب المستخدم: أيقونة احترافية تخص الذكاء/التفكير)
 * v13: تأتي الآن من المكتبة المحلية icons/intel.svg —
 * ويستبدلها ملف المستخدم تلقائيًا إن وضعه في مجلد icons/
 * ============================================================ */

import { icon } from './icons.js';

/** 🧠 أيقونة الذكاء مصغّرة (للشرائح والشارات) */
export function intelIcon(cls = '') {
  return icon('intel', cls ? `intel-ico ${cls}` : 'intel-ico');
}

export function el(id) {
  return document.getElementById(id);
}

/* ==========================================================
 * 🔔 التوست العصري — بديل alert()
 * ========================================================== */

const TOAST_ICONS = {
  info:    '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  success: '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  error:   '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  warn:    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'
};

function toastHost() {
  let host = document.getElementById('ui-toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'ui-toasts';
    document.body.appendChild(host);
  }
  return host;
}

/** 🔔 إشعار عصري عائم — type: info | success | error | warn */
export function notify(msg, type = 'info', iconName = null) {
  const host = toastHost();
  const t = document.createElement('div');
  t.className = 'ui-toast ' + type + (iconName ? ' has-custom-icon' : '');
  const ico = iconName
    ? icon(iconName)
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
         stroke-linecap="round" stroke-linejoin="round">${TOAST_ICONS[type] || TOAST_ICONS.info}</svg>`;
  t.innerHTML = `
    <span class="ut-ico">
      ${ico}
    </span>
    <span class="ut-msg"></span>`;
  t.querySelector('.ut-msg').textContent = String(msg ?? '');
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));

  setTimeout(() => {
    t.classList.remove('show');
    t.classList.add('bye');
    setTimeout(() => t.remove(), 380);
  }, 2700);
}

/** 🔔 إشعار داخل شاشة اللعب فقط (نفس السلوك السابق) */
export function showGameToast(msg) {
  const host = document.querySelector('.game-quiz-v2') || document.body;
  const el = document.createElement('div');
  el.className = 'game-toast';
  el.textContent = msg;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 350);
  }, 2300);
}

/* ==========================================================
 * 🪟 نافذة تأكيد عصرية — بديل confirm()
 * ========================================================== */

function dialogHost() {
  let host = document.getElementById('ui-dialog');
  if (!host) {
    host = document.createElement('div');
    host.id = 'ui-dialog';
    host.className = 'ui-dialog hidden';
    host.innerHTML = `
      <div class="ui-dialog-box">
        <div class="ud-ico" data-ico></div>
        <h4 class="ud-title" data-title></h4>
        <p class="ud-msg" data-msg></p>
        <div class="ud-actions" data-actions></div>
      </div>`;
    document.body.appendChild(host);
  }
  return host;
}

const DLG_ICONS = {
  warn:   TOAST_ICONS.warn,
  danger: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  info:   TOAST_ICONS.info,
  success: TOAST_ICONS.success
};

/**
 * 🪟 حوار خيارات عصري (زر أو أكثر) — يرجع Promise بقيمة الزر
 * buttons: [{ label, value, cls: 'primary'|'danger'|'ghost' }]
 */
export function modernDialog({ title = '', message = '', icon = 'info', buttons = [] }) {
  return new Promise((resolve) => {
    const host = dialogHost();
    const box = host.querySelector('.ui-dialog-box');
    const icoEl = host.querySelector('[data-ico]');
    const titleEl = host.querySelector('[data-title]');
    const msgEl = host.querySelector('[data-msg]');
    const actEl = host.querySelector('[data-actions]');

    icoEl.className = 'ud-ico ' + icon;
    icoEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      ${DLG_ICONS[icon] || DLG_ICONS.info}</svg>`;
    titleEl.textContent = title;
    titleEl.classList.toggle('hidden', !title);
    msgEl.textContent = message;
    msgEl.classList.toggle('hidden', !message);

    actEl.innerHTML = '';
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.className = 'ud-btn ' + (b.cls || 'ghost');
      btn.textContent = b.label;
      btn.onclick = () => {
        host.classList.add('hidden');
        resolve(b.value);
      };
      actEl.appendChild(btn);
    });

    host.classList.remove('hidden');
    box.classList.remove('shake');
    void box.offsetWidth;           // إعادة تشغيل حركة الظهور
    box.classList.add('shake');
  });
}

/** 🪟 تأكيد نعم/لا — بديل confirm() (true = موافق) */
export async function confirmDialog({
  title = '', message = '', icon = 'warn',
  okText = 'تأكيد', cancelText = 'إلغاء', danger = false
}) {
  const res = await modernDialog({
    title, message, icon,
    buttons: [
      { label: cancelText, value: false, cls: 'ghost' },
      { label: okText, value: true, cls: danger ? 'danger' : 'primary' }
    ]
  });
  return res === true;
}
