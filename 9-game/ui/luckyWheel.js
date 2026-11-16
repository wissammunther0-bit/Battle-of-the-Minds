// ui/luckyWheel.js — v18
// ============================================================
// 🎡 قرص الحظ الاحترافي الواقعي — إعادة بناء كاملة (طلب المستخدم):
//
//  • 🎬 الإعلان قبل الدوران: لا يمكن تدوير القرص إلا بعد مشاهدة
//    إعلان — الأقسام الفارغة من المعقول أن تطلب إعلانًا "بعد" الوقوف
//    عليها، لذلك صار التسلسل: مشاهدة الإعلان ← الدوران ← الجائزة
//    التي تتوقف عندها الإبرة تُمنح مباشرة بلا أي إعلان ثانٍ.
//
//  • 🎯 قرص HTML/CSS واقعي أكبر وأكثر احترافية: إطار ذهبي مزدوج
//    بمصابيح متلألئة + شرائح ملونة بعمق ثلاثي + أوتاد فاصلة تدور
//    مع القرص + محور ذهبي + إبرة متوهجة — ودوران سلس مثير.
//
//  • 🖼️ أيقونات الأقسام من مجلد icons/ المحلي نفسه (gems/tokens/
//    intel/skip/swap/freeze/pen/none) — يستبدلها المطور بالملفات
//    وتظهر في القرص تلقائيًا.
//
//  • 🔀 أقسام غير متسلسلة: ترتيب العرض مخلوط بخوارزمية ثابتة
//    (نفس الإعداد = نفس الخلط) — يظهر مثل 1 5 10 2 8 6 4 3 9
//    حتى لا يتوقع اللاعب نمط الجوائز.
//
//  • 🚫 لا أيقونة قفل: الخانة "المستحيلة" تُرسم مثل أي خانة عادية
//    تمامًا (لون + أيقونة + مقدار) — القرص يبدو حقيقيًا 100% ولا
//    يلاحظ اللاعب أي تحكم خلف الكواليس.
// ============================================================

import {
  wheelReadyAtMs, availabilityState, fmtRemaining, fmtCountdown,
  playAd, claimWheelPrize, markWheelSpinned,
  getWheelSlots, TIER_WEIGHTS
} from '../game/rewards.js'; // playAd('wheel') يسجَّل بنوعه
import { getWheelConfig } from '../store-catalog.js';
import { openModal, closeModal } from './modal.js';
import { notify } from './helpers.js';
import { icon } from './icons.js';
import { refreshTopbar } from './topbar.js';
import { t } from '../i18n.js';

const SPIN_MS = 5200;           // ⏱️ مدة الدوران المشوق
const SPIN_TURNS = 6;           // 🔄 لفات كاملة قبل التوقف

/* 🎨 ألوان الشرائح — لوحة احترافية متناوبة */
const PALETTE = [
  '#7c3aed', '#0891b2', '#d97706', '#059669', '#dc2626',
  '#4f46e5', '#c026d3', '#0284c7', '#16a34a', '#ea580c',
  '#9333ea', '#0d9488'
];

const _esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

let _rotation = 0;              // زاوية الوقوف الفعلية بين الدورات
let _spinning = false;
let _ticker = null;
let _dispSlots = null;          // ترتيب العرض المخلوط (ثابت لنفس الإعداد)
let _dispKey = '';

/* ==========================================================
 * 🔀 خلط العرض — ثابت لنفس إعداد الجوائز (Fisher-Yates ببذرة
 *    مشتقة من المحتوى) — أقسام تظهر غير متسلسلة (طلب المستخدم)
 * ========================================================== */
function _hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function _mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** خانات القرص بترتيب العرض المخلوط — تُحسب مرة لكل إعداد */
function displaySlots() {
  const raw = getWheelSlots();
  const key = raw.map(s => `${s.kind}:${s.toolId || ''}:${s.amount}:${s.tier}`).join('|');
  if (_dispSlots === null || _dispKey !== key) {
    const arr = [...raw];
    const rnd = _mulberry32(_hashStr(key) || 7);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    _dispSlots = arr;
    _dispKey = key;
  }
  return _dispSlots;
}

