// game/answers.js
// ============================================================
// ✋ معالجة إجابات اللاعب + 🧰 أدوات المساعدة — النسخة v4 (v11)
//
//  - ❌ لا ضرر إطلاقًا (حُذف نظام HP — طلب المستخدم): الخطأ لا
//    يعاقب، والحسم بالانتصارات فقط.
//  - 🧰 أدوات المساعدة (تُشترى من المتجر ويديرها المطور):
//      ⏭️ تخطي السؤال  — يُتخطى السؤال على الطرفين (يُستهلك من
//                        الأسئلة الـ11 فيبقى 10) — بلا نقاط لأحد
//      🔄 تبديل السؤال — سؤال جديد بدل الحالي (يبقى ضمن الـ11)
//      ❄️ تجميد الخصم — الخصم لا يستطيع الإجابة على N أسئلة
//                        (N يحدده المطور من صفحة الأدمن)
//      ✏️ تغيير الاسم  — أداة استهلاكية من الملف الشخصي (ليست للجولة)
//  - 🔊 أصوات الإجابة: صحيحة (sound3) / خاطئة (sound4)
//  - 📊 عدّادات إجاباتي (صحيحة/خاطئة) + عدّادات استخدام الأدوات
//    (شرط جوائز الذكاء — تُصفَّر عند استلام جائزة)
// ============================================================

import { getPlayer, updatePlayer } from '../auth.js';
import { getPlayerLevel } from '../lobby.js';
import { consumeBooster, bumpAwardCounter } from '../store.js';
import { serverNow, getRtt } from './serverTime.js';
import { t } from '../i18n.js';
import { showGameToast } from '../ui/helpers.js';
import { sfxCorrect, sfxWrong } from './sound.js';
import { icon } from '../ui/icons.js';

export class Answers {
  constructor(engine) {
    this.engine = engine;
    // 🛡️ v41 (فحص — مشكلة 25): سقف الأدوات داخل الجولة لمنع Pay-to-win الناعم
    //   - أداة واحدة كحد أقصى من كل نوع لكل جولة (لا تخطّي مرتين)
    //   - 3 أدوات إجمالاً كحد أقصى لكل جولة
    //   - فاصل سؤالين بين كل استخدامين (لا تتالى الأدوات)
    this.toolsUsedThisRound = 0;
    this.toolsUsedByType = {};
    this.lastToolQuestionIdx = -10;
  }

  /** عدد الأسئلة التي يجمّدها اللاعب مباشرةً (1–3). */
  _freezeQty(questions = 1) {
    return Math.max(1, Math.min(3, Number(questions) || 1));
  }

  /** 🛡️ v41 — فحص سقف الأدوات قبل أي استخدام */
  _toolCapCheck(toolType) {
    const { engine } = this;
    if (!engine.currentQuestion) return false;
    const qIdx = engine.questionIndex || 0;
    // فاصل سؤالين بين الأدوات
    if (qIdx - this.lastToolQuestionIdx < 2 && this.lastToolQuestionIdx >= 0) {
      showGameToast('⏳ ' + t('toolCooldown', 'انتظر سؤالين قبل استخدام أداة أخرى'));
      return false;
    }
    // سقف إجمالي 3 أدوات لكل جولة
    if (this.toolsUsedThisRound >= 3) {
      showGameToast('🚫 ' + t('toolRoundCap', 'وصلت الحد الأقصى للأدوات في هذه الجولة (3)'));
      return false;
    }
    // سقف أداة واحدة من كل نوع
    if ((this.toolsUsedByType[toolType] || 0) >= 1) {
      showGameToast('🚫 ' + t('toolTypeCap', 'استخدمت هذه الأداة بالفعل في هذه الجولة'));
      return false;
    }
    return true;
  }

  /** 🛡️ v41 — تسجيل استخدام أداة (يُستدعى بعد الاستخدام الناجح) */
  _recordToolUse(toolType) {
    const { engine } = this;
    this.toolsUsedThisRound++;
    this.toolsUsedByType[toolType] = (this.toolsUsedByType[toolType] || 0) + 1;
    this.lastToolQuestionIdx = engine.questionIndex || 0;
  }

  /* ---------------- شريط الأدوات — ثابت وشفاف عند نفاد المخزون ---------------- */

