// ui/legal.js — v30
// ============================================================
// 📜 شروط الاستخدام وسياسة الخصوصية (طلب المستخدم — "هل لعبتي
//    أضيف فيها شروط الخصوصية والاستخدام كما في الألعاب؟")
//
//  • نافذة عارض بتبويبين: شروط الاستخدام | سياسة الخصوصية
//  • النصوص القابلة للتعديل بالكامل من لوحة الإدارة → قسم
//    الإعدادات (gameMeta/legal) — التغيير يصل لكل الأجهزة لحظيًا
//    (مستمع onSnapshot) ويتحدّث تلقائيًا إن كانت النافذة مفتوحة.
//  • إن لم يضبط المطور نصوصًا (حقول فارغة) تعمل اللعبة بنصوص
//    افتراضية احترافية مدمجة مكتوبة خصيصًا لهذه اللعبة.
//  • مواضع الدخول:
//      1) شاشة التسجيل — «بإنشائك حسابًا فأنت توافق على …»
//      2) صفحة الملف الشخصي → الإعدادات → «شروط الاستخدام وسياسة الخصوصية»
// ============================================================

import { openModal } from './modal.js';
import { getLang, t } from '../i18n.js';

const state = { loaded: false, terms: '', privacy: '', updatedAt: 0 };

/* ------------------------------------------------------------
 * 📜 النصوص الافتراضية (تُستخدم إن لم يضبطها المطور من اللوحة)
 * ------------------------------------------------------------ */
const DEFAULT_TERMS_AR = `## 1. وصف الخدمة
«معركة العقول» (Battle of the Minds) لعبة أسئلة ومسابقات ترفيهية عبر الإنترنت تمنح لاعبيها علامات انتصار وجواهر وجوائز ذكاء افتراضية داخل اللعبة. اللعبة مجانية بالكامل وتتحقق أرباحها من إعلانات المكافآت الاختيارية، ولا تتعامل بأي أموال حقيقية من اللاعبين.

## 2. الحساب والاسم
أنت مسؤول عن الحفاظ على سرية حسابك واسمه. يُمنع استخدام اسم مسيء أو مخالف للآداب أو انتحال اسم لاعب آخر، ويحق لإدارة اللعبة تجميد الحساب مؤقتًا أو حظر نهائي عند المخالفة. حذف حسابك من الإدارة يجعل اسمه متاحًا للاعبين الآخرين ولا يعيد أي محتويات سابقة إليك.

## 3. العملات والمحتويات الافتراضية
علامات الانتصار والجواهر وجوائز الذكاء والشخصيات والأدوات كلها محتويات افتراضية للاستخدام داخل اللعبة فقط، لا تملك قيمة نقدية حقيقية، ولا يمكن استبدالها بنقود أو تحويلها خارج اللعبة، وهي غير قابلة للاسترداد بعد استخدامها.

## 4. المتجر والشراء
الشراء داخل المتجر يكون بالعملات الافتراضية التي ربحتها باللعب. الأسعار والمحتويات وإتاحة الأدوات أو قرص الحظ وصندوق المكافآت تخضع لتعديل الإدارة في أي وقت.

## 5. الإعلانات
تتضمن اللعبة إعلانات مكافآت اختيارية (Rewarded Ads) عبر منصة Google AdMob: يظهر الإعلان فقط عندما تختار أنت المشاهدة مقابل مكافأة داخل اللعبة، ولا تُمنح المكافأة إلا بعد إكمال المشاهدة. يخضع عرض الإعلانات وحملها لسياسة خصوصية Google، وقد تستخدم Google معرّفات الإعلانات لتخصيص الإعلانات وفق إعدادات جهازك.

## 6. اللعب النظيف
يُمنع تمامًا: الغش أو استغلال الثغرات، إنشاء حسابات متعددة لنفس الشخص، التعديل غير المصرح به على بيانات اللعبة، أو إساءة استخدام نظام الأصدقاء والدعم الفني. تُرصد أنماط اللعب غير البشرية (إجابات فائقة السرعة بدقة عالية) إحصائيًا، والمخالفات تُعرّض الحساب للتجميد أو الحظر النهائي مع مصادرة أرصدته إلى خزنة اللعبة.

## 7. الجوائز
الجوائز الحقيقية إن وُجدت تُستلم عبر البيانات التي يسجلها اللاعب عند الطلب، وتُسلَّم خلال المدة المعلنة في اللعبة، والإدارة غير مسؤولة عن أخطاء بيانات التواصل التي يدخلها اللاعب.

## 8. تعديل الشروط
يجوز لإدارة اللعبة تحديث هذه الشروط في أي وقت، والاستمرار في استخدام اللعبة بعد التحديث يعني موافقتك على النسخة الجديدة.

## 9. العمر المناسب
اللعبة مناسبة لعمر 13 سنة فأكثر، ومن هم دون ذلك ينبغي أن يكون اللعب بموافقة ولي الأمر.`;

