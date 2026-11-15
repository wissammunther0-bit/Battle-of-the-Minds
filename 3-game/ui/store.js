// ui/store.js — v14
// ============================================================
// 🛒 المتجر الاحترافي:
//  - 🎡 قرص الحظ أعلى الشخصيات (طلب المستخدم v14) — وقت الإتاحة
//    والجوائز يديرها المطور من صفحة الإدارة والاستلام بمشاهدة إعلان.
//  - 🧩 توحيد الشخصيات والأفاتار (طلب المستخدم v14): قسم واحد
//    "الشخصيات" — كل العناصر من قاعدة البيانات (يضيفها المطور من
//    صفحة الإدارة) وإن لم يُضف شيء تظهر رسالة واضحة.
//  - كل قسم شريط أفقي قابل للسحب: القرص ← الشخصيات ← الأدوات.
//  - 💎 نافذة تحويل بمرحلتين: علامات→جواهر (كل 10=1) ثم
//    جواهر→جوائز ذكاء (كل 100=1) مع شروط فتح من الإدارة.
//  - 🆕 شارة "جديد" على العناصر المضافة خلال آخر 48 ساعة (إشعار
//    الإضافة الجديدة — طلب المستخدم).
// ============================================================

import { getPlayer } from '../auth.js';
import {
  convertTokensToGems, convertGemsToIntel, buyCharacter, buyBooster,
  equipCharacter,
  TOKENS_PER_GEM, GEMS_PER_INTEL,
  isIntelConvertUnlocked, isConditionMet, conditionLabel
} from '../store.js';
import {
  getStoreItems, getStoreVersion, getEconomyConfig, onCatalogChange, isItemFresh
} from '../store-catalog.js';
import { renderLuckyWheel, startWheelTicker, stopWheelTicker } from './luckyWheel.js';
import { refreshTopbar } from './topbar.js';
import { notify } from './helpers.js';
import { icon } from './icons.js';
import { markStoreSeen } from './badges.js';
import { openModal, closeModal } from './modal.js';
import { t } from '../i18n.js';

const _esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export function initStore() {
  markStoreSeen(getStoreVersion()); // 🔴 زيارة المتجر تخفي نقطة "جديد المتجر"

  // 💎 نافذة التحويل الاحترافية — الربط هنا مرة واحدة قبل أي رسم
  //   (الزر ثابت في الصفحة لا يُعاد رسمه — وربطه مبكرًا يضمن فتح
  //    النافذة حتى لو تعطل أي شيء آخر في رسم المتجر — طلب المستخدم)
  const convertBtn = document.getElementById('btn-open-convert');
  if (convertBtn) convertBtn.onclick = openConvertWindow;

  renderStore();

  // 🎯 v24 (طلب المستخدم): فتح المتجر على قسم الشخصيات مباشرة —
  //    يُطلب من الضغط على صورة اللاعب في الملف التعريفي
  try {
    if (sessionStorage.getItem('ba_store_focus') === 'characters') {
      sessionStorage.removeItem('ba_store_focus');
      setTimeout(() => {
        const sec = document.getElementById('store-characters')
          ?.closest('.store-section');
        if (sec) {
          sec.scrollIntoView({ behavior: 'smooth', block: 'center' });
          sec.classList.add('focus-flash');
          setTimeout(() => sec.classList.remove('focus-flash'), 2200);
        }
      }, 260);
    }
  } catch {}

  // 🔴 لو وصلت عناصر جديدة من Firestore (مستمع لحظي) → أعد الرسم فورًا
  const unsub = onCatalogChange(() => {
    if (document.getElementById('store-characters')) renderStore();
  });
  document.addEventListener('viewchange', function onLeave(e) {
    if (e.detail !== 'store') {
      unsub();
      stopWheelTicker();
      document.removeEventListener('viewchange', onLeave);
    }
  });
}

/* ==========================================================
 * 🖼️ بطاقة عنصر موحدة
 * ========================================================== */
function itemMedia(item) {
  if (item.image) {
    return `<img class="sc-img" src="${_esc(item.image)}" alt="" draggable="false">`;
  }
  return `<span class="sc-emoji">${item.emoji || '✨'}</span>`;
}

