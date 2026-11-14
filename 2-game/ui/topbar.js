// ui/topbar.js — v16 (تصميم الرئيسية الجديد)
// ============================================================
// • يملأ الاسم + الجواهر + جوائز الذكاء في الشريط العلوي
// • يملأ الأفاتار السداسي الكبير (#hero-avatar) بصورة الشخصية المجهزة
// • يملأ شريط المستوى (#lvl-num / #lvl-fill / #lvl-frac)
// • كل العناصر اختيارية (فحص null) — يعمل مع أي شاشة تستدعيه
// ============================================================

import { getPlayer } from '../auth.js';
import { progressInLevel } from '../game/levels.js';
import { getFlag } from './helpers.js';
import { getProfilePicture } from '../store-catalog.js';
import { getDefaultAvatarImg } from './icons.js';

export function initTopbar() {
  refreshTopbar();
}

/** 🖼️ رسم صورة الأفاتار في أي حاوية (chip صغير أو سداسي كبير) */
function _paintAvatar(el, p) {
  if (!el) return;
  const pic = getProfilePicture(p);
  if (pic?.image) {
    el.innerHTML = `<img src="${pic.image}" alt="" draggable="false">`;
  } else if (pic?.emoji) {
    el.textContent = pic.emoji;
  } else {
    // 🧩 v27 — الشخصية الافتراضية من لوحة الإدارة (يأخذها كل لاعب جديد مجانًا)
    const def = getDefaultAvatarImg();
    if (def) el.innerHTML = def;
    else el.textContent = '👤';
  }
}

export function refreshTopbar() {
  const p = getPlayer();
  if (!p) return;

  const nameEl = document.getElementById('top-name');
  if (nameEl) nameEl.textContent = p.name;

  const tokensEl = document.getElementById('top-tokens');
  if (tokensEl) tokensEl.textContent = p.tokens;
  const gemsEl = document.getElementById('top-gems');
  if (gemsEl) gemsEl.textContent = p.gems;
  // 💎 v26: حبة الجواهر أعلى المتجر تُحدَّث من هنا أيضًا — كانت تبقى
  //    بالقيمة القديمة بعد التبادل (كان تحويل العلامات يحدّث النافذة
  //    والشريط العلوي للرئيسية فقط ولا يعيد رسم رأس المتجر)
  const storeGemsEl = document.getElementById('store-gems');
  if (storeGemsEl) storeGemsEl.textContent = p.gems;
  // 🧠 جوائز الذكاء (v11)
  const intelEl = document.getElementById('top-intel');
  if (intelEl) intelEl.textContent = p.intel || 0;

  // 📈 شريط المستوى — التقدم داخل المستوى الحالي (مصدر الحقيقة levels.js)
  const prog = progressInLevel(p.wins);
  const lvlChipEl = document.getElementById('top-level');
  if (lvlChipEl) lvlChipEl.textContent = 'Lv. ' + prog.level;
  const lvlNumEl = document.getElementById('lvl-num');
  if (lvlNumEl) lvlNumEl.textContent = prog.level;
  const lvlFillEl = document.getElementById('lvl-fill');
  if (lvlFillEl) lvlFillEl.style.width = prog.pct + '%';
  const lvlFracEl = document.getElementById('lvl-frac');
  if (lvlFracEl) lvlFracEl.textContent = `${prog.current}/${prog.needed}`;

  // 🧩 صورة البروفايل الموحّدة — الشريحة الصغيرة والسداسي الكبير معًا
  _paintAvatar(document.getElementById('top-avatar'), p);
  _paintAvatar(document.getElementById('hero-avatar'), p);

  // 🌍 العلم — عنصر اختياري (أُبقي للتوافق مع الشاشات القديمة)
  const flagEl = document.getElementById('top-flag');
  if (flagEl) flagEl.textContent = getFlag(p.country);
}