const DEFAULT_PRIVACY_AR = `## 1. البيانات التي نجمعها
نجمع الحد الأدنى اللازم لتشغيل اللعبة: اسم اللاعب، الدولة، مستوى التقدم والأرصدة داخل اللعبة، سجل الجولات، وإذا ربطت حسابك بـ Google نحفظ بريدك الإلكتروني لاستعادة تقدمك. لا نجمع أي بيانات حساسة ولا بيانات دفع لأن اللعبة لا تقبل أي أموال من اللاعبين.

## 2. الإعلانات وبيانات الطرف الثالث
تعرض اللعبة إعلانات مكافآت عبر منصة Google AdMob. عند تشغيل إعلان قد تصل بيانات جهازك ومعرّف الإعلانات (Advertising ID) إلى Google لتقديم الإعلان وقياس أدائه وفق سياسة خصوصية Google وبياناتك، ويمكنك تعطيل تخصيص الإعلانات من إعدادات جهازك. لا نرسل لشركاء الإعلانات أي بيانات من بيانات حسابك داخل اللعبة (اسمك أو أرصدتك).

## 3. كيف نستخدم البيانات
تُستخدم بياناتك حصرًا لتشغيل اللعبة: حفظ تقدمك، عرض المتصدرين، إدارة الأصدقاء، تسليم الجوائز، الدعم الفني، وحماية اللعبة من الغش عبر تحليل أنماط اللعب الإحصائية (مثل سرعة الإجابة والدقة).

## 4. التخزين والمشاركة
تُخزن البيانات بأمان على خدمات Google Firebase، ولا نبيع بياناتك ولا نشاركها مع أي طرف ثالث لأغراض إعلانية مباشرة. تُستخدم بيانات التواصل فقط لتسليم جوائزك إن فزت بها.

## 5. حقوقك
يمكنك في أي وقت تعديل اسمك ودولتك من ملفك الشخصي، أو حذف حسابك نهائيًا بالتواصل مع الدعم الفني أو عبر إدارة اللعبة — وبناءً على طلب الحذف تُحذف كل بياناتك وتُعاد أرصدتك إلى خزنة اللعبة ولا يمكن استرجاعها.

## 6. خصوصية الأطفال
لا نجمع عمدًا أي بيانات من أطفال دون 13 سنة بدون موافقة ولي الأمر. إن وجدنا حسابًا لطفل دون هذا العمر بلا إذن فقد نحذفه.

## 7. أمان المعلومات
نستخدم اتصالًا مشفرًا ونسخًا احتياطية لحماية بياناتك، وننصحك بعدم مشاركة كلمة مرور حساب Google المرتبط مع أي شخص.

## 8. تحديث السياسة
قد نحدّث سياسة الخصوصية من وقت لآخر، وسيظهر النص المحدّث في هذه الشاشة دائمًا.

## 9. التواصل
لأي سؤال عن الخصوصية أو بياناتك، افتح الدعم الفني من صفحة ملفك الشخصي وأرسل رسالتك — سنرد عليك داخل اللعبة.`;