/** 🎯 اختيار الفائز بالوزن من ترتيب العرض نفسه (المستحيلة لا تُختار) */
function pickFromDisplay(slots) {
  const weighted = [];
  slots.forEach((s, i) => {
    // 🎯 v24: النسبة الصريحة % من الإدارة أولًا، وإلا الوزن الاسمي
    const pct = Number(s?.percent);
    const w = Number.isFinite(pct) ? Math.max(0, pct) : (TIER_WEIGHTS[s.tier] ?? 100);
    if (w > 0) weighted.push({ i, s, w });
  });
  if (!weighted.length) return null;
  const total = weighted.reduce((a, x) => a + x.w, 0);
  let r = Math.random() * total;
  for (const x of weighted) {
    r -= x.w;
    if (r <= 0) return { index: x.i, slot: x.s };
  }
  const last = weighted[weighted.length - 1];
  return { index: last.i, slot: last.s };
}

/* ==========================================================
 * 🖼️ أيقونة الخانة — من مجلد icons/ المحلي (طلب المستخدم)
 * ========================================================== */
function slotIconHTML(slot) {
  const kind = slot?.kind || 'gems';
  if (kind === 'gems')   return icon('gems');
  if (kind === 'tokens') return icon('tokens');
  if (kind === 'intel')  return icon('intel');
  if (kind === 'tool') {
    // 🎨 v29: «حذف خيارين» بأيقونته الخاصة بدل أيقونة الأدوات العامة
    return { rename: icon('pen'), skip: icon('skip'), swap: icon('swap'),
             freeze: icon('freeze'), fifty: icon('fifty') }[slot?.toolId] || icon('tools');
  }
  return icon('none');        // خانة فارغة
}

/** تسمية الجائزة للنافذة */
function slotLabel(slot) {
  const kind = slot?.kind || 'gems';
  const amount = Math.max(0, Math.floor(Number(slot?.amount) || 0));
  if (kind === 'tool') {
    const names = {
      rename: t('toolRename', 'تغيير الاسم'), skip: t('toolSkip', 'تخطي السؤال'),
      swap: t('toolSwap', 'تبديل السؤال'), freeze: t('toolFreeze', 'تجميد الخصم'),
      fifty: 'حذف خيارين (50:50)'
    };
    return names[slot?.toolId] || t('toolGeneric', 'أداة مساعدة');
  }
  return `+${amount}`;
}

/* ==========================================================
 * 🎨 بناء القرص الواقعي — HTML/CSS خالص (أكبر وأكثر واقعية)
 *    الخانة i متمركزة على الزاوية i*seg — 0° أسفل الإبرة أعلى القرص
 * ========================================================== */
function wheelHTML(slots) {
  const N = Math.max(2, slots.length);
  const seg = 360 / N;

  /* --- خلفية الشرائح conic-gradient --- */
  const stops = slots.map((s, i) => {
    // 🚫 بلا قفل وبلا تمييز — الخانة المستحيلة مثل أي خانة عادية تمامًا
    const c = PALETTE[i % PALETTE.length];
    const a0 = i * seg, a1 = (i + 1) * seg;
    return `${c} ${a0.toFixed(3)}deg ${a1.toFixed(3)}deg`;
  }).join(', ');
  const discBG = `conic-gradient(from ${(-seg / 2).toFixed(3)}deg, ${stops})`;

  /* --- محتوى كل خانة: أيقونة + مقدار (يتوجهان نحو الحافة) --- */
  const slotsHTML = slots.map((s, i) => {
    const mid = i * seg;
    const isNone = (s.kind || '') === 'none';
    const isTool = (s.kind || '') === 'tool';
    const amount = Math.max(0, Math.floor(Number(s.amount) || 0));
    const ico = `<span class="lw-s-ico">${slotIconHTML(s)}</span>`;
    const amt = (!isNone && !isTool && amount > 0)
      ? `<b class="lw-s-amt" dir="ltr">${amount > 999 ? (amount / 1000).toFixed(amount % 1000 ? 1 : 0) + 'k' : amount}</b>`
      : '';
    return `
      <div class="lw-slot ${isNone ? 'is-none' : ''}"
           style="transform: translate(-50%, -50%) rotate(${mid.toFixed(2)}deg) translateY(calc(var(--lwR) * -1))">
        ${ico}${amt}
      </div>`;
  }).join('');

  /* --- أوتاد فاصلة عند حدود الشرائح (تدور مع القرص — واقعية) --- */
  let pegs = '';
  for (let i = 0; i < N; i++) {
    const a = (i + 0.5) * seg;
    pegs += `<i class="lw-peg" style="transform: translate(-50%, -50%) rotate(${a.toFixed(2)}deg) translateY(calc(var(--lwR) * -1.36))"></i>`;
  }

  /* --- مصابيح الإطار — 16 مصباحًا (ثابتة لا تدور) --- */
  let bulbs = '';
  for (let b = 0; b < 16; b++) {
    const a = b * (360 / 16);
    bulbs += `<i class="lw-bulb" style="transform: translate(-50%, -50%) rotate(${a}deg) translateY(calc(var(--lwR) * -1.63)); animation-delay:${(b % 4) * 0.4}s"></i>`;
  }

  return `
    <div class="lw-wheel" role="img" aria-label="${_esc(t('luckyWheel', 'عجلة المكافآت'))}">
      <div class="lw-rim"></div>
      <div class="lw-rim-inner"></div>
      ${bulbs}
      <div class="lw-disc-clip">
        <div class="lw-disc" id="lw-disc" dir="ltr">
          <div class="lw-disc-bg" style="background:${discBG}"></div>
          <div class="lw-disc-shine"></div>
          ${slotsHTML}
          ${pegs}
        </div>
      </div>
      <div class="lw-hub"><span class="lw-hub-ico">${icon('wheel')}</span></div>
      <div class="lw-pointer"><i></i></div>
    </div>`;
}