function cardHTML(item, { owned, equipped, actionAttr, extraInfo = '' }) {
  const equippedBadge = equipped
    ? `<div class="sc-equipped">${t('equippedTag')}</div>`
    : (owned ? `<div class="sc-owned">${t('ownedTag')}</div>` : '');
  const fresh = isItemFresh(item)
    ? `<div class="sc-fresh">${t('newTag', 'جديد')}</div>` : '';
  const free = (Number(item.price) || 0) === 0;
  const priceChip = owned ? '' : `<div class="sc-price">${free ? t('freeTag', 'مجاني') : `💎 ${item.price}`}</div>`;
  const btn = owned
    ? (equipped ? '' : `<button class="sc-btn equip" ${actionAttr}>${t('equip') || 'تجهيز'}</button>`)
    : `<button class="sc-btn buy" ${actionAttr}>${t('buyNow')}</button>`;
  return `
    <div class="store-item ${owned ? 'owned' : ''} ${equipped ? 'equipped' : ''}">
      ${fresh}
      ${equippedBadge}
      <div class="sc-media">${itemMedia(item)}</div>
      <div class="sc-name">${_esc(itemName(item))}</div>
      <div class="sc-desc">${_esc(item.desc || '')}</div>
      ${extraInfo}
      ${priceChip}
      ${btn}
    </div>`;
}

/** اسم العنصر (نص أو كائن لغات) */
function itemName(item) {
  return typeof item.name === 'string' ? item.name : (item.name?.ar || item.id);
}

/**
 * 🔀 خلط عشوائي للعرض فقط (طلب المستخدم): ترتيب الإدارة يظهر في
 * صفحة الأدمن بالتسلسل (1، 2، 3، 4) — أما المتجر فيعرضها عشوائيًا
 * في كل مرة، كي لا يكون الترتيب متوقعًا للاعب.
 */