/* النسخة الإنجليزية المختصرة لغير الناطقين بالعربية */
const DEFAULT_TERMS_EN = `## 1. About the Service
Battle of the Minds is an online trivia tournament game. All currencies (victory marks, gems, intel prizes) are virtual, for entertainment only, and have no real-money value. The game is free and funded by optional rewarded ads.

## 2. Accounts
Keep your account name appropriate. Offensive names, impersonation, cheating, multi-accounting or exploiting bugs may lead to a temporary freeze or a permanent ban, with balances returned to the game treasury.

## 3. Virtual Items
Marks, gems, intel prizes, characters and tools are licensed in-game items: no cash value, non-transferable, non-refundable once used.

## 4. Store
Store prices, items, wheel and box availability may change at any time by the game administration.

## 5. Ads
The game shows optional rewarded ads via Google AdMob. An ad plays only when you choose to watch it in exchange for an in-game reward, granted only after full viewing. Ad serving and measurement follow Google's own privacy policy; Google may use your device's advertising identifier per your device settings.

## 6. Prizes
If real prizes are offered they are delivered to the contact details you provide when claiming. The administration is not responsible for wrong contact data entered by the player.

## 7. Changes
These terms may be updated at any time; continuing to play means you accept the updated version.

## 8. Age
The game is intended for players aged 13+. Younger players should play with parental approval.`;

const DEFAULT_PRIVACY_EN = `## 1. Data We Collect
Minimum data needed to run the game: player name, country, in-game progress and balances, round history, and — if you link your Google account — your email for progress recovery. No payment data is ever collected.

## 2. Ads & Third Parties
The game serves rewarded ads via Google AdMob. When an ad plays, device data and the advertising identifier may reach Google for ad delivery and measurement under Google's own privacy policy. We never send your in-game account data (name or balances) to ad partners. You can disable ad personalization in your device settings.

## 3. How We Use It
Only to run the game: saving your progress, leaderboards, friends, prize delivery, support and anti-cheat (statistical play-pattern analysis such as answer speed and accuracy).

## 4. Storage
Data is stored securely on Google Firebase. We never sell or share your data with third parties for direct advertising. Contact data is used only to deliver your prizes.

## 5. Your Rights
You can edit your name/country in your profile, or request permanent deletion via in-game support — deletion removes all your data and returns balances to the game treasury.

## 6. Children
We do not knowingly collect data from children under 13 without parental consent.

## 7. Security
Encrypted connections and backups protect your data. Never share the password of the linked Google account.

## 8. Contact
Open in-game support from your profile page to ask anything about your data.`;

/* ------------------------------------------------------------
 * ☁️ تحميل النصوص من الإدارة + 🔴 مستمع لحظي
 * ------------------------------------------------------------ */
export async function loadLegalConfig() {
  try {
    const [{ db }, FS] = await Promise.all([
      import('../firebase-config.js'),
      import('https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js')
    ]);
    const snap = await FS.getDoc(FS.doc(db, 'gameMeta', 'legal'));
    if (snap.exists()) {
      const d = snap.data();
      state.terms = String(d.terms || '');
      state.privacy = String(d.privacy || '');
      state.updatedAt = d.updatedAt?.toMillis?.() || 0;
    }
    state.loaded = true;
  } catch {
    state.loaded = true;   // بلا اتصال — نكمل بالنصوص المدمجة
  }
  return state;
}

/** 🔴 مستمع لحظي — تعديل النصوص من لوحة الإدارة يصل فورًا */
export function watchLegalConfig() {
  (async () => {
    try {
      const FS = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js');
      const { db } = await import('../firebase-config.js');
      FS.onSnapshot(FS.doc(db, 'gameMeta', 'legal'), (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        const changed = String(d.terms || '') !== state.terms
          || String(d.privacy || '') !== state.privacy;
        state.terms = String(d.terms || '');
        state.privacy = String(d.privacy || '');
        state.updatedAt = d.updatedAt?.toMillis?.() || 0;
        if (changed) {
          try { window.dispatchEvent(new CustomEvent('legalchange')); } catch {}
        }
      }, () => {});
    } catch { /* بلا اتصال */ }
  })();
}

