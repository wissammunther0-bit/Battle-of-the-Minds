// ui/register.js — v41
import { createPlayer, getPlayer, updatePlayer } from '../auth.js';
import { registerInDirectory } from '../friends.js';
import { pullPlayerFromFirestore, syncPlayerToFirestore, isNameTakenInCloud, migrateLocalPlayerToCurrentUid } from '../firestore-sync.js';
// 🛡️ v41: زر Google حُذف من شاشة التسجيل (قرار المالك) — الربط بـ Google
//    يتم فقط من الملف الشخصي بعد إنشاء الحساب. مسار تسجيل واحد: سريع.
import { setLang, getLang, t } from '../i18n.js';
import { navigate } from '../app.js';
// 🎪 v33.5 — اللودر التفاعلي الممتع بدل الانتظار الملل
import { notify, showFunLoader, hideFunLoader } from './helpers.js';
// 🏦 v23 — كل لاعب جديد يأخذ 5 علامات انتصار من الخزان الرئيسي للعبة
import { tankNewPlayerCost } from '../game/economy.js';
// 👆 v24: صوت النقرات يعمل من لحظة الضغط على زر «متابعة» في بداية التسجيل
import { enableTapSound } from '../game/sound.js';

// 📜 v41 — إصدار الشروط والخصوصية (يُحدَّث عند تعديل النصوص)
const TERMS_VERSION = 'v41-2026-11-15';
const PRIVACY_VERSION = 'v41-2026-11-15';