function shuffleDisplay(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 📭 رسالة قسم فارغ — العناصر يضيفها المطور من صفحة الإدارة */
function emptyStrip(msg) {
  return `<div class="store-empty">${msg}</div>`;
}

/* ========================================================== */
function renderStore() {
  const p = getPlayer();
  document.getElementById('store-gems').textContent = p.gems;

  const chars = getStoreItems('characters');   // 🧩 موحّد: character + avatar
  const boosters = getStoreItems('boosters');

  /* --- 🎡 قرص الحظ — أعلى الشخصيات (طلب المستخدم) --- */
  renderLuckyWheel();
  startWheelTicker();

  /* --- ⚔️ الشخصيات (من قاعدة البيانات فقط — لا افتراضيات) --- */
  const cDiv = document.getElementById('store-characters');
  const ownedCharacterIds = new Set([...(p.ownedCharacters || []), ...(p.ownedAvatars || [])]);
  const availableChars = chars.filter(c => !ownedCharacterIds.has(c.id));
  cDiv.innerHTML = availableChars.length ? availableChars.map(c => {
    return cardHTML(c, {
      owned: false, equipped: false,
      actionAttr: `data-char="${_esc(c.id)}"`,
      extraInfo: `<button class="sc-preview" data-av-preview="${_esc(c.id)}" title="👁️">👁️</button>`
    });
  }).join('') : emptyStrip(chars.length
    ? t('allCharactersOwned', 'تمتلك جميع الشخصيات المتاحة')
    : t('noCharactersYet', 'لا تملك شخصيات حاليًا'));

  /* --- 🧰 الأدوات المساعدة (قابلة للشراء المتكرر — بالعلامات — عدّاد + ترتيب عشوائي) --- */
  const bDiv = document.getElementById('store-boosters');
  bDiv.innerHTML = boosters.length ? shuffleDisplay(boosters).map(b => `
    <div class="store-item">
      <div class="sc-owned">× ${p.boosters[b.grants || b.id] || 0}</div>
      <div class="sc-media">${itemMedia(b)}</div>
      <div class="sc-name">${_esc(itemName(b))}</div>
      <div class="sc-desc">${_esc(b.desc || _toolDesc(b))}</div>
      <div class="sc-price">${(Number(b.price) || 0) === 0 ? t('freeTag', 'مجاني') : `🏆 ${b.price}`}</div>
      <div class="sc-qty-row">
        <button class="sc-qty-step" type="button" data-qty-step="-1" aria-label="${t('decreaseQuantity', 'تقليل الكمية')}">−</button>
        <span class="sc-qty" id="sc-qty-${_esc(b.id)}" data-qty="${_esc(b.id)}"
              aria-label="${t('quantity', 'الكمية')}">1</span>
        <button class="sc-qty-step" type="button" data-qty-step="1" aria-label="${t('increaseQuantity', 'زيادة الكمية')}">+</button>
      </div>
      <div class="sc-total" data-total="${_esc(b.id)}">${t('totalPrice', 'لديك')}: 🏆 ${Number(b.price) || 0}</div>
      <button class="sc-btn buy" data-booster="${_esc(b.id)}">${t('buyNow')}</button>
    </div>`).join('') : emptyStrip(t('noToolsYet', 'لا توجد أدوات مساعدة حاليًا — يضيفها مطوّر اللعبة من لوحة الإدارة'));

  /* --- ربط الأحداث --- */
  // 🧩 الشخصية: شراء أو تجهيز (الزر نفسه يحمل data-char)
  cDiv.querySelectorAll('button.sc-btn[data-char]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.char;
      const owned = (p.ownedCharacters || []).includes(id)
        || (p.ownedAvatars || []).includes(id);
      const res = owned ? equipCharacter(id) : buyCharacter(id);
      notify(res.msg || '');
      if (res.ok !== false) { renderStore(); refreshTopbar(); }
    };
  });
  const updateBoosterTotal = (id) => {
    const item = boosters.find(b => b.id === id);
    const input = bDiv.querySelector(`[data-qty="${CSS.escape(id)}"]`);
    const total = bDiv.querySelector(`[data-total="${CSS.escape(id)}"]`);
    if (!item || !input || !total) return;
    const quantity = Number(input.textContent);
    total.textContent = `${t('totalPrice', 'لديك')}: 🏆 ${(Number(item.price) || 0) * quantity}`;
  };
  bDiv.querySelectorAll('[data-qty-step]').forEach(btn => {
    btn.onclick = () => {
      const card = btn.closest('.store-item');
      const quantity = card?.querySelector('[data-qty]');
      if (!quantity) return;
      quantity.textContent = String(Math.max(1, Number(quantity.textContent) + Number(btn.dataset.qtyStep)));
      updateBoosterTotal(quantity.dataset.qty);
    };
  });
  bDiv.querySelectorAll('[data-booster]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.booster;
      const quantity = Number(bDiv.querySelector(`[data-qty="${CSS.escape(id)}"]`)?.textContent);
      const res = buyBooster(id, quantity);
      notify(res.msg);
      if (res.ok) { renderStore(); refreshTopbar(); }
    };
  });

  // 👁️ معاينة الشخصية كبيرة
  cDiv.querySelectorAll('[data-av-preview]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openItemPreview(btn.dataset.avPreview);
    };
  });
}

/** وصف الأداة حسب نوعها (يضيفها المطور بالاسم المختار من قائمة) */
function _toolDesc(b) {
  const map = {
    skip:   t('toolSkipDesc', 'يمرّرك والخصم للسؤال التالي — يُستهلك من أسئلة الجولة'),
    swap:   t('toolSwapDesc', 'يستبدل سؤالك الحالي بسؤال جديد — يبقى ضمن أسئلة الجولة'),
    freeze: t('toolFreezeDesc', 'يمنع خصمك من الإجابة على أسئلة قادمة'),
    rename: t('toolRenameDesc', 'يسمح بتغيير اسمك فورًا حتى داخل قفل الـ60 يومًا')
  };
  return map[b.id] || '';
}

/* ==========================================================
 * 👁️ معاينة شخصية كبيرة
 * ========================================================== */
function openItemPreview(id) {
  const av = getStoreItems('characters').find(a => a.id === id);
  if (!av) return;
  const media = av.image
    ? `<img class="avp-img" src="${_esc(av.image)}" alt="">`
    : `<span class="avp-emoji">${av.emoji}</span>`;
  // 🗑️ بلا زر إغلاق سفلي — الإغلاق بعلامة ✕ أعلى النافذة فقط
  //   (كان يوجد زران للإغلاق: ✕ أعلى وزر أسفل — طلب المستخدم)
  openModal(itemName(av), `
    <div class="avatar-preview">
      <div class="avp-circle">${media}</div>
      <p class="avp-desc">${_esc(av.desc || '')}</p>
    </div>`, '');
}

