// ui/profile.js — v6
// ============================================================
// 👤 الملف الشخصي الاحترافي:
//  - 🔒 تنبيه دائم للاعب التسجيل السريع لا يختفي إلا بربط Google
//  - 🔗 زر "المتابعة بحساب Google" مع هدية +10 علامات قبل الربط
//    وبعد الربط يظهر كبطاقة "مربوط ✓" مع البريد
//  - 🖼️ صورة الأفاتار المجهز من المتجر (أو العلم افتراضياً)
//  - 🌐 زر اللغة داخل الملف (نُقل من الصفحة الرئيسية)
//  - 🛠️ أيقونة الدعم الفني أعلى الشاشة مقابل زر الرجوع
//  - 🔒 الاسم لا يتغير إلا كل 60 يوماً
//  - أزرار حفظ/خروج بحجم مريح غير ضخم
// ============================================================

import {
  getPlayer, updatePlayer, renamePlayer, logoutPlayer, nameChangeInfo
} from '../auth.js';
import { saveProfile } from '../profile.js';
import { registerInDirectory } from '../friends.js';
import { getPlayerLevel } from '../lobby.js';
import {
  syncPlayerToFirestore, signOutFirebase, isNameTakenInCloud
} from '../firestore-sync.js';
import {
  auth, authReady, linkAccountWithGoogle, finishGoogleRedirect
} from '../firebase-config.js';
import { claimGoogleGift, bumpAwardCounter } from '../store.js';
import { getProfilePicture } from '../store-catalog.js';
import { getOverrideDataUrl } from './icons.js';
import { isSoundEnabled, setSoundEnabled } from '../game/sound.js';
import { intelligenceOf } from '../game/virtualPlayers.js';
import { getLangMeta } from '../i18n.js';
import { refreshTopbar } from './topbar.js';
import { notify, confirmDialog, modernDialog } from './helpers.js';
import { t, translateDOM } from '../i18n.js';
import { openSupportModal } from './support.js';
import { openModal, closeModal } from './modal.js';
import { icon } from './icons.js';

/** 🧭 موجّه الشاشات مُسجّل من app.js (تفادي الدورة الاستيرادية) */
let _navigate = null;
export function setNavigator(fn) { _navigate = fn; }