/* ==========================================================
 * 🚀 رسم قسم قرص الحظ — يُستدعى من رسم المتجر
 * ========================================================== */
export function renderLuckyWheel() {
  const mount = document.getElementById('wheel-mount');
  if (!mount) return;

  const cfg = getWheelConfig();
  const slots = displaySlots();
  const st = availabilityState(wheelReadyAtMs());

  if (!cfg || slots.length < 2) {
    mount.innerHTML = `<div class="lw-empty">🎡 ${t('wheelNotConfigured', 'عجلة المكافآت غير مُعدّة بعد — تُضاف جوائزها من لوحة الإدارة')}</div>`;
    return;
  }

  /* --- حالة الرأس --- */
  const headState = st.disabled
    ? `<span class="lw-off">${t('wheelDisabled', 'العجلة معطّلة حاليًا')}</span>`
    : st.available
      ? `<span class="lw-on">✨ ${t('wheelReady', 'العجلة متاحة')}</span>`
      : `<span class="lw-wait">⏳ ${t('wheelSoon', 'العجلة تُتاح قريبًا')}</span>`;

  /* --- 🎬 v24 (طلب المستخدم): نص الإعلان داخل الزر —
        يظهر أسفل زر «تحريك العجلة» وهو متاح، ويختفي بعد مشاهدة
        الفيديو ويظهر مكانُه عدّاد وقت المشاهدة القادمة */
  const btnAdSub = `<span class="lw-btn-ad">${t('wheelAdSub', 'شاهد فيديو قصير واحصل على مكافئة')}</span>`;

  /* --- ⏲️ زر الدوران: العدّاد على الزر وهو شفاف/معطّل --- */
  let btnHTML, btnCls, btnDisabled;
  if (st.disabled) {
    btnHTML = t('wheelDisabled', 'العجلة معطّلة حاليًا');
    btnCls = 'dim';
    btnDisabled = true;
  } else if (st.available) {
    btnHTML = _spinning
      ? `🎡 ${t('wheelSpinning', 'تدور الآن...')}`
      : `<span class="lw-btn-vid">${icon('video')}</span><span class="lw-btn-main">${t('spinWheel', 'تحريك العجلة')}</span>${btnAdSub}`;
    btnCls = _spinning ? 'dim' : '';
    btnDisabled = _spinning;
  } else {
    btnHTML = `<span class="lw-cd"><span class="lw-cd-icon">${icon('clock')}</span><b id="lw-btn-count" class="lw-cd-num">${fmtCountdown(st.remainingMs)}</b></span>
               <span class="lw-cd-sub">${t('nextSpinIn', 'الدوران القادم بعد')}</span>`;
    btnCls = 'dim cd';
    btnDisabled = true;
  }

  mount.innerHTML = `
    <div class="lucky-wheel ${st.disabled ? 'disabled' : ''}">
      <div class="lw-head">
        <span class="lw-title">${icon('wheel')} ${t('luckyWheel', 'عجلة المكافآت')}</span>
        ${headState}
      </div>
      <div class="lw-stage" id="lw-stage">${wheelHTML(slots)}</div>
      <button class="btn lw-spin-btn ${btnCls}"
              id="btn-lw-spin" ${btnDisabled ? 'disabled' : ''}>${btnHTML}</button>
      <p class="lw-hint">${t('wheelHint', 'احصل على مكافأة هذا اليوم')}</p>
    </div>`;

  const disc = document.getElementById('lw-disc');
  if (disc) {
    disc.style.transition = 'none';
    disc.style.transform = `rotate(${_rotation}deg)`;
  }

  document.getElementById('btn-lw-spin').onclick = onSpinClick;
  _sizeWheel();
}