export function initRegister() {
  const quickBtn = document.getElementById('btn-quick-register');
  const form = document.getElementById('register-form');
  const options = document.getElementById('register-options');
  const backBtn = document.getElementById('btn-back-to-lang');

  // 🛡️ v41: زر Google حُذف من شاشة التسجيل — لا مرجع له هنا
  const googleBtn = document.getElementById('btn-google-login');
  if (googleBtn) googleBtn.style.display = 'none';

  // إظهار نموذج الاسم — زر «متابعة» أول مسار تسجيل: من هنا تعمل النقرات
  quickBtn.onclick = () => {
    enableTapSound();            // 👆 (طلب المستخدم v24)
    form.classList.remove('hidden');
    options.classList.add('hidden');
  };

  // العودة لاختيار اللغة
  if (backBtn) backBtn.onclick = () => navigate('lang');

  // ✅ تأكيد التسجيل بالاسم (Anonymous) — v41: بوابة عمر 18+ + موافقة صريحة
  document.getElementById('btn-confirm-register').onclick = async () => {
    enableTapSound();              // 👆 تأكيد التسجيل يفعّل النقرات أيضًا
    const nameInput = document.getElementById('input-name');
    // 🛡️ v41 (فحص — مشكلة 9): checkbox العمر 18+ إلزامي
    const ageCheck = document.getElementById('check-age-18');
    if (ageCheck && !ageCheck.checked) {
      notify('⛔ ' + t('ageRequired', 'يجب تأكيد أن عمرك 18 سنة أو أكثر للتسجيل'));
      return;
    }
    // 🛡️ v41 (فحص — مشكلة 10): checkbox الموافقة على الشروط والخصوصية إلزامي
    const termsCheck = document.getElementById('check-terms');
    if (termsCheck && !termsCheck.checked) {
      notify('⛔ ' + t('termsRequired', 'يجب الموافقة على الشروط وسياسة الخصوصية للتسجيل'));
      return;
    }
    // 🛠️ v38 (فحص الأمان — مشكلة 11): تعقيم الاسم قبل أي شيء —
    //    طوله، فراغاته، ألفاظه (فلتر أساسي عربي/إنجليزي)
    const rawName = nameInput.value.trim().replace(/\s+/g, ' ');
    const country = document.getElementById('select-country').value;
    const lang = getLang();

    if (!rawName) { notify(t('playerName')); return; }
    if (rawName.length < 2) { notify('⚠️ الاسم قصير جدًا — حرفان على الأقل'); return; }
    const BAD_WORDS = [
      // عربي — الألفاظ الفاحشة والمخلة (بقوائم جزئية تتفادى التشكيل)
      'كلب', 'حمار', 'غبي', 'خرا', 'زبال', 'قذر', 'وسخ', 'شرموط', 'عاهر',
      'لوطي', 'منحرف', 'حقير', 'زبالة', 'تبا', 'لعنة', 'دمار', 'قحب',
      // إنجليزي — الأبجدية الفاحشة الكلاسيكية
      'fuck', 'shit', 'bitch', 'ass', 'dick', 'pussy', 'cunt', 'nigg',
      'whore', 'slut', 'retard', 'rape', 'porn'
    ];
    const _low = rawName.toLowerCase();
    if (BAD_WORDS.some(w => _low.includes(w))) {
      notify('⛔ الاسم غير لائق — اختر اسمًا محترمًا وفق شروط الاستخدام');
      return;
    }
    if (/https?:\/\/|www\.|\.com|wa\.me|t\.me/i.test(rawName)) {
      notify('⛔ الاسم لا يقبل روابط أو إعلانات'); return;
    }
    const name = rawName;

    const confirmBtn = document.getElementById('btn-confirm-register');
    const originalTxt = confirmBtn.textContent;

    // 🆔 v29 — فحص الاسم من قاعدة البيانات فقط (طلب المستخدم):
    //    «فقط ممنوع استخدام اسم موجود حالياً» — أي اسم لاعب نشط الآن
    //    في Firebase. الأسماء المحذوفة (حتى من صفحة الإدارة) حرة فوراً
    //    — حُذفت القائمة المحلية bqa_used_names التي كانت تمنعها.
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = `<span class="fun-dots"><i></i><i></i><i></i></span> ${t('verifyName', 'جارٍ التحقق من الاسم…')}`;
    const taken = await isNameTakenInCloud(name);
    if (taken) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = originalTxt;
      notify('هذا الاسم محجوز لاعب آخر حاليًا — اختر اسماً آخر');
      return;
    }

    const res = createPlayer(name, country, lang);
    if (!res.ok) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = originalTxt;
      notify(res.msg);
      return;
    }
    confirmBtn.innerHTML = `<span class="fun-dots"><i></i><i></i><i></i></span> ${t('creatingAccount', 'جارٍ إنشاء حسابك…')}`;

    // 🧾 تصنيف التسجيل (إحصاءات الأدمن): تسجيل سريع غير مرتبط
    // 📜 v41: تسجيل الموافقة الصريحة (عمر 18+ + شروط + خصوصية) بتوقيت وإصدار
    const now = Date.now();
    updatePlayer({
      authProvider: 'quick',
      linkedAfterQuick: false,
      agreedAdultAt: now,
      termsAcceptedAt: now,
      termsVersion: TERMS_VERSION,
      privacyAcceptedAt: now,
      privacyVersion: PRIVACY_VERSION
    });
    tankNewPlayerCost(5);          // 🏦 5 علامات من الخزان الرئيسي

    // 📜 v41: اكتب سجل الموافقة في Firestore (audit/consents/{uid}) —
    //    إثبات موافقة صريحة موثّقة بتوقيت وإصدار (متطلب PDPL/GDPR)
    try {
      const { ensureAuth, db } = await import('../firebase-config.js');
      const FS = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js');
      await ensureAuth();
      const user = (await import('../firebase-config.js')).auth.currentUser;
      if (user) {
        // 📜 v41.1: سجل الموافقة في consents/{uid} (مجموعة علوية بمسار صحيح).
        //    كان audit/consents/{uid} (3 مقاطع) — مسار غير صالح لـ doc()،
        //    وكتابة audit/consents الفارغة لم يكن لها قاعدة مطابقة فكانت تُرفض.
        await FS.setDoc(FS.doc(db, 'consents', user.uid), {
          uid: user.uid,
          agreedAdultAt: now,
          termsAcceptedAt: now,
          termsVersion: TERMS_VERSION,
          privacyAcceptedAt: now,
          privacyVersion: PRIVACY_VERSION,
          at: now
        });
      }
    } catch (e) { console.warn('[register] consent log failed:', e?.message); }

    registerInDirectory(res.player);
    // 🎪 v33.5 — لودر تفاعلي ممتع أثناء رفع الملف: سداسي نابض بشرارات
    //    دوّارة وشريط تقدم متلألئ — اللاعب يشاهد عرضًا لا انتظارًا
    showFunLoader(t('funLoaderSync', 'نجهز ساحة معركتك…'));
    try {
      await syncPlayerToFirestore(res.player);
    } finally {
      hideFunLoader();
    }
    navigate('main');
  };
}