export function initProfile() {
  const p = getPlayer();
  if (!p) return;

  /* --- الحقول والإحصائيات ---
     📊 الإحصائيات (انتصارات/هزائم/مستوى) نُقلت إلى القسم العلوي
     من الصفحة الرئيسية (ui/mainMenu.js) بناءً على طلب المستخدم. */
  document.getElementById('profile-name').value = p.name;
  document.getElementById('profile-country').value = p.country;
  document.getElementById('profile-level').textContent = getPlayerLevel(p.wins);

  /* --- 🖼️ الأفاتار (صورة شخصية من المتجر) --- */
  renderAvatar(p);

  /* --- 💰 خزنة اللاعب + 🧠 مقياس الذكاء (v23 — طلب المستخدم) --- */
  renderVaultAndIQ(p);

  /* --- 🔒 قفل تغيير الاسم 60 يوماً --- */
  const nameInput = document.getElementById('profile-name');
  const info = nameChangeInfo();
  if (info.locked) {
    nameInput.readOnly = true;
    nameInput.classList.add('locked');
    const lockEl = document.getElementById('name-lock-hint');
    if (lockEl) {
      lockEl.textContent = `🔒 ${t('nameLocked')} ${info.remainingDays} ${t('days')}`;
      lockEl.classList.remove('hidden');
    }
  } else {
    nameInput.readOnly = false;
    nameInput.classList.remove('locked');
    document.getElementById('name-lock-hint')?.classList.add('hidden');
  }

  /* --- 🔗 حالة ربط Google --- */
  renderGoogleLink(p);

  /* --- 🛠️ الدعم الفني (أيقونة أعلى الشاشة) --- */
  const supBtn = document.getElementById('btn-support');
  if (supBtn) supBtn.onclick = openSupportModal;

  /* --- ⚙️ الإعدادات داخل الملف (طلب المستخدم v12):
          🔊 إيقاف/تشغيل كل الأصوات + 🌐 اللغة --- */
  initSoundSetting();
  renderLangState();

  /* --- 🌐 اللغة داخل الملف --- */
  const langBtn = document.getElementById('btn-lang-profile');
  if (langBtn) langBtn.onclick = openLanguageModal;

  /* --- 💾 حفظ — الزر مخفي ولا يظهر إلا عند وجود تغيير فعلي --- */
  const saveBtn = document.getElementById('btn-save-profile');
  const syncSaveVisibility = () => {
    const name = nameInput.value.trim();
    const country = document.getElementById('profile-country').value;
    const dirty = (name && name !== p.name) || country !== p.country;
    saveBtn.classList.toggle('hidden', !dirty);
  };
  nameInput.addEventListener('input', syncSaveVisibility);
  document.getElementById('profile-country').addEventListener('change', syncSaveVisibility);
  syncSaveVisibility();

  saveBtn.onclick = async () => {
    const name = document.getElementById('profile-name').value.trim();
    const country = document.getElementById('profile-country').value;

    if (!name) { notify(t('playerName')); return; }

    if (name !== p.name) {
      // 🆔 v29 — فحص الاسم الجديد من قاعدة البيانات فقط (لا قائمة محلية):
      //      الاسم ممنوع فقط إن كان لاعبًا نشطًا الآن؛ أسماء الحسابات
      //      المحذوفة حرة فورًا
      saveBtn.disabled = true;
      const taken = await isNameTakenInCloud(name).catch(() => false);
      saveBtn.disabled = false;
      if (taken) {
        notify('هذا الاسم محجوز لاعب آخر حاليًا — اختر اسماً آخر');
        syncSaveVisibility();
        return;
      }
      const res = renamePlayer(name, country);
      if (!res.ok) {
        if (res.nameLocked) {
          const stock = p.boosters?.rename || 0;
          notify(stock > 0
            ? `✏️ ${t('useRenameTool', 'الاسم مقفل — سيُستهلك أداة تغيير الاسم عند الحفظ')} (×${stock})`
            : `🔒 ${t('nameLocked')} ${res.remainingDays} ${t('days')}`);
        } else {
          notify(res.msg);
        }
        return;
      }
      registerInDirectory(res.player);
      await syncPlayerToFirestore(res.player);
      if (res.usedRenameToken) {
        bumpAwardCounter('toolUses', 1);   // 🧮 عدّاد استخدام الأدوات (شرط جوائز)
        notify('✏️ ' + t('renameTokenUsed', 'تم استخدام أداة تغيير الاسم — غيّرت اسمك رغم قفل الـ60 يومًا'), 'success');
      }
    } else {
      saveProfile(name, country);
      await syncPlayerToFirestore({ ...p, name, country });
    }

    notify(t('saved'), 'success');
    refreshTopbar();
    initProfile(); // تحديث حالة القفل + إخفاء الزر بعد الحفظ
  };

  /* --- 🚪 خروج — تحذير عصري للاعب التسجيل السريع غير المرتبط --- */
  document.getElementById('btn-logout').onclick = async () => {
    if (!isLinked()) {
      // ⚠️ غير مرتبط: خطر فقدان الحساب والبيانات — ننصح بالربط أولًا
      const choice = await modernDialog({
        title: '🚪 ' + t('logout'),
        message: t('logoutWarnUnlinked'),
        icon: 'warn',
        buttons: [
          { label: t('linkNow', 'اربط الحساب الآن'), value: 'link', cls: 'primary' },
          { label: t('logoutAnyway', 'تسجيل الخروج'), value: 'out', cls: 'danger' },
          { label: t('cancel', 'إلغاء'), value: null, cls: 'ghost' }
        ]
      });
      if (choice === 'link') {
        // افتح مسار الربط مباشرة
        document.getElementById('btn-link-google')?.click();
        return;
      }
      if (choice !== 'out') return;
    } else {
      const ok = await confirmDialog({
        title: t('logout'),
        message: t('logoutConfirm'),
        icon: 'info',
        okText: t('logout'),
        cancelText: t('cancel')
      });
      if (!ok) return;
    }

    await signOutFirebase();
    const result = logoutPlayer();
    if (result.ok) {
      notify(t('loggedOut') || 'تم تسجيل الخروج', 'success');
      const { navigate } = await import('../app.js');
      navigate('lang');
    }
  };
}