/* ==========================================================
 * 💎 نافذة «الاسترداد والتبادل» — إعادة تصميم احترافية كاملة (v18)
 *    إطارات وقوالب وأزرار احترافية + أيقونات من مجلد icons/
 *    المرحلة 1: علامات الانتصار → جواهر (كل 10 = 1)
 *    المرحلة 2: جواهر → جوائز ذكاء (كل 100 = 1) — بشروط من الإدارة
 * ========================================================== */

/** ✔️ علامة الشرط — دائرة صح خضراء أو دائرة فارغة رمادية */
function _condCheckIco(ok) {
  return ok
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.4"
         stroke-linecap="round" stroke-linejoin="round" class="cwc-ico"><circle cx="12" cy="12" r="10" opacity=".35"/><path d="m8.5 12 2.5 2.5L16 9.5"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="rgba(148,163,184,.55)" stroke-width="2.2"
         stroke-linecap="round" class="cwc-ico"><circle cx="12" cy="12" r="10"/></svg>`;
}

function openConvertWindow() {
  let gemAmount = Math.min(Math.floor((getPlayer().tokens || 0) / TOKENS_PER_GEM), 5);
  let intelAmount = Math.min(Math.floor((getPlayer().gems || 0) / GEMS_PER_INTEL), 1);

  const render = () => {
    const me = getPlayer();
    const tokens = me.tokens || 0;
    const gems = me.gems || 0;
    const maxGems = Math.floor(tokens / TOKENS_PER_GEM);
    const maxIntel = Math.floor(gems / GEMS_PER_INTEL);
    // 🔄 أعد ضبط العدّادين لأقصى قيمة ممكنة بعد كل تحويل (لا قيم قديمة)
    gemAmount = Math.min(gemAmount, Math.min(maxGems, 5));
    intelAmount = Math.min(intelAmount, Math.min(maxIntel, 1));
    const unlocked = isIntelConvertUnlocked();
    const eco = getEconomyConfig() || {};
    const conds = eco.convertConditions || [];

    const condRows = conds.map(c => `
      <div class="cw-cond ${isConditionMet(c) ? 'met' : ''}">
        ${_condCheckIco(isConditionMet(c))}
        <span>${_esc(conditionLabel(c))}</span>
      </div>`).join('');

    openModal('🔄 ' + t('convertTitle'), `
      <div class="convert-win">

        <!-- ═══════════ المرحلة 1: علامات → جواهر ═══════════ -->
        <section class="cw-card tokens">
          <header class="cw-head">
            <span class="cw-head-ico">${icon('tokens')}</span>
            <div class="cw-head-texts">
              <b>${t('phaseMarks', 'علامات الانتصار ← جواهر')}</b>
              <span>${t('convertRate2', `كل ${TOKENS_PER_GEM} علامة انتصار = 1 جوهرة`)}</span>
            </div>
            <div class="cw-bal" title="${t('convertYourTokens', 'علاماتك الحالية')}">
              ${icon('tokens')}<b id="cw-tokens">${tokens}</b>
            </div>
          </header>

          <div class="cw-exchange">
            <div class="cw-side from">
              <span class="cw-x-ico">${icon('tokens')}</span>
              <b>${tokens}</b>
              <span>${t('convertYourTokens', 'علاماتك الحالية')}</span>
            </div>
            <div class="cw-x-arrow"><span class="cw-x-arrow-ico">${icon('back')}</span></div>
            <div class="cw-side to">
              <span class="cw-x-ico">${icon('gems')}</span>
              <b id="cw-preview">${Math.min(maxGems, gemAmount)}</b>
              <span>${t('convertYouGet', 'ستحصل على')}</span>
            </div>
          </div>

          <div class="cw-stepper">
            <button class="cw-step" id="cw-minus" aria-label="-">−</button>
            <div class="cw-val"><b id="cw-amount">${gemAmount}</b><span class="cw-val-ico">${icon('gems')}</span></div>
            <button class="cw-step" id="cw-plus" aria-label="+">+</button>
          </div>

          <div class="cw-quick">
            <button class="cw-q" data-cw="1">+1</button>
            <button class="cw-q" data-cw="5">+5</button>
            <button class="cw-q" data-cw="10">+10</button>
            <button class="cw-q max" data-cw="max">${t('convertAll', 'تحويل الكل')}</button>
          </div>

          <button class="cw-go ${gemAmount < 1 ? 'disabled' : ''}" id="cw-go">
            <span class="cw-go-ico">${icon('gems')}</span>
            <span class="cw-go-txt">${t('convert', 'تحويل')}</span>
            <span class="cw-go-calc" id="cw-go-label"></span>
          </button>
        </section>

        <!-- ═══════════ المرحلة 2: جواهر → جوائز ذكاء ═══════════ -->
        <section class="cw-card intel ${unlocked ? '' : 'locked'}">
          <header class="cw-head">
            <span class="cw-head-ico">${icon('intel')}</span>
            <div class="cw-head-texts">
              <b>${t('phaseIntel', 'الجواهر ← جوائز الذكاء')}</b>
              <span>${t('convertRate3', `كل ${GEMS_PER_INTEL} جوهرة = 1 جائزة ذكاء`)}</span>
            </div>
            <div class="cw-bal" title="${t('yourGems', 'جواهرك')}">
              ${icon('gems')}<b>${gems}</b>
            </div>
          </header>

          ${unlocked ? `
          <div class="cw-exchange">
            <div class="cw-side from">
              <span class="cw-x-ico">${icon('gems')}</span>
              <b>${gems}</b>
              <span>${t('yourGems', 'جواهرك')}</span>
            </div>
            <div class="cw-x-arrow"><span class="cw-x-arrow-ico">${icon('back')}</span></div>
            <div class="cw-side to">
              <span class="cw-x-ico">${icon('intel')}</span>
              <b id="cw-intel-preview">${Math.min(maxIntel, intelAmount)}</b>
              <span>${t('intelYouGet', 'جوائز ذكاء')}</span>
            </div>
          </div>

          <div class="cw-stepper">
            <button class="cw-step" id="ci-minus" aria-label="-">−</button>
            <div class="cw-val"><b id="ci-amount">${intelAmount}</b><span class="cw-val-ico">${icon('intel')}</span></div>
            <button class="cw-step" id="ci-plus" aria-label="+">+</button>
          </div>

          <div class="cw-quick">
            <button class="cw-q" data-ci="1">+1</button>
            <button class="cw-q" data-ci="5">+5</button>
            <button class="cw-q" data-ci="10">+10</button>
            <button class="cw-q max" data-ci="max">${t('convertAll', 'تحويل الكل')}</button>
          </div>

          <button class="cw-go ${intelAmount < 1 ? 'disabled' : ''}" id="ci-go">
            <span class="cw-go-ico">${icon('intel')}</span>
            <span class="cw-go-txt">${t('convertIntel', 'تحويل إلى جوائز ذكاء')}</span>
            <span class="cw-go-calc" id="ci-go-label"></span>
          </button>` : `
          <div class="cw-locked">
            <div class="cwl-head">
              <span class="cwl-ico">${icon('tune')}</span>
              <div class="cwl-texts">
                <b>${t('intelLocked', 'التحويل مقفل — استوفِ شرطًا واحدًا على الأقل')}</b>
                <span>${t('cwlSub', 'افتح التحويل بإكمال أحد الشروط التالية')}</span>
              </div>
            </div>
            <div class="cw-conds">${condRows || `<div class="cw-cond"><span class="cwc-empty">${icon('help')}</span><span>${t('noConditions', 'لم يحدد المطور شروطًا — التحويل متاح قريبًا')}</span></div>`}</div>
          </div>`}
        </section>
      </div>`,
      '');   // 🗑️ بلا زر إغلاق سفلي — الإغلاق بعلامة ✕ أعلى النافذة فقط
    document.querySelector('.modal-box')?.classList.add('convert-modal');

    /* --- ملصق حساب زر المرحلة 1 --- */
    const setGoLabel = () => {
      const el = document.getElementById('cw-go-label');
      if (el) el.innerHTML = `${gemAmount * TOKENS_PER_GEM} ${icon('tokens', 'mini')} ← ${gemAmount} ${icon('gems', 'mini')}`;
    };
    setGoLabel();

    /* --- مرحلة 1 --- */
    const clampGems = (v) => Math.max(0, Math.min(Math.floor((getPlayer().tokens || 0) / TOKENS_PER_GEM), v));
    const upd1 = () => {
      gemAmount = clampGems(gemAmount);
      const el = {
        amount: document.getElementById('cw-amount'),
        preview: document.getElementById('cw-preview'),
        go: document.getElementById('cw-go')
      };
      if (el.amount) el.amount.textContent = gemAmount;
      if (el.preview) el.preview.textContent = gemAmount;
      setGoLabel();
      if (el.go) el.go.classList.toggle('disabled', gemAmount < 1);
    };
    document.getElementById('cw-plus').onclick = () => { gemAmount = clampGems(gemAmount + 1); upd1(); };
    document.getElementById('cw-minus').onclick = () => { gemAmount = clampGems(gemAmount - 1); upd1(); };
    document.querySelectorAll('[data-cw]').forEach(b => {
      b.onclick = () => {
        const max = Math.floor((getPlayer().tokens || 0) / TOKENS_PER_GEM);
        gemAmount = b.dataset.cw === 'max' ? max : clampGems(gemAmount + parseInt(b.dataset.cw, 10));
        upd1();
      };
    });
    document.getElementById('cw-go').onclick = () => {
      if (gemAmount < 1) { notify(t('convertNeed5', `تحتاج ${TOKENS_PER_GEM} علامة على الأقل`)); return; }
      const res = convertTokensToGems(gemAmount);
      // 💎 v26: renderStore() أيضًا — كانت حبة الجواهر أعلى المتجر تبقى
      //    بالقيمة القديمة بعد التبادل (كانت تتحدث فقط عند إعادة فتح المتجر)
      if (res.ok) { notify(t('convertDone')); refreshTopbar(); renderStore(); render(); }
      else notify(res.msg);
    };

    /* --- مرحلة 2 (إن كانت مفتوحة) --- */
    const ciPlus = document.getElementById('ci-plus');
    if (ciPlus) {
      const setCiLabel = () => {
        const el = document.getElementById('ci-go-label');
        if (el) el.innerHTML = `${intelAmount * GEMS_PER_INTEL} ${icon('gems', 'mini')} ← ${intelAmount} ${icon('intel', 'mini')}`;
      };
      setCiLabel();
      const clampIntel = (v) => Math.max(0, Math.min(Math.floor((getPlayer().gems || 0) / GEMS_PER_INTEL), v));
      const upd2 = () => {
        intelAmount = clampIntel(intelAmount);
        document.getElementById('ci-amount').textContent = intelAmount;
        document.getElementById('cw-intel-preview').textContent = intelAmount;
        setCiLabel();
        document.getElementById('ci-go').classList.toggle('disabled', intelAmount < 1);
      };
      ciPlus.onclick = () => { intelAmount = clampIntel(intelAmount + 1); upd2(); };
      document.getElementById('ci-minus').onclick = () => { intelAmount = clampIntel(intelAmount - 1); upd2(); };
      document.querySelectorAll('[data-ci]').forEach(b => {
        b.onclick = () => {
          const max = Math.floor((getPlayer().gems || 0) / GEMS_PER_INTEL);
          intelAmount = b.dataset.ci === 'max' ? max : clampIntel(intelAmount + parseInt(b.dataset.ci, 10));
          upd2();
        };
      });
      document.getElementById('ci-go').onclick = () => {
        if (intelAmount < 1) { notify(t('convertNeedGems', `تحتاج ${GEMS_PER_INTEL} جوهرة على الأقل`)); return; }
        const res = convertGemsToIntel(intelAmount);
        // 💎 v26: توحيد تحديث كل الأرصدة الظاهرة بعد التحويل
        if (res.ok) { notify(res.msg); refreshTopbar(); renderStore(); render(); }
        else notify(res.msg);
      };
    }
  };

  render();
}
