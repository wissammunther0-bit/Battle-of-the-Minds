// game/rounds.js
// ============================================================
// 🎯 إدارة الأسئلة — النسخة v3 "نظام راند الانتصارات"
//
// ما الجديد:
//  - 11 سؤالًا للجولة (MAX_QUESTIONS)، وقت السؤال 12 ثانية (متعة بدل سرعة)
//  - السؤال الأول يُكتب مع startTimeMs في المستقبل (استعد 2.5 ث)
//  - السؤال التالي يُجهَّز ويُكتب في الوثيقة "أثناء" الاستراحة
//    (تحميل مسبق) ويُكشف لحظة حلول وقته عبر الساعة الموحدة
//  - إغلاق الأسئلة وقرارات نهاية المباراة انتقلت إلى
//    stateSync._closeRound (المضيف — الكاتب الوحيد)
//  - حُذف endRound والزلزال: مكان الاستراحة التفاعلية (breakTime)
// ============================================================

import { getRandomQuestion, getQuestionPoolCount } from '../questions.js';
import { localizeQuestionForMe } from './qtrans.js';
import { ensureAuth, db } from '../firebase-config.js';
import { doc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { serverNow, syncServerTime, getRtt } from './serverTime.js';
import {
  QUESTION_TIME, READY_MS, MAX_QUESTIONS,
  GRACE_BASE_MS, GRACE_MAX_MS, TIMER_TICK_MS, modeRules
} from './config.js';
import { t } from '../i18n.js';

export class Rounds {
  constructor(engine) {
    this.engine = engine;
  }

  /** نافذة السماح الفعلية لهذه الجولة */
  _graceMs() {
    const { engine } = this;
    const maxRtt = Math.max(getRtt(), engine.stateSync?.getMaxKnownRtt?.() || 0);
    return Math.min(GRACE_MAX_MS, GRACE_BASE_MS + Math.floor(maxRtt / 2));
  }

  /**
   * ✍️ كتابة السؤال (المضيف فقط — الكاتب الوحيد):
   * يُستخدم للسؤال الأول وعند طلب استبدال السؤال.
   * السؤال يُكتب مع startTimeMs في المستقبل → يصل للطرفين
   * ويُعرض على شاشة "استعد" ثم يُكشف تلقائيًا في وقته.
   *
   * @param {number} revealInMs — بعد كم من الوقت يُكشف السؤال
   * @param {object} opts — resetIndex: false عند الاستبدال
   *                        (يبقى رقم السؤال الحالي ولا يُصفَّر إلى 1)
   */
  async start(revealInMs = READY_MS, { resetIndex = true } = {}) {
    const { engine } = this;
    if (engine.isDestroyed || engine._ended) return;
    if (!engine.isHost) return;

    // 🚫 لا أسئلة في قاعدة البيانات؟ رسالة واضحة بلا انهيار —
    //    الأسئلة يضيفها المطور من صفحة الإدارة (طلب المستخدم)
    if (getQuestionPoolCount() === 0) {
      engine.breakTime.showNoQuestions();
      return;
    }

    // 🔄 تأكد من حداثة مزامنة الوقت قبل توليد سؤال جديد
    syncServerTime().catch(() => {});

    // ✅ نوع واحد بلا صعوبات (v12 — طلب المستخدم)
    const q = this._pickQuestion();
    const questionWithId = {
      ...q,
      id: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      startTimeMs: serverNow() + revealInMs   // ⏱️ لحظة الكشف بالساعة الموحدة
    };

    const idx = resetIndex ? 1 : Math.max(1, engine.questionIndex || 1);
    engine.currentQuestion = questionWithId;
    engine.questionIndex = idx;

    await ensureAuth();
    const gameRef = doc(db, 'gameStates', engine.roomId);
    await updateDoc(gameRef, {
      question: questionWithId,
      ...(resetIndex ? { questionIndex: 1 } : {}),
      answers: {},          // 🧹 خريطة إجابات جديدة (بلا تصادم: الكاتب وحده المضيف)
      lastResult: null,     // 🧹 لا نتيجة سابقة قبل الكشف
      swapRequest: null,
      updatedAt: serverTimestamp()
    }).catch(() => {});
  }

  /**
   * 🎲 اختيار سؤال غير معروض سابقًا (v12 — دورة بلا تكرار):
   * يستبعد كل ما عُرض على المشاركين البشر (rotationMemory)،
   * وعند استعراض كل الأسئلة تبدأ دورة جديدة تلقائيًا.
   * ✅ بنك واحد بنوع موحّد — بلا معامل صعوبة.
   */
  _pickQuestion() {
    const { engine } = this;
    let q = getRandomQuestion(engine.rotationMemory);
    if (!q) {
      // ✅ عُرضت جميع الأسئلة — دورة جديدة: تصفير الذاكرة المحلية
      engine.rotationMemory.clear();
      q = getRandomQuestion();
    }
    if (!q) return null;
    if (q.dbId) {
      engine.rotationMemory.add(q.dbId);
      engine.servedIds.push(q.dbId);   // يُحفظ في ذاكرة اللاعبين بالنهاية
    } else {
      engine.askedQuestions.add(q.q);  // توافق قديم (سؤال بلا معرف)
    }
    return q;
  }

  /**
   * 🖼️ عرض السؤال — v12:
   *   • يترجم السؤال وخياراته تلقائيًا إلى لغة هذا اللاعب أولًا
   *     (العربية تُعرض فورًا — والترجمة من الذاكرة/قاعدة البيانات
   *     شبه فورية بعد أول مرة) — كل لاعب يرى السؤال بلغته.
   *   • ثم يرسم النص والخيارات ويجدول المؤقت والبوتات.
   */
  async renderQuestion() {
    const { engine } = this;
    if (!engine.currentQuestion || engine._ended) return;

    // 🛑 سؤال جديد = إلغاء أي مهلة/تسوية معلّقة من السؤال السابق
    this.clearTimeouts();
    engine.stateSync?._clearRoundTimers?.();

    // 🌐 ترجمة للاعب الحالي (حارس تغيّر السؤال أثناء الترجمة)
    const qid = engine.currentQuestion.id;
    const shown = await localizeQuestionForMe(engine.currentQuestion);
    if (engine.isDestroyed || engine._ended) return;
    if (engine.currentQuestion?.id !== qid) return;   // تغيّر السؤال — تجاهل

    engine.el.qText.textContent = shown.q;
    engine.el.qOptions.innerHTML = '';
    engine.el.qOptions.classList.remove('has-two-options');

    // 🆕 v21: صف معلومات السؤال — بطاقة الجولة الذهبية بجانب نص
    //    «سابق في الإجابة واربح التحدي» — تُحدّث بنص النمط الحالي
    const meta = document.getElementById('q-meta');
    if (meta) {
      meta.innerHTML = `
        <span class="qm-round" data-el="round-chip">
          <span class="qmr-trophy" aria-hidden="true">🏆</span>
          <span data-el="round-text">—</span>
        </span>
        <span class="qm-chip gold">⚔️ ${t('qFirstWins', 'سابق في الإجابة واربح التحدي')}</span>`;
      // 🏆 ملء نص بطاقة الجولة من المصدر الواحد (يتضمن حالة السؤال الحاسم)
      engine.arena?.setRound?.(engine.questionIndex || 1);
    }

    // 🆕 v19: بطاقات خيارات حديثة — حرف ترتيب داخل دائرة لكل خيار
    const LETTERS = ['أ', 'ب', 'ج', 'د'];
    shown.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'option';
      btn.innerHTML = `<span class="opt-letter" aria-hidden="true">${LETTERS[idx] || '•'}</span>
                       <span class="opt-text"></span>`;
      btn.querySelector('.opt-text').textContent = opt;
      btn.onclick = () => engine.answers.handlePlayerAnswer(idx, btn);
      engine.el.qOptions.appendChild(btn);
    });

    this.startPreciseTimer();
    this.scheduleBots();
  }

  clearTimeouts() {
    const { engine } = this;
    if (engine.timer) { clearInterval(engine.timer); engine.timer = null; }
    if (engine.timeoutTimer) { clearTimeout(engine.timeoutTimer); engine.timeoutTimer = null; }
  }

  /**
   * ⏱️ مؤقت دقيق: يعيد الحساب في كل نبضة مباشرةً من الساعة الموحدة:
   *   remainingMs = QUESTION_TIME*1000 - (serverNow() - startTimeMs)
   * فلا يهم متى استقبل العميل السؤال ولا كم انحرفت ساعته —
   * العدّاد يظهر نفس القيمة على جميع الأجهزة في نفس اللحظة.
   */
  startPreciseTimer() {
    const { engine } = this;
    this.clearTimeouts();

    const startTimeMs = engine.currentQuestion.startTimeMs;
    if (!startTimeMs) return;

    const totalMs = QUESTION_TIME * 1000;
    const qid = engine.currentQuestion.id;
    const graceMs = this._graceMs();

    const tick = () => {
      if (engine.isDestroyed || engine._ended) {
        this.clearTimeouts();
        return;
      }
      // 🛡️ إذا تغيّر السؤال أثناء عمل المؤقت فالمؤقت قديم
      if (engine.currentQuestion?.id !== qid) {
        this.clearTimeouts();
        return;
      }

      const remainingMs = totalMs - (serverNow() - startTimeMs);
      const secs = Math.max(0, Math.ceil(remainingMs / 1000));

      engine.timeLeft = secs;
      if (engine.el.qTimer) {
        // 🆕 v20: العدّاد السداسي — الرقم داخل .tm-num (الأيقونة عنصر مستقل)
        const numEl = engine.el.qTimer.querySelector('.tm-num') || engine.el.qTimer;
        numEl.textContent = secs;
        if (secs <= 3) engine.el.qTimer.classList.add('warning');
        else engine.el.qTimer.classList.remove('warning');
      }

      if (remainingMs <= 0) {
        this.clearTimeouts();
        // ⏳ نافذة السماح التكيفية: ننتظر الإجابات الجارية في الشبكة.
        // إذا ظهر سؤال جديد خلال النافذة فأحدًا أجاب في وقته —
        // تُلغى معالجة المهلة تلقائيًا (renderQuestion يلغي المؤقتات).
        engine.timeoutTimer = setTimeout(() => {
          engine.timeoutTimer = null;
          if (engine.roundActive && !engine.isDestroyed && !engine._ended) {
            engine.answers.onTimeout();
          }
        }, graceMs);
      }
    };

    tick();
    engine.timer = setInterval(tick, TIMER_TICK_MS);
  }

  /**
   * 🤖 جدولة إجابات البوتات — على جهاز المضيف فقط (كاتب واحد):
   * إجابات البوتات تمر بنفس مسار الإجابات الملحقة الموحد،
   * فتخضع لنفس نافذة التسوية والعدالة.
   */
  scheduleBots() {
    const { engine } = this;
    engine.botTimers.forEach(t => clearTimeout(t));
    engine.botTimers = [];

    if (!engine.isHost) return; // 🔒 البوتات للكاتب الوحيد (المضيف) فقط

    const qid = engine.currentQuestion?.id;
    engine.characters.forEach(c => {
      c.controllers.forEach(ctrl => {
        if (!ctrl.isBot) return;
        // ❄️ بوت مجمّد بأداة تجميد الخصم؟ لا يجيب طوال مدة التجميد
        if (engine.isCharFrozen(c.id)) return;
        // ⏱️ v23 (طلب المستخدم): لحظة الإجابة داخل نافذة من الثانية
        //    الثالثة إلى الثانية الأخيرة من وقت السؤال — وكلما زاد
        //    مستوى اللاعب الافتراضي (المهارة) اقتربت اللحظة من بداية النافذة
        //    (سرعة أعلى) مع دقة اختيار أعلى (المهارة نفسها تحسم الصحيح).
        const skill = ctrl.skill ?? 0.62;
        // 🎚️ v24 (طلب المستخدم): شريطا الأدمن يتحكمان فعليًا —
        //    نافذة الإجابة (من أي ثانية إلى أي ثانية) + دقة الإجابة %
        const acc = (typeof ctrl.accuracy === 'number') ? ctrl.accuracy : skill;
        const minS = (typeof ctrl.answerWindow?.min === 'number') ? ctrl.answerWindow.min : 3;
        const maxS = (typeof ctrl.answerWindow?.max === 'number')
          ? Math.max(minS + 1, Math.min(QUESTION_TIME - 1, ctrl.answerWindow.max))
          : Math.max(minS + 1, QUESTION_TIME - 1);
        const skillShift = (1 - skill) * (maxS - minS - 1);            // الأعلى مهارة = أبكر
        const delayS = Math.min(maxS, minS + skillShift + Math.random() * 1.6);
        const t = setTimeout(() => {
          if (!engine.roundActive || engine.isDestroyed || engine._ended) return;
          if (engine.answeredThisRound.has(ctrl.id)) return;
          if (engine.isCharFrozen(c.id)) return;   // ❄️ حارس ثانٍ للتجميد
          // 🧩 قفل الفريق: زميل البوت في نفس الشخصية أجاب قبلهم؟ لا يجيب
          if (c.controllers.some(p => p.id !== ctrl.id && engine.answeredThisRound.has(p.id))) return;
          // 🛡️ حارس السؤال: تغيّر السؤال قبل إطلاق البوت؟ لا يجيب
          if (engine.currentQuestion?.id !== qid) return;
          if (Math.random() < acc) {
            engine.answers.handleBotAnswer(ctrl, c, engine.currentQuestion.correct, true);
          } else {
            engine.answers.handleBotAnswer(ctrl, c, -1, false);
          }
        }, delayS * 1000);
        engine.botTimers.push(t);
      });
    });
  }
}