/* ==========================================================
 * 💰 خزنة اللاعب + 🧠 مقياس الذكاء (v23)
 *   المخزن: علامات الانتثار + الجواهر + جوائز الذكاء.
 *   الذكاء: نسبة تُحسب من الفوز/الخسارة — قيد القياس أول 20 جولة
 *   (شريط تقدّم ملوّن تفاعلي يوضح الباقي)، وبعدها تظهر النسبة
 *   وتتحدث لحظيًا مع كل جولة.
 * ========================================================== */
function renderVaultAndIQ(p) {
  // 💰 الخزنة
  const tk = document.getElementById('vault-tokens');
  const gm = document.getElementById('vault-gems');
  const it = document.getElementById('vault-intel');
  if (tk) tk.textContent = Number(p.tokens) || 0;
  if (gm) gm.textContent = Number(p.gems) || 0;
  if (it) it.textContent = Number(p.intel) || 0;

  // 🧠 مقياس الذكاء
  const iq = intelligenceOf(p.wins || 0, p.losses || 0);
  const valueEl = document.getElementById('iq-value');
  const fillEl = document.getElementById('iq-fill');
  const noteEl = document.getElementById('iq-note');
  const barEl = document.getElementById('iq-bar');
  if (!valueEl || !fillEl || !barEl) return;

  const gradFor = (pct) =>
    pct >= 75 ? 'linear-gradient(90deg,#22c55e,#4ade80)'
    : pct >= 50 ? 'linear-gradient(90deg,#eab308,#facc15)'
    : 'linear-gradient(90deg,#f97316,#fb923c)';

  if (iq.testing) {
    // 🧪 فترة القياس: شريط تقدّم نحو اكتمال 20 جولة
    const pct = Math.min(100, Math.round((iq.played / 20) * 100));
    valueEl.textContent = '⏳';
    fillEl.style.width = pct + '%';
    fillEl.style.background = 'linear-gradient(90deg,#06b6d4,#67e8f9)';
    barEl.classList.add('testing');
    barEl.classList.remove('done');
    if (noteEl) {
      noteEl.innerHTML = `${t('intelTestingTitle', '🎯 نسبة الذكاء قيد القياس')} — ${t('intelTestingCount', 'باقٍ للقياس')} <b>${iq.remaining}</b> ${t('intelRoundsWord', 'جولة')}`;
    }
  } else {
    // ✅ النسبة النهائية — لون حسب المستوى
    barEl.classList.remove('testing');
    barEl.classList.add('done');
    valueEl.textContent = iq.value + '%';
    fillEl.style.width = iq.value + '%';
    fillEl.style.background = gradFor(iq.value);
    if (noteEl) noteEl.textContent = t('intelTestingDesc', '');
  }
}

/* ==========================================================
 * ⚙️ الإعدادات — 🔊 الصوت (تشغيل/إيقاف كل الأصوات)
 * ========================================================== */
function initSoundSetting() {
  const btn = document.getElementById('btn-sound-toggle');
  if (!btn) return;
  const ico = document.getElementById('sound-ico');
  const state = document.getElementById('sound-state');
  const sw = document.getElementById('sound-switch');

  const syncUI = () => {
    const on = isSoundEnabled();
    if (ico) {
      // 🎨 الأيقونات من المكتبة المحلية (v13) — soundOn / soundOff
      ico.innerHTML = on ? icon('soundOn') : icon('soundOff');
    }
    if (state) state.textContent = on ? t('soundOn', 'مفعّلة') : t('soundOff', 'موقوفة');
    if (sw) sw.classList.toggle('on', on);
    btn.classList.toggle('muted-row', !on);
  };

  btn.onclick = () => {
    setSoundEnabled(!isSoundEnabled());
    syncUI();
    notify(isSoundEnabled()
      ? '🔊 ' + t('soundTurnedOn', 'تم تشغيل الأصوات')
      : '🔇 ' + t('soundTurnedOff', 'تم إيقاف الأصوات'), 'info');
  };

  syncUI();
}

/** 🌐 عرض اللغة الحالية بجانب صف اللغة */
function renderLangState() {
  const el = document.getElementById('lang-state');
  if (el) el.textContent = getLangMeta().name || getLangMeta(getLangSafe()).name;
}