/** النصوص الفعّالة: الإدارة ☁️ ← الافتراضي المدمج 📜 */
export function getLegalTexts() {
  const en = getLang() === 'en';
  return {
    terms: state.terms.trim() || (en ? DEFAULT_TERMS_EN : DEFAULT_TERMS_AR),
    privacy: state.privacy.trim() || (en ? DEFAULT_PRIVACY_EN : DEFAULT_PRIVACY_AR)
  };
}

/* ------------------------------------------------------------
 * 🖼️ العارض — نافذة بتبويبين
 * ------------------------------------------------------------ */
const _esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** نص الشروط → HTML: السطور التي تبدأ بـ «## » عناوين والبقية فقرات */
function legalBodyHTML(text) {
  return String(text || '').split('\n').map(line => {
    if (line.startsWith('## ')) return `<h4>${_esc(line.slice(3))}</h4>`;
    if (!line.trim()) return '';
    return `<p>${_esc(line)}</p>`;
  }).join('');
}

function _legalMetaLine() {
  const en = getLang() === 'en';
  if (!state.updatedAt) {
    return en ? 'Last updated: built-in version' : 'آخر تحديث: النسخة المدمجة باللعبة';
  }
  const d = new Date(state.updatedAt);
  const date = en
    ? d.toLocaleDateString('en-GB')
    : d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  return `${en ? 'Last updated:' : 'آخر تحديث للنصوص:'} ${date}`;
}

/** 🪟 فتح نافذة الشروط والخصوصية (tab = 'terms' | 'privacy') */
export function openLegalViewer(tab = 'terms') {
  const render = (active) => {
    const { terms, privacy } = getLegalTexts();
    const body = active === 'privacy' ? privacy : terms;
    openModal('📜 ' + t('legalTitle', 'الشروط وسياسة الخصوصية'), `
      <div class="legal-view">
        <div class="legal-tabs">
          <button type="button" class="legal-tab ${active === 'terms' ? 'on' : ''}" data-legal-tab="terms">
            ${t('legalTermsTab', 'شروط الاستخدام')}
          </button>
          <button type="button" class="legal-tab ${active === 'privacy' ? 'on' : ''}" data-legal-tab="privacy">
            ${t('legalPrivacyTab', 'سياسة الخصوصية')}
          </button>
        </div>
        <div class="legal-body" id="legal-body">${legalBodyHTML(body)}</div>
        <div class="legal-meta">${_legalMetaLine()}</div>
      </div>`, '');

    document.querySelectorAll('[data-legal-tab]').forEach(btn => {
      btn.onclick = () => {
        if (btn.dataset.legalTab !== active) render(btn.dataset.legalTab);
      };
    });
  };
  render(tab === 'privacy' ? 'privacy' : 'terms');
}

/** 🧷 ربط مواضع الدخول (شاشة التسجيل + صفحة الملف الشخصي) */
export function initLegalLinks() {
  const reg = document.getElementById('btn-legal-register');
  if (reg) reg.onclick = () => openLegalViewer('terms');
  const prof = document.getElementById('btn-legal-profile');
  if (prof) prof.onclick = () => openLegalViewer('terms');

  // 🔴 النصوص تغيّرت من اللوحة والنافذة مفتوحة؟ أعد رسمها بالنص الجديد
  window.addEventListener('legalchange', () => {
    const bodyEl = document.getElementById('legal-body');
    if (!bodyEl) return;
    const active = document.querySelector('.legal-tab.on')?.dataset.legalTab || 'terms';
    renderLegalOpenBody(active);
  });
}

/** إعادة رسم متن العارض المفتوح فقط (بلا إغلاق النافذة) */
function renderLegalOpenBody(active) {
  const { terms, privacy } = getLegalTexts();
  const el = document.getElementById('legal-body');
  if (el) el.innerHTML = legalBodyHTML(active === 'privacy' ? privacy : terms);
  const meta = document.querySelector('.legal-meta');
  if (meta) meta.textContent = _legalMetaLine();
}