  renderTools() {
    const { engine } = this;
    const bar = engine.el?.toolsBar;
    if (!bar) return;
    const stock = getPlayer()?.boosters || {};
    const tools = [
      { id: 'skip', tool: 'skip', ico: icon('skip2'), title: 'تخطي السؤال', sub: 'للطرفين' },
      { id: 'swap', tool: 'swap', ico: icon('swap'), title: 'تغيير السؤال', sub: 'للطرفين' },
      { id: 'freeze1', tool: 'freeze', ico: icon('freeze'), title: 'تجميد الخصم', sub: 'سؤال واحد' },
      { id: 'freeze2', tool: 'freeze', ico: `<span class="qt-ico-sm">${icon('freeze')}</span>${icon('freeze')}`, title: 'تجميد الخصم', sub: 'سؤالان' },
      { id: 'freeze3', tool: 'freeze', ico: `<span class="qt-ico-dbl">${icon('freeze')}${icon('freeze')}</span>`, title: 'تجميد الخصم', sub: '3 أسئلة' },
      // 🎨 v29 (طلب المستخدم): أداة «حذف خيارين» بأيقونة حقيقية من نظام
      //    الأيقونات — كانت نصًا ثابتًا "50:50" لا يمكن تغييره من الإدارة
      { id: 'fifty', tool: 'fifty', ico: icon('fifty'), title: 'حذف خيارين', sub: 'يبقى خياران' }
    ];
    bar.innerHTML = tools.map(item => {
      const count = Math.max(0, Number(stock[item.tool]) || 0);
      const unavailable = count === 0;
      return `<button type="button" class="q-tool ${item.id === 'skip' ? 'tool-skip' : ''} ${unavailable ? 'is-empty' : ''}" data-tool="${item.id}" title="${item.title} — ${item.sub}" aria-label="${item.title} — ${item.sub}" aria-disabled="${unavailable}">
        <span class="qt-ico">${item.ico}</span>
        <span class="qt-label">${item.title}<small>${item.sub}</small></span>
        <span class="qt-count">${count}</span>
      </button>`;
    }).join('');
    bar.querySelectorAll('[data-tool]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.tool;
        if (id === 'skip') this.useSkip();
        else if (id === 'swap') this.useSwap();
        else if (id === 'freeze1') this.useFreeze(1);
        else if (id === 'freeze2') this.useFreeze(2);
        else if (id === 'freeze3') this.useFreeze(3);
        else if (id === 'fifty') this.useFifty();
      };
    });
  }

  // 🔓 عند فشل شبكي نعيد فتح الإجابة للاعب ليحاول مجددًا
  _releaseLocalAnswer(controllerId) {
    const { engine } = this;
    engine.answeredThisRound.delete(controllerId);
    Array.from(engine.el.qOptions.children).forEach(o => {
      if (!o.classList.contains('correct') && !o.classList.contains('wrong')) {
        o.disabled = false;
      }
    });
  }

  // 🧾 بيانات مشتركة لكل إجابة: زمن الضغط بالساعة الموحدة + الاتصال + المستوى
  _answerMeta(choiceIdx) {
    const player = getPlayer();
    return {
      answeredAtMs: serverNow(),
      rttMs: getRtt(),
      choice: choiceIdx,
      level: getPlayerLevel(player?.wins || 0) || 2
    };
  }

  async handlePlayerAnswer(choiceIdx, btn) {
    const { engine } = this;
    if (!engine.roundActive || engine.isDestroyed) return;
    if (!engine.me || engine.answeredThisRound.has(engine.me.id)) return;
    if (!engine.currentQuestion) return;

    // ❄️ أنا مجمّد بأداة الخصم؟ لا إجابة خلال أسئلة التجميد
    if (engine.isCharFrozen(engine.myChar.id)) {
      showGameToast('❄️ ' + t('frozenYou', 'أنت مجمّد — لا تستطيع الإجابة الآن'));
      return;
    }

    // 🧩 قفل الفريق (2v2/4v4): الفريق يعمل ككتلة واحدة — أول إجابة
    //    تُرسل من أي عضو هي الإجابة النهائية المعتمدة للفريق كله،
    //    فتُقفل الخيارات فورًا على بقية الأعضاء لمنع تضارب الإجابات.
    const teamAnswerer = (engine.myChar?.controllers || [])
      .find(p => p.id !== engine.me.id && engine.answeredThisRound.has(p.id));
    if (teamAnswerer) {
      showGameToast('🔒 ' + t('teamLocked', 'قُفلت إجابات فريقك — زميلك أجاب أولًا'));
      return;
    }

    const meta = this._answerMeta(choiceIdx);
    const correct = choiceIdx === engine.currentQuestion.correct;
    engine.answeredThisRound.add(engine.me.id);

    // 🚩 v31 — عدادات سرعة الإجابة (كشف الغش من لوحة الإدارة):
    //    زمن الإجابة = لحظة الضغط (الساعة الموحدة) − لحظة كشف السؤال.
    //    الإنسان لا يصيب إجابات كثيرة متتالية في أقل من ثانيتين —
    //    من يفعل يظهر في قسم «اللاعبون المشبوهون» لتقرر الإدارة.
    const qStartMs = Number(engine.currentQuestion.startTimeMs) || 0;
    if (qStartMs > 0) {
      const answerMs = Math.max(0, Math.min(Number(meta.answeredAtMs) - qStartMs, 60000));
      const p = getPlayer() || {};
      updatePlayer({
        fastAnswers: (Number(p.fastAnswers) || 0) + (answerMs < 2000 && correct ? 1 : 0),
        totalAnswered: (Number(p.totalAnswered) || 0) + 1,
        answerMsSum: (Number(p.answerMsSum) || 0) + answerMs
      });
    }

    if (correct) {
      // ✅ صحيح — رد فعل فوري + صوت الإجابة الصحيحة (sound3)
      engine.myCorrect++;
      sfxCorrect();
      if (btn) btn.classList.add('correct');
      Array.from(engine.el.qOptions.children).forEach(o => { o.disabled = true; });

      // ⚔️ شريط المواجهة يندفع نحو الخصم + شرر + اهتزاز خفيف
      engine.animations.attack(engine.myChar.id);

      const ok = await engine.stateSync.submitAnswer(
        engine.me.id, engine.myChar.id, choiceIdx, true, meta
      );
      if (!ok) this._releaseLocalAnswer(engine.me.id);
    } else {
      // ❌ خطأ — بلا أي عقاب، فقط نخسر انتصار هذا السؤال + صوت الخطأ
      engine.myWrong++;
      sfxWrong();
      engine.arena?.react('me-wrong');
      if (btn) {
        btn.classList.add('wrong');
        btn.disabled = true;
      }

      const ok = await engine.stateSync.submitAnswer(
        engine.me.id, engine.myChar.id, choiceIdx, false, meta
      );
      if (!ok) this._releaseLocalAnswer(engine.me.id);
    }
  }

  async handleBotAnswer(controller, charData, choiceIdx, isCorrect) {
    const { engine } = this;
    if (!engine.roundActive || engine.isDestroyed) return;
    if (engine.answeredThisRound.has(controller.id)) return;
    if (!engine.currentQuestion) return;

    // ❄️ بوت مجمّد؟ لا يجيب
    if (engine.isCharFrozen(charData.id)) return;

    // 🧩 بوت ضمن فريق: زميله البشري (أو بوت آخر) أجاب قبلهم؟ الفريق مقفول
    const teamAnswerer = (charData.controllers || [])
      .find(p => p.id !== controller.id && engine.answeredThisRound.has(p.id));
    if (teamAnswerer) return;

    engine.answeredThisRound.add(controller.id);

    const meta = {
      answeredAtMs: serverNow(),
      rttMs: 0,      // البوت محاكاة محلية على جهاز المضيف
      choice: choiceIdx,
      level: 2,
      isBot: true
    };

    if (isCorrect) {
      engine.animations.attack(charData.id);
    }

    // 📨 بوتات المضيف تمر بنفس مسار الإجابات الملحقة الموحد —
    // فتخضع لنفس نافذة التسوية والعدالة
    const ok = await engine.stateSync.submitAnswer(
      controller.id, charData.id, choiceIdx, isCorrect, meta
    );
    if (!ok) engine.answeredThisRound.delete(controller.id);
  }

  /**
   * ⏰ انتهاء وقت السؤال (بعد نافذة السماح التكيفية من rounds.js).
   * المضيف يغلق السؤال بلا فائز — لا نقاط لأحد.
   */
  onTimeout() {
    const { engine } = this;
    if (!engine.roundActive) return;
    if (!engine.currentQuestion) return;
    const expectedQuestionId = engine.currentQuestion.id;

    engine.el.qText.textContent = '⏰ انتهى الوقت!';
    Array.from(engine.el.qOptions.children).forEach(o => { o.disabled = true; });

    if (!engine.isHost) return; // غير المضيف: الاستراحة القادمة تعرض النتيجة

    // ⚖️ إن كانت تسوية فائز جارية فالسؤال سيُغلق بإجابة صحيحة
    if (engine.stateSync.hasPendingSettlement()) return;
    engine.stateSync.closeRoundNoWinner(expectedQuestionId);
  }

  /* ------------------- 🧰 الأدوات داخل الجولة ------------------- */

  /** 🔒 حراسة مشتركة لكل الأدوات */
  _toolGuard() {
    const { engine } = this;
    if (!engine.roundActive || engine.isDestroyed) return false;
    if (!engine.currentQuestion) return false;
    return true;
  }

  /** 🧯 استهلاك مخزون + تحديث شريط الأدوات — مع تنبيه عند عدم التوفر */
  _consume(toolId) {
    const left = consumeBooster(toolId);
    if (left === false) {
      // 🛒 الأزرار ظاهرة دائمًا (تصميم v20) — النقر بلا مخزون يُنبه فقط
      showGameToast('🛒 ' + t('noToolStock', 'لا تملك هذه الأداة — اشترِها من المتجر'));
      return false;
    }
    bumpAwardCounter('toolUses', 1);   // 📊 عدّاد استخدام الأدوات (شرط جوائز)
    this.renderTools();
    return true;
  }

  /**
   * ⏭️ تخطي السؤال — يُتخطى على الطرفين معًا ويُستهلك من الأسئلة
   * الـ11 (فيبقى 10) بلا نقاط لأحد. (طلب المستخدم: الفرق بين التخطي
   * والتبديل أن التخطي يمرّ للسؤال التالي للطرفين بينما التبديل
   * يستبدل السؤال الحالي فقط)
   */
  async useSkip() {
    const { engine } = this;
    if (!this._toolGuard()) return;
    if (!this._toolCapCheck('skip')) return;          // 🛡️ v41 سقف الأدوات
    if (!this._consume('skip')) return;
    this._recordToolUse('skip');                      // 🛡️ v41 تسجيل الاستخدام

    const expectedQuestionId = engine.currentQuestion.id;
    engine.roundActive = false;
    engine.rounds.clearTimeouts();
    engine.answeredThisRound.clear();
    Array.from(engine.el.qOptions.children).forEach(o => o.disabled = true);
    engine.el.qText.textContent = '⏭️ ' + t('skippingQ', 'تم تخطي السؤال على الطرفين...');

    if (engine.isHost) {
      // المضيف يغلق السؤال كمُتخطّى ويجهّز التالي فورًا
      await engine.stateSync.closeRoundSkipped(expectedQuestionId);
    } else {
      // 📡 غير المضيف يطلب من المضيف (الكاتب الوحيد) التخطي
      engine.stateSync.pushSkipRequest(engine.me.id, expectedQuestionId);
    }
  }

  /** 🔄 تبديل السؤال — سؤال جديد بدل الحالي (يبقى ضمن الـ11) */
  useSwap() {
    const { engine } = this;
    if (!this._toolGuard()) return;
    if (!this._toolCapCheck('swap')) return;          // 🛡️ v41 سقف الأدوات
    if (!this._consume('swap')) return;
    this._recordToolUse('swap');                      // 🛡️ v41 تسجيل الاستخدام

    const expectedQuestionId = engine.currentQuestion.id;
    engine.rounds.clearTimeouts();
    engine.stateSync?._clearRoundTimers?.();
    engine.answeredThisRound.clear();
    engine.roundActive = false;
    Array.from(engine.el.qOptions.children).forEach(o => o.disabled = true);
    engine.el.qText.textContent = '🔄 ' + t('swappingQ', 'جاري استبدال السؤال...');

    if (engine.isHost) {
      engine.rounds.start(1200, { resetIndex: false }); // استراحة قصيرة ثم السؤال البديل (بلا تصفير العدّاد)
    } else {
      // 📡 غير المضيف يطلب من المضيف (الكاتب الوحيد) الاستبدال
      engine.stateSync.pushSwapRequest(engine.me.id, expectedQuestionId);
    }
  }

  /** 50:50 — إخفاء خيارين خاطئين على جهاز اللاعب الحالي فقط. */
  useFifty() {
    const { engine } = this;
    if (!this._toolGuard()) return;
    if (!this._toolCapCheck('fifty')) return;         // 🛡️ v41 سقف الأدوات
    const teamHasAnswered = (engine.myChar?.controllers || []).some(p => engine.answeredThisRound.has(p.id));
    if (teamHasAnswered) { showGameToast('🔒 لا يمكن استخدام الأداة بعد إجابة أحد أفراد فريقك'); return; }
    const options = Array.from(engine.el.qOptions.children);
    const wrong = options.filter((_, index) => index !== engine.currentQuestion.correct && !options[index].disabled);
    if (wrong.length < 2) {
      showGameToast('🧠 لا توجد إجابتان خاطئتان متاحتان للحذف');
      return;
    }
    if (!this._consume('fifty')) return;
    this._recordToolUse('fifty');                     // 🛡️ v41 تسجيل الاستخدام
    // اختيار عشوائي لخيارين خاطئين؛ لا تتغير الإجابة الصحيحة ولا حالة الطرف الآخر.
    for (let i = wrong.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [wrong[i], wrong[j]] = [wrong[j], wrong[i]];
    }
    engine.el.qOptions.classList.add('has-two-options');
    wrong.slice(0, 2).forEach(option => {
      option.disabled = true;
      option.classList.add('option-removed');
      option.setAttribute('aria-hidden', 'true');
    });
    showGameToast('✂️ تم حذف خيارين خاطئين — بقي خياران');
  }

  /**
   * ❄️ تجميد الخصم — لا يستطيع الإجابة طوال مدة التجميد.
   * v20 (التصميم المعتمد): ثلاثة أزرار — سؤال واحد / سؤالان /
   * 3 أسئلة (آلية التجميد
   * بالأسئلة كما هي، متزامنة بين الطرفين عبر وثيقة gameStates).
   * 🛠️ إصلاح خطأ عالي الخطورة (v12): كانت الأداة تُجمّد شخصيتي أنا
   *   بدل الخصم — الآن تُجمّد كل شخصيات الخصم (فردية/زوجية/رباعية)
   *   ولا تُهدر الأداة إن كان مجمّدًا فعلًا.
   */
  async useFreeze(questions = 1) {
    const { engine } = this;
    if (!this._toolGuard()) return;
    if (!this._toolCapCheck('freeze')) return;        // 🛡️ v41 سقف الأدوات

    // 🎯 شخصيات الخصم = كل الشخصيات غير شخصيتي (الفريق الخصم كتلة)
    const oppChars = (engine.characters || [])
      .filter(c => c.id !== engine.myChar?.id);
    if (!oppChars.length) return;

    // 🚫 لا تُهدر الأداة: الخصم مجمّد بالفعل بعد لحظة التجميد المطلوبة؟
    const qIdx = engine.questionIndex || 1;
    const qty = this._freezeQty(questions);
    // إذا أجاب الخصم بالفعل عن السؤال الحالي، يبدأ التجميد بالسؤال التالي؛ لا نحاول إلغاء إجابة مُرسلة.
    const opponentAlreadyAnswered = oppChars.some(c =>
      (c.controllers || []).some(p => engine.answeredThisRound.has(p.id))
    );
    const freezeFrom = qIdx + (opponentAlreadyAnswered ? 1 : 0);
    const untilIndex = freezeFrom + qty - 1;
    const allFrozen = oppChars.every(c =>
      (Number(engine.freezeMap?.[c.id]) || 0) >= untilIndex);
    if (allFrozen) {
      showGameToast('❄️ ' + t('oppAlreadyFrozen', 'الخصم مجمّد بالفعل — انتظر انتهاء تجميده'));
      return;
    }

    if (!this._consume('freeze')) return;
    this._recordToolUse('freeze');                    // 🛡️ v41 تسجيل الاستخدام

    const ok = await engine.stateSync.submitFreeze(
      oppChars.map(c => c.id), untilIndex);
    if (ok) {
      const patch = { ...engine.freezeMap };
      oppChars.forEach(c => { patch[c.id] = untilIndex; });
      engine.freezeMap = patch;
      engine.arena?.updateFreeze?.(engine.freezeMap);
      const countLabel = questions === 1 ? 'سؤال واحد' : questions === 2 ? 'سؤالين' : '3 أسئلة';
      showGameToast(`❄️ تم تجميد الخصم لمدة ${countLabel}`);
    }
  }
}