/* ==========================================================
 * 🖼️ صورة الأفاتار — v14: الشخصية المجهزة والأفاتار القديم
 *   نفس المفهوم (صورة بروفايل تُشترى بالجواهر)
 *
 *   🛒 v24 (طلب المستخدم): الضغط على صورة اللاعب في الملف التعريفي
 *      ينقلك إلى المتجر — قسم الشخصيات مباشرة (لشراء شخصية جديدة
 *      أو تجهيزها).
 * ========================================================== */
export function renderAvatar(p) {
  const circle = document.querySelector('#view-profile .avatar-circle');
  if (!circle) return;
  const pic = getProfilePicture(p);
  if (pic?.image) {
    circle.innerHTML = `<img src="${pic.image}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
  } else if (pic?.emoji) {
    circle.textContent = pic.emoji;
  } else {
    // 🧩 v27 — الشخصية الافتراضية من لوحة الإدارة (يأخذها كل لاعب جديد مجانًا)
    const defUrl = getOverrideDataUrl('defaultAvatar');
    if (defUrl) {
      circle.innerHTML = `<img src="${defUrl}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    } else {
      circle.textContent = '👤';
    }
  }

  // 🛒 الضغط على الصورة → المتجر — قسم الشخصيات (طلب المستخدم v24)
  circle.style.cursor = 'pointer';
  circle.title = t('avatarGoStore', 'اضغط لاختيار شخصية من المتجر');
  circle.onclick = () => {
    try { sessionStorage.setItem('ba_store_focus', 'characters'); } catch {}
    if (_navigate) _navigate('store');
  };
}

/* ==========================================================
 * 🔗 ربط Google — تنبيه دائم + زر الربط + الهدية
 * ========================================================== */
function isLinked() {
  const u = auth.currentUser;
  return !!(u && u.email && !u.isAnonymous);
}

async function renderGoogleLink(p) {
  // ⏳ v32 — انتظر استعادة جلسة Firebase قبل الحكم على الربط:
  //    auth.currentUser يكون null حتى تُستعد الجلسة المحفوظة، ومن
  //    يقرأه قبل ذلك يظن الحساب غير مربوط فيظهر «اربط حسابك» خطأً
  //    رغم أن الحساب مربوط فعلاً (شكوى المستخدم في الملف التعريفي).
  try { await authReady(); } catch {}
  const alertEl = document.getElementById('google-alert');
  const linkBtn = document.getElementById('btn-link-google');
  const linkedCard = document.getElementById('google-link-card');
  const emailEl = document.getElementById('google-email');
  if (!alertEl || !linkBtn || !linkedCard) return;

  if (isLinked()) {
    // ✅ مربوط: أخفِ التنبيه وزر الربط، وأظهر بطاقة "مربوط"
    alertEl.classList.add('hidden');
    linkBtn.classList.add('hidden');
    linkedCard.classList.remove('hidden');
    emailEl.textContent = auth.currentUser.email;
    // 🩹 v32 — إصلاح ذاتي: الحساب مربوط في Firebase لكن التصنيف المحلي
    //    ما زال 'quick' (ربط اكتمل عبر Redirect لم يكتب الحقول مثلًا) —
    //    نصحح الحقول ونزامن حتى يصح تصنيف التسجيل في لوحة الإدارة.
    if (p.authProvider !== 'google' || p.email !== auth.currentUser.email) {
      try {
        updatePlayer({
          authProvider: 'google',
          linkedAfterQuick: p.authProvider === 'quick' ? true : !!p.linkedAfterQuick,
          email: auth.currentUser.email || p.email || ''
        });
        await syncPlayerToFirestore(getPlayer());
      } catch {}
    }
    return;
  }

  // ⚠️ غير مربوط: تنبيه دائم + زر الربط مع الهدية (إن لم تُستلم بعد)
  alertEl.classList.remove('hidden');
  linkedCard.classList.add('hidden');
  linkBtn.classList.remove('hidden');

  const gift = linkBtn.querySelector('.gl-gift');
  if (gift) gift.classList.toggle('hidden', !!p.googleGiftClaimed);

  linkBtn.onclick = async () => {
    linkBtn.disabled = true;
    linkBtn.classList.add('loading');
    const res = await linkAccountWithGoogle();
    linkBtn.classList.remove('loading');

    if (res.ok) {
      if (res.redirect) {
        // 🔄 مسار إعادة التوجيه (بيئات تحجب النوافذ) — الصفحة ستُعاد تحميلها
        linkBtn.disabled = true;
        notify(t('googleRedirecting'));
        return;
      }
      linkBtn.disabled = false;
      // 🎁 الهدية +5 جواهر (مرة واحدة) + تصنيف التسجيل لإحصاءات الأدمن:
      // من ربط بعد تسجيل سريع ينتقل إلى عدّاد "ربطوا بعد التسجيل السريع"
      const wasQuick = p.authProvider !== 'google';   // 🐞 إصلاح v24: كان prev غير معرّف
      updatePlayer({
        authProvider: 'google',
        linkedAfterQuick: wasQuick && !p.linkedAfterQuick ? true : !!p.linkedAfterQuick
      });
      const g = claimGoogleGift();
      await syncPlayerToFirestore(getPlayer());
      notify(g.ok ? t('linkedOk') : t('linkedOk'));
      refreshTopbar();
      initProfile();
    } else {
      linkBtn.disabled = false;
      if (!res.cancelled) notify(t('linkFailed'));
    }
  };
}