/* ==========================================================
 * 📐 ضبط مقاسات القرص — نصف قطر الأيقونات/الأوتاد/المصابيح
 *    يُحسب من العرض الفعلي للقرص (متوافق مع كل شاشات الهواتف)
 * ========================================================== */
let _ro = null;
function _applyWheelSize(wheel) {
  const S = wheel.clientWidth;
  if (!S) return;
  wheel.style.setProperty('--lwR', `${(S * 0.295).toFixed(1)}px`);
  wheel.style.setProperty('--lwIco', `${Math.max(17, Math.round(S * 0.075))}px`);
  wheel.style.setProperty('--lwAmt', `${Math.max(11, Math.round(S * 0.042))}px`);
  wheel.style.setProperty('--lwBulb', `${Math.max(5, Math.round(S * 0.024))}px`);
}

function _sizeWheel() {
  const wheel = document.querySelector('.lw-wheel');
  if (!wheel) return;
  _applyWheelSize(wheel);
  if (!_ro) {
    _ro = new ResizeObserver(() => {
      const w = document.querySelector('.lw-wheel');
      if (w) _applyWheelSize(w);
    });
  }
  try { _ro.observe(wheel); } catch { /* متصفح قديم — الحجم الأولي يكفي */ }
}

/* ==========================================================
 * 🎬 → 🎡 التسلسل الجديد v24 (طلب المستخدم):
 *  لا نافذة تعليمات إطلاقًا — الضغط على «تحريك العجلة» يشغّل
 *  الفيديو مباشرة، وبعد اكتمال المشاهدة تدور العجلة فورًا.
 *  والزر معطّل حتى تكتمل مدة الإتاحة التي حددها المطور.
 * ========================================================== */
function onSpinClick() {
  if (_spinning) return;

  const st = availabilityState(wheelReadyAtMs());
  if (st.disabled) { notify(t('wheelDisabled', 'العجلة معطّلة حاليًا'), 'warn'); return; }
  if (!st.available) {
    notify(`⏱️ ${t('nextSpinIn', 'الدوران القادم بعد')} ${fmtRemaining(st.remainingMs)}`, 'warn');
    return;
  }

  _spinAfterAd();
}

/** 🎬 مشاهدة الفيديو مباشرة من الضغط على الزر (بلا أي نافذة) ثم الدوران */
async function _spinAfterAd() {
  const btn = document.getElementById('btn-lw-spin');
  if (btn) {
    btn.disabled = true;
    btn.classList.add('dim');
    btn.innerHTML = `⏳ ${t('loading', 'جاري التحميل...')}`;
  }
  const watched = await playAd('wheel');   // 🎬 يسجّل: إعلان تحريك العجلة
  if (!watched) {
    renderLuckyWheel();     // ← يعيد الزر بحالته المتاحة مع نص الإعلان
    return;
  }
  _doSpin();
}

/** 🎡 الدوران الفعلي — يُستدعى فقط بعد إكمال مشاهدة الإعلان */
function _doSpin() {
  if (_spinning) return;

  const slots = displaySlots();

  // 🎯 اختيار الفائز بالوزن قبل الدوران (المستحيلة لا تُختار أبدًا)
  const win = pickFromDisplay(slots);
  if (!win) { notify(t('wheelNoPrizes', 'لا جوائز قابلة للفوز — عدّل الأدمن نسب الخانات'), 'warn'); return; }

  // ⏲️ الفرصة تُستهلك لحظة الدوران — عدّاد الإتاحة يبدأ الآن
  markWheelSpinned();

  // 🎬 حرّك القرص لتتوقف الإبرة على الخانة الفائزة
  const N = slots.length;
  const seg = 360 / N;
  const mid = win.index * seg;                          // الخانة متمركزة على mid
  const jitter = (Math.random() - 0.5) * seg * 0.55;    // توقف طبيعي داخل الخانة
  const target = ((360 - mid - jitter) % 360 + 360) % 360;
  const current = ((_rotation % 360) + 360) % 360;
  let delta = target - current;
  delta = ((delta % 360) + 360) % 360;
  const finalRot = current + 360 * SPIN_TURNS + delta;
  _rotation = target;

  _spinning = true;
  const btn = document.getElementById('btn-lw-spin');
  if (btn) { btn.disabled = true; btn.classList.add('dim'); btn.textContent = '🎡 ' + t('wheelSpinning', 'يدور الآن...'); }

  const disc = document.getElementById('lw-disc');
  if (disc) {
    let finished = false;
    let fallbackTimer;
    const finishSpin = (event) => {
      if (event && (event.target !== disc || event.propertyName !== 'transform')) return;
      if (finished) return;
      finished = true;
      clearTimeout(fallbackTimer);
      disc.removeEventListener('transitionend', finishSpin);
      _spinning = false;
      renderLuckyWheel();
      if ((win.slot.kind || '') === 'none') _openNoWinPopup();
      else _openPrizePopup(win.slot);
    };

    disc.addEventListener('transitionend', finishSpin);
    disc.style.transition = `transform ${SPIN_MS}ms cubic-bezier(.22,.61,.36,1)`;
    void disc.offsetWidth;
    disc.style.transform = `rotate(${finalRot}deg)`;
    fallbackTimer = setTimeout(finishSpin, SPIN_MS + 500);
    return;
  }

  _spinning = false;
  renderLuckyWheel();
}

