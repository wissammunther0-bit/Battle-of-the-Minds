// ui/langScreen.js
// ==========================================================
// شاشة اختيار اللغة — قائمة منسدلة
// ==========================================================

import { setLang, getLang, translateDOM, t, SUPPORTED_LANGS, LANG_META } from '../i18n.js';
import { hasPlayer, setPlayerLang } from '../auth.js';
import { syncLangToFirestore, syncPlayerToFirestore } from '../firestore-sync.js';
import { navigate, showView } from '../app.js';

let selectedLang = null;
let isOpen = false;
let listenersAttached = false;

export function initLangScreen() {
  selectedLang = getLang();

  const btn = document.getElementById('lang-selector-btn');
  const list = document.getElementById('lang-selector-list');
  const flagEl = document.getElementById('lang-selector-flag');
  const nameEl = document.getElementById('lang-selector-name');
  const continueBtn = document.getElementById('btn-continue-lang');

  if (!btn || !list) return;

  // بناء القائمة مرة واحدة
  if (!list.children.length) {
    buildList(list);
  }

  // تحديث الزر المعروض
  const updateTrigger = () => {
    const meta = LANG_META[selectedLang] || { name: selectedLang, flag: '🏳️' };
    flagEl.textContent = meta.flag;
    nameEl.textContent = meta.name;
    continueBtn.disabled = !selectedLang;
  };

  // فتح/إغلاق القائمة
  btn.onclick = (e) => {
    e.stopPropagation();
    toggleList();
  };

  const toggleList = () => {
    isOpen = !isOpen;
    btn.classList.toggle('open', isOpen);
    list.classList.toggle('open', isOpen);

    if (isOpen) {
      // مرّر للغة المختارة
      setTimeout(() => {
        const selected = list.querySelector('.lang-item.selected');
        if (selected) {
          selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }, 100);
    }
  };

  const closeList = () => {
    isOpen = false;
    btn.classList.remove('open');
    list.classList.remove('open');
  };

  // النقر خارج القائمة يغلقها
  if (!listenersAttached) {
    document.addEventListener('click', (e) => {
      if (!isOpen) return;
      const selector = document.getElementById('lang-selector');
      if (selector && !selector.contains(e.target)) {
        closeList();
      }
    });
    // Escape يغلق
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) closeList();
    });
    listenersAttached = true;
  }

  // اختيار لغة
  list.querySelectorAll('.lang-item').forEach(item => {
    item.onclick = (e) => {
      e.stopPropagation();
      const lang = item.dataset.lang;
      if (!lang) return;

      selectedLang = lang;

      // علم على العنصر المختار
      list.querySelectorAll('.lang-item').forEach(li => li.classList.remove('selected'));
      item.classList.add('selected');

      // تطبيق فوري
      setLang(lang);
      translateDOM();
      updateTrigger();
      closeList();
    };
  });

  // زر المتابعة
  continueBtn.onclick = async () => {
    if (!selectedLang) return;

    // 1) حفظ اللغة
    setLang(selectedLang);

    // 2) إذا كان هناك لاعب مسجّل → حدّث لغته + Firestore
    if (hasPlayer()) {
      const updated = setPlayerLang(selectedLang);
      if (updated) {
        await syncLangToFirestore(selectedLang);
        syncPlayerToFirestore(updated);
      }
      navigate('main');
    } else {
      // ليس هناك لاعب → التسجيل
      showView('register');
      translateDOM();
    }
  };

  updateTrigger();
  translateDOM();
}

/* ==========================================================
 * بناء قائمة اللغات
 * ========================================================== */
function buildList(list) {
  list.innerHTML = SUPPORTED_LANGS.map(code => {
    const meta = LANG_META[code] || { name: code.toUpperCase(), flag: '🏳️' };
    const isSelected = code === selectedLang;
    return `
      <li class="lang-item ${isSelected ? 'selected' : ''}" data-lang="${code}">
        <span class="lang-item-flag">${meta.flag}</span>
        <span class="lang-item-name">${meta.name}</span>
        <span class="lang-item-check">✓</span>
      </li>
    `;
  }).join('');
}