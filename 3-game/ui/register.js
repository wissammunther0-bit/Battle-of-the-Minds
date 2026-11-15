// ui/register.js
import { createPlayer, getPlayer, updatePlayer } from '../auth.js';
import { registerInDirectory } from '../friends.js';
import { pullPlayerFromFirestore, syncPlayerToFirestore, isNameTakenInCloud } from '../firestore-sync.js';
import { signInWithGoogle, finishGoogleRedirect } from '../firebase-config.js';
import { setLang, getLang, t } from '../i18n.js';
import { navigate } from '../app.js';
import { notify } from './helpers.js';
// 🏦 v23 — كل لاعب جديد يأخذ 5 علامات انتصار من الخزان الرئيسي للعبة
import { tankNewPlayerCost } from '../game/economy.js';
// 👆 v24: صوت النقرات يعمل من لحظة الضغط على زر «متابعة» في بداية التسجيل
import { enableTapSound } from '../game/sound.js';

export function initRegister() {
  const quickBtn = document.getElementById('btn-quick-register');
  const form = document.getElementById('register-form');
  const googleBtn = document.getElementById('btn-google-login');
  const options = document.getElementById('register-options');
  const backBtn = document.getElementById('btn-back-to-lang');

  // إظهار نموذج الاسم — زر «متابعة» أول مسار تسجيل: من هنا تعمل النقرات
  quickBtn.onclick = () => {
    enableTapSound();            // 👆 (طلب المستخدم v24)
    form.classList.remove('hidden');
    options.classList.add('hidden');
  };

  // العودة لاختيار اللغة
  if (backBtn) backBtn.onclick = () => navigate('lang');

  // ✅ تسجيل الدخول بـ Google — «متابعة باستخدام Google» تفعّل النقرات أيضًا
  googleBtn.onclick = async () => {
    enableTapSound();              // 👆 (طلب المستخدم v24)
    googleBtn.disabled = true;
    const originalHTML = googleBtn.innerHTML;
    googleBtn.innerHTML = '<span>⏳ جاري الاتصال...</span>';

    try {
      const res = await signInWithGoogle();
      if (!res.ok) {
        // 🈯 v28 — الرسالة الآن عربية واضحة (مثل خطأ النطاق غير المصرّح)
        notify(res.msg, res.code === 'auth/unauthorized-domain' ? 'warn' : 'error');
        googleBtn.innerHTML = originalHTML;
        googleBtn.disabled = false;
        return;
      }

      // 🔄 v31.2 — إن انتقلنا لإعادة التوجيه (بيئات تعلّق النافذة المنبثقة
      //    على الهاتف) لا يوجد user الآن — العودة من التحويل تكمل الدخول تلقائيًا
      if (res.redirect) {
        googleBtn.innerHTML = '<span>🔄 يتم التحويل إلى Google — ستعود تلقائيًا…</span>';
        return;
      }

      const user = res.user;
      // ☁️ استعادة ملف Firebase قبل إنشاء ملف جديد حتى لا يُستبدل تقدم حساب موجود.
      const cloudPlayer = await pullPlayerFromFirestore();
      if (cloudPlayer?.name) {
        setLang(cloudPlayer.lang || getLang());
        registerInDirectory(cloudPlayer);
        navigate('main');
        return;
      }

      const displayNameRaw = (user.displayName || 'Player').slice(0, 16);
      const lang = getLang();

      // 🆔 v27/v29 — فحص الاسم من قاعدة البيانات فقط (لا قائمة محلية):
      //      الاسم ممنوع فقط إن كان لاعبًا نشطًا الآن؛ الأسماء المحذوفة
      //      من الإدارة حرة فورًا. إن كان محجوزاً نضيف لاحقة عشوائية مباشرة
      let displayName = displayNameRaw;
      if (await isNameTakenInCloud(displayName)) {
        displayName = displayNameRaw.slice(0, 12) + Math.floor(Math.random() * 999);
      }

      // إنشاء ملف محلي
      const localRes = createPlayer(displayName, 'SA', lang);
      let finalPlayer;

      if (!localRes.ok) {
        // الاسم مستخدم — أضف رقم عشوائي
        const uniqueName = displayName.slice(0, 12) + Math.floor(Math.random() * 999);
        const res2 = createPlayer(uniqueName, 'SA', lang);
        if (!res2.ok) {
          notify(res2.msg);
          googleBtn.innerHTML = originalHTML;
          googleBtn.disabled = false;
          return;
        }
        finalPlayer = res2.player;
      } else {
        finalPlayer = localRes.player;
      }

      // احفظ بيانات Google في ملف اللاعب — التسجيل المباشر بحساب Google
      updatePlayer({
        authProvider: 'google',
        linkedAfterQuick: false,
        email: user.email || '',
        photoURL: user.photoURL || '',
        googleUid: user.uid
      });
      tankNewPlayerCost(5);        // 🏦 5 علامات من الخزان الرئيسي

      // مزامنة مع Firestore
      await syncPlayerToFirestore({
        ...getPlayer(),
        authProvider: 'google',
        email: user.email || ''
      });

      registerInDirectory(getPlayer());
      navigate('main');

    } catch (e) {
      console.error(e);
      notify('حدث خطأ: ' + e.message);
      googleBtn.innerHTML = originalHTML;
      googleBtn.disabled = false;
    }
  };

  // 🔄 v31.2 — العودة من إعادة توجيه Google: Firebase يستعيد الجلسة تلقائيًا،
  //    فأكمل هنا نفس مسار المتابعة (استعادة الملف السحابي أو إنشاء ملف جديد)
  (async () => {
    try {
      const red = await finishGoogleRedirect();
      if (!red?.user) return;
      const user = red.user;

      const cloudPlayer = await pullPlayerFromFirestore();
      if (cloudPlayer?.name) {
        setLang(cloudPlayer.lang || getLang());
        registerInDirectory(cloudPlayer);
        navigate('main');
        return;
      }

      const displayNameRaw = (user.displayName || 'Player').slice(0, 16);
      const lang = getLang();
      let displayName = displayNameRaw;
      if (await isNameTakenInCloud(displayName)) {
        displayName = displayNameRaw.slice(0, 12) + Math.floor(Math.random() * 999);
      }

      const localRes = createPlayer(displayName, 'SA', lang);
      let finalPlayer;
      if (!localRes.ok) {
        const res2 = createPlayer(displayNameRaw.slice(0, 12) + Math.floor(Math.random() * 999), 'SA', lang);
        if (!res2.ok) { notify(res2.msg); return; }
        finalPlayer = res2.player;
      } else {
        finalPlayer = localRes.player;
      }

      updatePlayer({
        authProvider: 'google',
        linkedAfterQuick: false,
        email: user.email || '',
        photoURL: user.photoURL || '',
        googleUid: user.uid
      });
      tankNewPlayerCost(5);        // 🏦 5 علامات من الخزان الرئيسي

      await syncPlayerToFirestore({
        ...getPlayer(),
        authProvider: 'google',
        email: user.email || ''
      });

      registerInDirectory(getPlayer());
      navigate('main');
    } catch (e) {
      console.warn('[register] google redirect finish:', e);
    }
  })();

  // ✅ تأكيد التسجيل بالاسم (Anonymous)
  document.getElementById('btn-confirm-register').onclick = async () => {
    enableTapSound();              // 👆 تأكيد التسجيل يفعّل النقرات أيضًا
    const nameInput = document.getElementById('input-name');
    const name = nameInput.value.trim();
    const country = document.getElementById('select-country').value;
    const lang = getLang();

    if (!name) { notify(t('playerName')); return; }

    const confirmBtn = document.getElementById('btn-confirm-register');
    const originalTxt = confirmBtn.textContent;

    // 🆔 v29 — فحص الاسم من قاعدة البيانات فقط (طلب المستخدم):
    //    «فقط ممنوع استخدام اسم موجود حالياً» — أي اسم لاعب نشط الآن
    //    في Firebase. الأسماء المحذوفة (حتى من صفحة الإدارة) حرة فورًا
    //    — حُذفت القائمة المحلية bqa_used_names التي كانت تمنعها.
    confirmBtn.disabled = true;
    confirmBtn.textContent = '⏳ جاري التحقق…';
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
    confirmBtn.textContent = '⏳ جاري إنشاء الحساب…';

    // 🧾 تصنيف التسجيل (إحصاءات الأدمن): تسجيل سريع غير مرتبط
    updatePlayer({ authProvider: 'quick', linkedAfterQuick: false });
    tankNewPlayerCost(5);          // 🏦 5 علامات من الخزان الرئيسي

    registerInDirectory(res.player);
    await syncPlayerToFirestore(res.player);
    navigate('main');
  };
}