/** 🪟 نافذة الجائزة — استلام مباشر بلا إعلان */
function _openPrizePopup(slot) {
  const kind = slot?.kind || 'gems';
  const isTool = kind === 'tool';
  const amount = Math.max(0, Math.floor(Number(slot?.amount) || 0));
  const label = isTool ? slotLabel(slot) : `+${amount}`;

  openModal(t('wheelPrizeTitle', 'توقفت الإبرة!'), `
    <div class="wheel-prize">
      <div class="wp-orb">
        <span class="wp-ico">${slotIconHTML(slot)}</span>
        <span class="wp-orb-glow"></span>
      </div>
      <div class="wp-label">${_esc(label)}</div>
      <div class="wp-kind">${_esc(isTool ? t('toolGeneric', 'أداة مساعدة')
        : t({ gems: 'wheelPrizeGems', tokens: 'wheelPrizeTokens', intel: 'wheelPrizeIntel' }[kind] || 'wheelPrizeGems',
             { gems: 'جواهر', tokens: 'علامات انتصار', intel: 'جوائز ذكاء' }[kind] || ''))}</div>
      <button class="btn btn-glow-success wp-claim" id="btn-wp-claim">
        🎁 ${t('wheelClaimBtn', 'استلام الجائزة')}
      </button>
      <p class="wp-hint">${t('wheelClaimHint', 'الجائزة تُضاف لحسابك مباشرة — وعدّاد الدوران القادم بدأ بالفعل')}</p>
    </div>`, '');

  document.getElementById('btn-wp-claim').onclick = async () => {
    const cBtn = document.getElementById('btn-wp-claim');
    cBtn.disabled = true;
    cBtn.innerHTML = '⏳ ' + t('loading', 'جاري التحميل...');

    const res = await claimWheelPrize(slot);
    if (!res.ok) {
      notify(res.msg || t('error', 'خطأ'), 'error');
      closeModal();
      return;
    }
    refreshTopbar();
    notify('🎁 ' + res.label, 'success');
    closeModal();
    renderLuckyWheel();
  };
}

/** 🪟 نافذة "حظ أوفر" — الوقوف على خانة فارغة */
function _openNoWinPopup() {
  openModal(t('wheelNoWinTitle', 'لم تحصل هذه المرة!'), `
    <div class="wheel-prize no-win">
      <div class="wp-orb dim">
        <span class="wp-ico">${icon('none')}</span>
      </div>
      <div class="wp-label small">${t('wheelNoWin', 'حظ أوفر المرة القادمة')}</div>
      <button class="btn wp-ok" id="btn-wp-ok">${t('wheelOk', 'حسنًا')}</button>
    </div>`, '');
  document.getElementById('btn-wp-ok').onclick = () => { closeModal(); renderLuckyWheel(); };
}

/** ⏲️ مؤقت العدّاد داخل المتجر — يحدّث رقم العد على زر الدوران نفسه */
export function startWheelTicker() {
  stopWheelTicker();
  _ticker = setInterval(() => {
    const view = document.getElementById('view-store');
    if (!view || !view.classList.contains('active')) return;
    const st = availabilityState(wheelReadyAtMs());
    const count = document.getElementById('lw-btn-count');
    if (count && !st.available) {
      count.textContent = fmtCountdown(st.remainingMs);   // تحديث العدّاد الرقمي
    } else if (st.available && document.getElementById('btn-lw-spin')?.disabled) {
      renderLuckyWheel();                                  // انتهى الوقت → فعّل الزر
    }
  }, 1000);
}

export function stopWheelTicker() {
  if (_ticker) { clearInterval(_ticker); _ticker = null; }
}