/** إكمال ربط Google عبر Redirect (عند العودة للصفحة) — يُستدعى من app.js */
export async function finishGoogleLinkIfNeeded() {
  const result = await finishGoogleRedirect();
  if (result?.user && !result.user.isAnonymous) {
    const g = claimGoogleGift();
    if (g.ok) await syncPlayerToFirestore(getPlayer());
    notify(t('linkedOk'));
    refreshTopbar();
    return true;
  }
  return false;
}

/* ==========================================================
 * 🌐 نافذة اللغة (نفس مُنتقي app.js — نُقلت هنا)
 * ========================================================== */
function openLanguageModal() {
  const modal = document.getElementById('modal');
  const title = document.getElementById('modal-title');
  const body = document.getElementById('modal-body');
  const actions = document.getElementById('modal-actions');

  title.textContent = '🌐 ' + t('language');

  const langNames = {
    ar: '🇸🇦 العربية', en: '🇬🇧 English', fr: '🇫🇷 Français',
    es: '🇪🇸 Español', de: '🇩🇪 Deutsch', it: '🇮🇹 Italiano',
    pt: '🇵🇹 Português', ru: '🇷🇺 Русский', tr: '🇹🇷 Türkçe',
    ur: '🇵🇰 اردو', fa: '🇮🇷 فارسی', hi: '🇮🇳 हिन्दी',
    bn: '🇧🇩 বাংলা', id: '🇮🇩 Indonesia', ms: '🇲🇾 Melayu',
    zh: '🇨🇳 中文', ja: '🇯🇵 日本語', ko: '🇰🇷 한국어',
    vi: '🇻🇳 Tiếng Việt', th: '🇹🇭 ไทย', nl: '🇳🇱 Nederlands',
    pl: '🇵🇱 Polski', uk: '🇺🇦 Українська', el: '🇬🇷 Ελληνικά',
    he: '🇮🇱 עברית', sw: '🇰🇪 Kiswahili', ha: '🇳🇬 Hausa',
    am: '🇪🇹 አማርኛ'
  };

  const optionsHTML = Object.entries(langNames).map(([code, label]) => `
    <button class="btn btn-secondary lang-option" data-lang="${code}">
      ${label}${getLangSafe() === code ? ' ✓' : ''}
    </button>
  `).join('');

  body.innerHTML = `<div class="lang-modal-list">${optionsHTML}</div>`;
  // ✕ v19: بلا زر إغلاق سفلي — الإغلاق بعلامة ✕ أعلى النافذة
  actions.innerHTML = '';
  modal.classList.remove('hidden');

  body.querySelectorAll('[data-lang]').forEach(el => {
    el.onclick = async () => {
      const newLang = el.dataset.lang;
      const { setLang } = await import('../i18n.js');
      setLang(newLang);
      closeModal();
      translateDOM();

      if (getPlayer()) {
        const { setPlayerLang } = await import('../auth.js');
        const { syncLangToFirestore } = await import('../firestore-sync.js');
        setPlayerLang(newLang);
        await syncLangToFirestore(newLang);
      }

      const { navigate } = await import('../app.js');
      navigate('profile');
    };
  });
}

function getLangSafe() {
  try { return localStorage.getItem('bqa_lang') || 'ar'; } catch { return 'ar'; }
}
