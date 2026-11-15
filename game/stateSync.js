// game/stateSync.js
// ============================================================
// 🏗️ المزامنة — النسخة 4 (دفعة v11: بلا ضرر/HP — أدوات تخطي/تجميد)
//
// المعمارية (مبنية على دروس v2 — بلا معاملات في المسار الساخن):
//  1) الإجابات = كتابات ملحقة بمسارات نقطة:
//        answers.{qid}.{controllerId} = { at, correct, choice, ... }
//     لا تصادم أبدًا — كل لاعب يكتب مفتاحه الخاص فقط.
//  2) التحكيم بـ"زمن الضغط الموحد" (serverNow) وليس زمن الوصول:
//     المضيف يفتح نافذة تسوية بعد أول إجابة صحيحة ثم يعلن الفائز
//     صاحب أقدم ضغط — عدالة حقيقية للاتصالات البطيئة.
//  3) 🏆 الانتصارات: خريطة wins.{charId} عبر increment —
//     كل سؤال انتصار واحد، والطرفان يبدآن بصفر.
//  4) 🗑️ حُذف الضرر/HP والدروع كليًا (طلب المستخدم) — الحسم
//     بالانتصارات فقط عبر شريط المواجهة.
//  5) 🧰 أدوات المساعدة عبر الوثيقة:
//      skipRequest — طلب تخطي السؤال (يُتخطى على الطرفين بلا نقاط)
//      freeze.{charId} — تجميد حتى رقم سؤال (لا إجابة خلاله)
//  6) 🧠 مدير المباراة (_closeRound — المضيف الكاتب الوحيد):
//     يقرر بعد كل سؤال: اكتملت 11 أسئلة بفارق؟ تعادل → سؤال حاسم؟
//     ويُجهِّز السؤال التالي "أثناء" الاستراحة.
//  7) 📋 lastResult: نتيجة السؤال المنتهي تُكتب في الوثيقة لتعرضها
//     لوحة الاستراحة التفاعلية على جهازي الطرفين.
// ============================================================

import { ensureAuth, db } from '../firebase-config.js';
import {
  doc, onSnapshot, updateDoc, setDoc, getDoc, serverTimestamp, increment
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { serverNow, SESSION_ID } from './serverTime.js';
import {
  MAX_QUESTIONS, BREAK_MS,
  SETTLE_SOLO_MS, SETTLE_BASE_MS, SETTLE_MAX_MS,
  INTRO_MS, REJOIN_WINDOW_MS, modeRules
} from './config.js';
import { sfxWrong } from './sound.js';

const REVEAL_EPS_MS = 400;   // سماحية الكشف الفوري للسؤال

export class StateSync {
  constructor(engine) {
    this.engine = engine;
    this.unsubscribe = null;
    this._lastQuestionId = null;
    this._lastEventSeq = null;   // 🧾 تسلسل الأحداث لمنع إعادة الأنيميشن
    this._lastSwapKey = null;    // 🔄 آخر طلب استبدال سؤال
    this._lastSkipKey = null;    // ⏭️ آخر طلب تخطي سؤال
    this._lastFreezeSig = null;  // ❄️ آخر توقيع خريطة التجميد
    this._lastGameData = null;   // 📸 آخر لقطة كاملة (للتسوية والقرارات)
    this._settleTimer = null;    // ⚖️ مؤقت تسوية الفائز
    this._allWrongTimer = null;  // 🌍 مؤقت إغلاق "الجميع أخطأ/لم يجب"
    this._maxKnownRtt = 0;       // 📡 أسوأ اتصال معروف بين اللاعبين
    this._closingQid = null;     // 🔒 قفل ضد الإغلاق المزدوج لنفس السؤال
    this._forfeitWritten = false; // 🚪 قفل تسجيل الانسحاب (مرة واحدة)
    this._roundStats = {};       // 📊 إحصائيات الجولة الحالية لكل لاعب (شاشة النهاية)
    this._statsSeen = new Set(); // 🔑 qid|controllerId — ضد احتساب نفس الإجابة مرتين
  }

  /* ------------------- واجهات مساعدة ------------------- */

  getMaxKnownRtt() { return this._maxKnownRtt; }

  /** 📊 إحصائيات هذه الجولة فقط (لكل لاعب: أجاب/صحيحة/خاطئة) —
   *  تُغذّى من اللقطات وتُستهلك في شاشة نهاية المباراة */
  getRoundStats() { return this._roundStats || {}; }

  hasPendingSettlement() {
    return !!(this._settleTimer || this._allWrongTimer);
  }

  _noteRtt(rtt) {
    if (Number.isFinite(rtt) && rtt > this._maxKnownRtt) this._maxKnownRtt = rtt;
  }

  /** مدة نافذة التسوية: فورية تقريبًا مع البوتات، متناسبة مع
   *  أسوأ RTT معروف في اللعب الأونلاين */
  _settleDelayMs() {
    const { engine } = this;
    const hasRemoteHumans = engine.characters.some(c =>
      c.controllers.some(p => !p.isBot && p.id !== engine.me?.id));
    if (!hasRemoteHumans) return SETTLE_SOLO_MS;
    return Math.min(SETTLE_MAX_MS, SETTLE_BASE_MS + Math.floor(this._maxKnownRtt / 2));
  }

  _clearRoundTimers() {
    if (this._settleTimer) { clearTimeout(this._settleTimer); this._settleTimer = null; }
    if (this._allWrongTimer) { clearTimeout(this._allWrongTimer); this._allWrongTimer = null; }
  }

  /** إجابات السؤال الحالي من آخر لقطة (مرشحة بمعرف السؤال) */
  _currentRoundAnswers() {
    const data = this._lastGameData;
    const qid = data?.question?.id;
    if (!data || !qid) return {};
    return data.answers?.[qid] || {};
  }

  /* ------------------- الاشتراك اللحظي ------------------- */

  subscribe() {
    const { engine } = this;
    const gameRef = doc(db, 'gameStates', engine.roomId);

    this.unsubscribe = onSnapshot(gameRef, (snap) => {
      if (!snap.exists() || engine.isDestroyed) return;
      const data = snap.data();
      this._lastGameData = data;

      // 🛑 1. انتهاء المباراة (فوز/خسارة/ضربة قاضية/انسحاب) —
      //      مسار واحد موحد: شاشة النهاية تتكفل بالحفظ والسجل والصداقة
      //      🛡️ v25: .catch مع شاشة نهاية احتياطية — لا تعليق مهما حدث
      if (data.status === 'ended' && !engine._ended) {
        engine._ended = true;
        engine.roundActive = false;
        engine.rounds.clearTimeouts();
        this._clearRoundTimers();
        engine.botTimers.forEach(t => clearTimeout(t));
        Promise.resolve(engine.endGame.showEndScreen(data)).catch((err) => {
          console.warn('[stateSync] فشل بناء شاشة النهاية — عرض شاشة احتياطية:', err?.message || err);
          this._fallbackEndScreen(data);
        });
        return;
      }

      if (engine._ended) return;

      // 🧮 2. مزامنة رقم السؤال من السيرفر (المصدر الرسمي)
      if (typeof data.questionIndex === 'number') {
        engine.questionIndex = Math.max(engine.questionIndex, data.questionIndex);
        engine.arena?.setRound?.(data.questionIndex); // 🕐 شارة "السؤال x/11"
      }

      // ⚡ 3. سؤال جديد: استراحة تفاعلية ثم كشف مؤجل — أو كشف فوري
      //      (السؤال جُهِّز وكُتب في الوثيقة أثناء الاستراحة سلفًا)
      if (data.question && data.question.id && data.question.id !== this._lastQuestionId) {
        this._lastQuestionId = data.question.id;
        this._clearRoundTimers();
        this._closingQid = null;
        engine.currentQuestion = data.question;
        engine.answeredThisRound.clear();
        engine.roundActive = false;

        const waitMs = (data.question.startTimeMs || 0) - serverNow();
        if (waitMs > REVEAL_EPS_MS) {
          if (!data.lastResult && (data.questionIndex || 1) <= 1
              && engine.breakTime.isIntroActive()) {
            // 📖 السؤال الأول يحدّث موعد كشف التعليمات نفسها، ولا ينشئ شاشة شرح ثانية.
            engine.breakTime.scheduleIntroReveal(data.question.startTimeMs);
          } else {
            // ⏸️ الاستراحة التفاعلية — تعرض النتيجة + لوحة النقاط + العدّاد
            engine.breakTime.show({
              pendingQuestion: data.question,
              lastResult: data.lastResult || null,
              wins: data.wins || {},
              questionIndex: data.questionIndex || 1
            });
          }
        } else {
          engine.breakTime.hide();
          engine.rounds.renderQuestion();
          engine.roundActive = true;
        }
      }

      // 📋 4. الإجابات الملحقة للسؤال الحالي — من أجاب حتى الآن
      const qid = data.question?.id;
      const roundAnswers = (qid && data.answers?.[qid]) || {};
      Object.keys(roundAnswers).forEach(id => {
        engine.answeredThisRound.add(id);
        this._noteRtt(roundAnswers[id]?.rttMs || 0);
      });

      // 📊 4-ب: تغذية إحصائيات الجولة (بيانات هذه الجولة فقط —
      //      للعرض في شاشة النهاية، بلا أي إحصائيات تراكمية)
      // 🔊 4-ج: أصوات الإجابات (طلب المستخدم v23):
      //    ❌ الإجابة الخاطئة تُسمع عند الطرفين في النمط الفردي —
      //    ✅ الإجابة الصحيحة يسمعها صاحبها فقط (تُشغَّل محليًا عنده)،
      //    🧨 وفي الأنماط الجماعية الأصوات كلها خاصة بصاحبها
      //       (لا فوضى صوتية مع كثرة اللاعبين).
      Object.entries(roundAnswers).forEach(([id, v]) => {
        const key = qid + '|' + id;
        if (this._statsSeen.has(key)) return;
        this._statsSeen.add(key);
        const s = this._roundStats[id]
          || (this._roundStats[id] = { answered: 0, correct: 0, wrong: 0, charId: v.charId || null });
        s.answered++;
        if (v.charId) s.charId = v.charId;
        if (v.correct) s.correct++; else s.wrong++;
        // 🔊 صوت الخطأ عند الطرفين (فردي فقط — إجابة لاعب آخر خاطئة)
        const solo = modeRules(engine.match?.mode).firstTo === 0;
        if (solo && id !== engine.me?.id && !v.correct && !v.skipped) {
          try { sfxWrong(); } catch {}
        }
      });

      // 🏆 5. مزامنة الانتصارات — ⚔️ موضع شريط المواجهة (نفس النسبة
      //     على الجهازين) — لا شريط صحة بعد الآن (حُذف الضرر)
      const winsSig = JSON.stringify(data.wins || {});
      if (winsSig !== this._lastWinsSig) {
        this._lastWinsSig = winsSig;
        engine.wins = { ...(data.wins || {}) };
        engine.arena?.updateWins(engine.wins);
      }

      // ❄️ 5-ب: مزامنة خريطة التجميد (أداة تجميد الخصم)
      const freezeSig = JSON.stringify(data.freeze || {});
      if (freezeSig !== this._lastFreezeSig) {
        this._lastFreezeSig = freezeSig;
        engine.freezeMap = { ...(data.freeze || {}) };
        engine.arena?.updateFreeze?.(engine.freezeMap);
      }

      // 🎬 6. حدث الهجوم (الفائز يضرب) — seq تصاعدي لمنع التكرار.
      //      لا نُعيد تشغيله إذا كانت الضربة من وحدتي أنا الشخصية
      //      (لأن الأنيميشن عُرض فورًا لحظة الضغط).
      const ev = data.lastEvent;
      if (ev && typeof ev.seq === 'number') {
        if (this._lastEventSeq === null) {
          this._lastEventSeq = ev.seq; // أول لقطة بعد الانضمام — تجاهل القديم
        } else if (ev.seq > this._lastEventSeq) {
          this._lastEventSeq = ev.seq;
          if (ev.by !== engine.me?.id) this._playRemoteEvent(ev);
        }
      }

      // ❄️ 7. (حُذف مزامنة HP — لا ضرر بعد الآن، طلب المستخدم)

      // ⚖️ 8. المضيف فقط: إدارة نافذتَي التسوية
      if (engine.isHost && engine.roundActive && qid) {
        const entries = Object.entries(roundAnswers);
        const correctEntries = entries.filter(([, v]) => v.correct);

        // 8-أ: ظهرت إجابة صحيحة → افتح نافذة التسوية (مرة واحدة)
        if (correctEntries.length > 0 && !this._settleTimer) {
          this._settleTimer = setTimeout(() => {
            this._settleTimer = null;
            this._settleRound(qid);
          }, this._settleDelayMs());
        }

        // 8-ب: كل الفرق أجاب ولا توجد إجابة صحيحة → إغلاق مبكر بلا فائز
        //      (🧩 بالفرق: تكفي إجابة عضو واحد لكل فريق — الفريق كتلة واحدة)
        const totalActive = engine.characters.length;
        const answeredChars = new Set(Object.values(roundAnswers)
          .map(v => v.charId).filter(Boolean));
        if (correctEntries.length === 0 && totalActive > 0
            && answeredChars.size >= totalActive && !this._allWrongTimer) {
          this._allWrongTimer = setTimeout(() => {
            this._allWrongTimer = null;
            const latest = this._currentRoundAnswers();
            const anyCorrect = Object.values(latest).some(v => v.correct);
            if (!anyCorrect && engine.roundActive) this.closeRoundNoWinner(qid);
          }, this._settleDelayMs());
        }
      }

      // 🔄 9. المضيف فقط: طلب استبدال سؤال من لاعب آخر
      const sr = data.swapRequest;
      if (engine.isHost && sr && sr.by) {
        const key = sr.by + '_' + (sr.at || 0);
        if (key !== this._lastSwapKey) {
          this._lastSwapKey = key;
          if (engine.roundActive && !engine._ended) {
            engine.roundActive = false;
            engine.rounds.clearTimeouts();
            this._clearRoundTimers();
            this._closingQid = null;
            engine.botTimers.forEach(t => clearTimeout(t));
            engine.rounds.start(1200, { resetIndex: false }); // استبدال سريع دون تصفير رقم السؤال
          }
        }
      }

      // ⏭️ 9-ج: المضيف فقط — طلب تخطي السؤال من لاعب آخر:
      //    يُغلق السؤال كمُتخطّى (بلا نقاط) ويُجهَّز التالي فورًا —
      //    السؤال يُستهلك من الـ11 (طلب المستخدم)
      const skr = data.skipRequest;
      if (engine.isHost && skr && skr.by) {
        const key = skr.by + '_' + (skr.at || 0);
        if (key !== this._lastSkipKey) {
          this._lastSkipKey = key;
          if (engine.roundActive && !engine._ended
              && engine.currentQuestion?.id === skr.questionId) {
            engine.roundActive = false;
            engine.rounds.clearTimeouts();
            this._clearRoundTimers();
            this._closingQid = null;
            engine.answeredThisRound.clear();
            engine.botTimers.forEach(t => clearTimeout(t));
            this.closeRoundSkipped(skr.questionId).catch(() => {});
          }
        }
      }

      // 🚪 10. كشف انسحاب الخصم — غياب أطول من نافذة العودة (دقيقتان)
      this._checkForfeit(data);
    });
  }

  /** تشغيل أثر بصري لحدث وارد من عميل آخر (ضربة الفائز) */
  _playRemoteEvent(ev) {
    const { engine } = this;
    if (engine.isDestroyed) return;
    if (ev.type === 'attack' && ev.charId) {
      // ⚔️ شريط المواجهة + اهتزاز — عبر مسار المؤثرات الموحد
      engine.animations.attack(ev.charId);
    }
  }

  /**
   * 🛡️ v25 شاشة نهاية احتياطية — تُعرض فقط إن انهار بناء شاشة النهاية
   * الأساسية: النتيجة + زر العودة، حتى لا يبقى اللاعب أمام شاشة جامدة
   * (كان هذا يحدث عند فوز اللاعب الافتراضي قبل إصلاح دوال الخزان).
   */
  _fallbackEndScreen(data) {
    const { engine } = this;
    if (engine.isDestroyed) return;
    try {
      engine.breakTime?.hide();
      const exitButton = document.getElementById('btn-exit-game');
      const questionTimer = document.getElementById('q-timer');
      [exitButton, questionTimer].forEach(el => {
        if (!el) return;
        el.hidden = true;
        el.style.setProperty('display', 'none', 'important');
      });
      const myCharId = engine.myChar?.id;
      const iWon = data?.winnerCharId === myCharId;
      const overlay = document.getElementById('game-overlay');
      if (!overlay) return;
      overlay.classList.remove('hidden');
      overlay.innerHTML = `
        <div class="end-card ${iWon ? 'won' : 'lost'}">
          <h2 class="end-title ${iWon ? 'win' : 'lose'}">${iWon ? 'فزت بالجولة!' : 'انتهت المباراة'}</h2>
          <div class="end-sub">${iWon ? 'أحسنت، انتصار رائع!' : 'حظًا أوفر'}</div>
          <div class="end-actions">
            <button class="btn btn-ghost big" id="btn-back-main-fallback">العودة</button>
          </div>
        </div>`;
      const back = document.getElementById('btn-back-main-fallback');
      if (back) back.onclick = () => engine.destroy(false);
    } catch (e) {
      console.warn('[stateSync] فشل الشاشة الاحتياطية أيضًا:', e?.message || e);
    }
  }

  /**
   * 🚪 كشف الانسحاب: غاب الخصم البشري أكثر من نافذة العودة
   * (دقيقتان) دون نبضة حضور → أنا الفائز بالجولة كاملة.
   * البوتات لا تحتاج هذا — إنسحابي أنا في مباراة البوت يُحسب
   * عند عودتي عبر game/presence.js (resumeOrForfeit).
   */
  _checkForfeit(data) {
    const { engine } = this;
    if (engine._ended || engine.isDestroyed || this._forfeitWritten) return;
    if (data.status !== 'playing' && data.status !== 'intro') return;
    if (!engine.me || !engine.myChar) return;

    // 🔍 اجمع معرفات الخصوم البشر (غير البوتات)
    const oppHumans = [];
    engine.characters.forEach(c => {
      if (c.id === engine.myChar.id) return;
      (c.controllers || []).forEach(p => { if (!p.isBot) oppHumans.push(p.id); });
    });
    if (!oppHumans.length) return;

    const hb = data.hb || {};
    const startedAt = Number(data.startedAtMs) || 0;
    const nowMs = serverNow();
    const allGone = oppHumans.every(uid => {
      const last = Number(hb[uid]) || startedAt;
      return last > 0 && (nowMs - last) > REJOIN_WINDOW_MS;
    });
    if (!allGone) return;

    this._forfeitWritten = true;
    console.info('[stateSync] 🚪 غياب الخصم أكثر من دقيقتين — فوز بالانسحاب');
    updateDoc(doc(db, 'gameStates', engine.roomId), {
      status: 'ended',
      winnerCharId: engine.myChar.id,
      forfeitBy: oppHumans[0],
      lastResult: { over: true, reason: 'forfeit', entries: {}, at: nowMs },
      updatedAt: serverTimestamp()
    }).catch((e) => {
      console.warn('[stateSync] فشل تسجيل الانسحاب:', e?.message || e);
      this._forfeitWritten = false;
    });
  }

  /* ------------------- كتابات اللاعبين (بلا معاملات) ------------------- */

  /**
   * 📨 تسجيل إجابة (صحيحة أو خاطئة) — كتابة ملحقة بمسار نقطة:
   *      answers.{qid}.{controllerId} = {...}
   * تُلتزم فورًا مهما كان RTT، والتحكيم يحدث لاحقًا بزمن الضغط.
   * 🆕 لا عقاب على الخطأ (نمط كاهوت): الضرر يأتي فقط من ضربة الفائز.
   */
  async submitAnswer(controllerId, charId, choice, isCorrect, meta = {}) {
    const { engine } = this;
    if (engine._ended) return false;
    const qid = engine.currentQuestion?.id;
    if (!qid) return false;
    await ensureAuth();

    const entry = {
      qid,
      controllerId,
      charId,
      choice: choice ?? null,
      correct: !!isCorrect,
      at: meta.answeredAtMs || serverNow(),   // ⏱️ زمن الضغط بالساعة الموحدة
      rttMs: meta.rttMs || 0,
      level: meta.level || 2,                 // مستوى المجيب (لصعوبة السؤال التالي)
      isBot: !!meta.isBot
    };
    this._noteRtt(entry.rttMs);

    try {
      await updateDoc(doc(db, 'gameStates', engine.roomId), {
        ['answers.' + qid + '.' + controllerId]: entry,
        updatedAt: serverTimestamp()
      });
      return true;
    } catch (e) {
      console.warn('[stateSync] فشل إرسال الإجابة:', e?.message || e);
      return false;
    }
  }

  /**
   * ⏭️ طلب تخطي السؤال من عميل غير مضيف → المضيف يغلقه كمُتخطّى
   * ويجهّز التالي — السؤال يُستهلك من أسئلة الجولة للطرفين.
   */
  async pushSkipRequest(controllerId, expectedQuestionId) {
    const { engine } = this;
    if (engine._ended) return;
    await ensureAuth();
    await updateDoc(doc(db, 'gameStates', engine.roomId), {
      skipRequest: {
        by: controllerId,
        questionId: expectedQuestionId,
        at: serverNow(),
        origin: SESSION_ID
      },
      updatedAt: serverTimestamp()
    }).catch((e) => console.warn('[stateSync] فشل طلب التخطي:', e?.message || e));
  }

  /**
   * ❄️ تفعيل تجميد الخصم — يكتب صاحبه خريطة freeze.{charId} =
   * رقم آخر سؤال يُحجب (لا يستطيع الإجابة خلاله). المضيف يطبّق
   * الحجب عند التسوية، والعميل يمنع الإجابة محليًا فورًا.
   * 🛠️ v12: يقبل مصفوفة معرّفات — يجمّد كل شخصيات الخصم في الأنماط
   *    الجماعية (2v2/4v4) — أو معرّفًا واحدًا للتوافق القديم.
   */
  async submitFreeze(charIds, untilIndex) {
    const { engine } = this;
    if (engine._ended) return false;
    const ids = Array.isArray(charIds) ? charIds : [charIds];
    if (!ids.length) return false;
    await ensureAuth();
    const patch = {};
    ids.forEach(id => { patch['freeze.' + id] = untilIndex; });
    try {
      await updateDoc(doc(db, 'gameStates', engine.roomId), {
        ...patch,
        updatedAt: serverTimestamp()
      });
      console.info('[stateSync] ❄️ تجميد مفعّل:', ids.join(','), 'حتى سؤال', untilIndex);
      return true;
    } catch (e) {
      console.warn('[stateSync] فشل تفعيل التجميد:', e?.message || e);
      return false;
    }
  }

  /* ------------------- قرارات المضيف (الكاتب الوحيد) ------------------- */

  /**
   * ⚖️ تسوية السؤال: إعلان الفائز صاحب "أقدم زمن ضغط" بين الإجابات
   * الصحيحة (وليس أسرع وصول!) ثم إغلاق السؤال.
   * 🧩 وضع الفرق (2v2/4v4): الفريق = لاعب واحد مجازي — أول إجابة
   *    تُرسل من أي عضو هي الإجابة المعتمدة لكامل الفريق؛ أي إجابة
   *    لاحقة لعضو آخر في نفس الفريق لا تُحتسب ولو كانت صحيحة.
   */
  async _settleRound(qid) {
    const { engine } = this;
    if (engine.isDestroyed || engine._ended || !engine.roundActive) return;
    if (this._closingQid) return;
    if (engine.currentQuestion?.id !== qid) return; // السؤال تغيّر (swap مثلًا)

    const roundAnswers = this._currentRoundAnswers();

    // 🧩 ممثل كل فريق = إجابته الأولى زمنيًا (إن أجاب أكثر من عضو)
    // ❄️ إجابات الشخصيات المجمّدة (أداة تجميد الخصم) تُرفض كليًا
    const repByChar = {};
    Object.entries(roundAnswers).forEach(([cid, v]) => {
      const ch = v.charId || cid;
      if (engine.isCharFrozen?.(ch)) return;   // ❄️ مجمّد — إجابته بلا قيمة
      const cur = repByChar[ch];
      if (!cur || ((v.at || 0) < (cur[1].at || 0))) repByChar[ch] = [cid, v];
    });

    const correctEntries = Object.values(repByChar).filter(([, v]) => v.correct);
    if (correctEntries.length === 0) return; // لا فائز — المهلة/الإغلاق المبكر يتكفل

    // 🏆 الترتيب بزمن الضغط الموحد أولاً، ثم أقل RTT كسر تعادل
    correctEntries.sort((a, b) =>
      ((a[1].at || 0) - (b[1].at || 0)) || ((a[1].rttMs || 0) - (b[1].rttMs || 0)));

    const [winControllerId, winMeta] = correctEntries[0];
    await this._closeRound(qid, {
      controllerId: winControllerId,
      charId: winMeta.charId,
      at: winMeta.at,
      rttMs: winMeta.rttMs,
      level: winMeta.level
    });
  }

  /**
   * 🤝 إغلاق السؤال بلا فائز (انتهى الوقت، أو الجميع أخطأ/لم يجب):
   * لا انتصارات ولا ضرر — تُعرض النتيجة في الاستراحة التفاعلية.
   */
  async closeRoundNoWinner(expectedQid) {
    const { engine } = this;
    if (engine._ended || engine.isDestroyed || !engine.isHost) return;
    if (!engine.roundActive) return;              // السؤال أُغلق/استُبدل بالفعل
    if (this._closingQid || this.hasPendingSettlement()) return; // فيه فائز قادم
    const data = this._lastGameData;
    if (!data || data.question?.id !== expectedQid) return;
    const roundAnswers = data.answers?.[expectedQid] || {};
    if (Object.values(roundAnswers).some(v => v.correct)) return; // فيه فائز فعلاً
    await this._closeRound(expectedQid, null);
  }

  /**
   * ⏭️ إغلاق السؤال الحالي كمُتخطّى (أداة تخطي السؤال):
   * بلا فائز وبلا نقاط، والسؤال يُستهلك من أسئلة الجولة —
   * ثم يُجهَّز السؤال التالي فورًا لكلا الطرفين.
   */
  async closeRoundSkipped(expectedQid) {
    const { engine } = this;
    if (engine._ended || engine.isDestroyed || !engine.isHost) return;
    if (this._closingQid) return;                 // 🔒 لا إغلاق مزدوج
    const data = this._lastGameData;
    if (!data || data.question?.id !== expectedQid) return;
    this._skipping = true;
    await this._closeRound(expectedQid, null);
  }

  /**
   * 🧠 مدير المباراة — إغلاق السؤال واتخاذ القرار (المضيف فقط):
   *
   *  winnerEntry = { controllerId, charId, at, rttMs, level } | null
   *
   *  الخطوات:
   *   1. +1 انتصار للفائز (increment) وضرر للخصم (increment)
   *      ما لم يحمِه درع 🛡️ فيُستهلك ويُحجب الضرر.
   *   2. حدث الهجوم lastEvent + نتيجة السؤال lastResult (للاستراحة).
   *   3. القرار:
   *        🥊 ضربة قاضية (صحة الخصم صفر) → نهاية، الفائز يأخذ كل شيء
   *        🏁 حُسمت النتيجة بفارق لا يُعوَّض → نهاية مبكرة
   *        🏁 اكتملت 11 سؤالًا بفارق          → نهاية، الأكثر انتصارات يأخذ كل شيء
   *        🤝 تعادل بعد 11               → سؤال حاسم ( sudden death )
   *        غير ذلك                       → السؤال التالي (يُجهَّز الآن
   *                                         ويُكشف بعد الاستراحة 3.5 ث)
   */
  async _closeRound(closedQid, winnerEntry) {
    const { engine } = this;
    if (engine._ended || engine.isDestroyed || !engine.isHost) return;
    const data = this._lastGameData;
    if (!data || data.question?.id !== closedQid) return; // تسوية متأخرة — تجاهل
    if (this._closingQid === closedQid) return;           // 🔒 لا إغلاق مزدوج
    this._closingQid = closedQid;

    const chars = engine.characters;

    // 📸 حالة محلية موثوقة: الانتصارات فقط — لا صحة ولا دروع (v11)
    const winsLocal = { ...(data.wins || {}) };
    chars.forEach(c => { if (!(c.id in winsLocal)) winsLocal[c.id] = 0; });

    const fields = {};

    if (winnerEntry) {
      // 🏆 +1 انتصار — والحسم بالانتصارات فقط (لا ضرر إطلاقًا)
      fields['wins.' + winnerEntry.charId] = increment(1);
      winsLocal[winnerEntry.charId] = (winsLocal[winnerEntry.charId] || 0) + 1;
      engine.wins = { ...winsLocal }; // 📊 مزامنة فورية لشاشة النهاية

      // 🎬 حدث الهجوم (بصري فقط — بلا ضرر)
      fields.lastEvent = {
        type: 'attack',
        seq: (data.lastEvent?.seq || 0) + 1,
        origin: SESSION_ID,
        by: winnerEntry.controllerId,
        charId: winnerEntry.charId,
        damage: 0,
        at: winnerEntry.at || serverNow(),
        rttMs: winnerEntry.rttMs || 0
      };
    }

    // 📋 نتيجة السؤال — تُعرض على لوحة الاستراحة عند الطرفين
    const entries = {};
    Object.entries(data.answers?.[closedQid] || {}).forEach(([id, v]) => {
      entries[id] = {
        correct: !!v.correct,
        choice: v.choice ?? null,
        skipped: !!v.skipped,
        at: v.at || 0
      };
    });

    // 🧭 القرار — v23 بقواعد النمط:
    //    ⚔️ الفردي: 11 سؤالًا، حسم بفارق لا يُعوض، وسؤال حاسم عند التعادل.
    //    🧨 الجماعية: أول من يصل إلى العدد المطلوب من الإجابات الصحيحة
    //       (5 للرباعية / 8 للثمانية) يفوز فورًا — لا سؤال حاسم —
    //       وعند استنفاد الأسئلة يحسم صاحب أعلى نتيجة (وتُستخدم الإجابات
    //       الصحيحة الكلية كسر تعادل).
    const rules = modeRules(engine.match?.mode);
    const playedCount = data.questionIndex || 0;
    const scores = chars.map(c => winsLocal[c.id] || 0);
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const leaders = chars.filter((c, i) => scores[i] === maxScore);
    const remainingQuestions = Math.max(0, rules.maxQuestions - playedCount);
    const lead = maxScore - minScore;

    let matchOver = false;
    let winnerCharId = null;
    let reason = null;

    if (rules.firstTo > 0) {
      // 🧨 نمط جماعي: أول من يصل للهدف يفوز فورًا
      const reacherIdx = scores.findIndex(s => s >= rules.firstTo);
      if (reacherIdx >= 0) {
        matchOver = true;
        winnerCharId = chars[reacherIdx].id;
        reason = 'firstTo';
      } else if (playedCount >= rules.maxQuestions) {
        if (leaders.length === 1) {
          matchOver = true;
          winnerCharId = leaders[0].id;
          reason = 'points';
        } else {
          // 🔀 تعادل عند نهاية الأسئلة — كسر التعادل بإجابات الجولة الصحيحة
          const stats = this._roundStats || {};
          const correctOf = (c) => (c.controllers || [])
            .reduce((a, p) => a + (stats[p.id]?.correct || 0), 0);
          const tieSorted = [...leaders].sort((a, b) =>
            correctOf(b) - correctOf(a) || String(a.id).localeCompare(String(b.id)));
          if (correctOf(tieSorted[0]) > correctOf(tieSorted[1])) {
            matchOver = true;
            winnerCharId = tieSorted[0].id;
            reason = 'points';
          } else {
            matchOver = true;
            winnerCharId = tieSorted[0].id;
            reason = 'tiebreak';
          }
        }
      }
    } else if (leaders.length === 1
        && (playedCount >= rules.maxQuestions || lead > remainingQuestions)) {
      // ⚔️ النمط الفردي — نفس قاعدة 11 سؤالًا المعتمدة
      matchOver = true; winnerCharId = leaders[0].id; reason = 'points';
    }

    fields.lastResult = {
      qid: closedQid,
      number: playedCount,
      winner: winnerEntry ? {
        controllerId: winnerEntry.controllerId,
        charId: winnerEntry.charId,
        at: winnerEntry.at || serverNow()
      } : null,
      skipped: !!this._skipping,
      entries,
      over: matchOver,
      reason,
      winnerCharId,
      at: serverNow()
    };
    this._skipping = false;

    await ensureAuth();
    const gameRef = doc(db, 'gameStates', engine.roomId);

    // 🏁 نهاية المباراة — الفائز يأخذ كل الانتصارات
    if (matchOver) {
      fields.status = 'ended';
      fields.winnerCharId = winnerCharId;
      try {
        await updateDoc(gameRef, fields);
        console.info('[stateSync] 🏁 انتهت المباراة —', reason,
          '| الفائز:', winnerCharId,
          '| النتيجة:', chars.map(c => `${c.id}:${winsLocal[c.id] || 0}`).join(' - '));
      } catch (e) {
        console.warn('[stateSync] فشل كتابة نهاية المباراة:', e?.message || e);
        this._closingQid = null;
        return;
      }
      // 🖥️ شاشة النهاية ستظهر للطرفين عبر اللقطة (مسار واحد بلا ازدواج)
      return;
    }

    // 🧠 تجهيز السؤال التالي الآن — يصل للطرفين أثناء الاستراحة
    //    ويُكشف تلقائيًا بعد BREAK_MS (تحميل مسبق بلا أي انتظار)
    // 🛠️ إصلاح خطأ حرج (v12): كان الكود يستخدم متغير q غير معرّف
    //    في مسار الإغلاق بلا فائز (تخطي/انتهاء وقت/الجميع أخطأ)
    //    فيتعطل تجهيز السؤال التالي وتتوقف الجولة — أصبح الاختيار
    //    الآن من بنك واحد بنوع موحّد (بلا صعوبات — طلب المستخدم)
    const nextRaw = engine.rounds._pickQuestion();
    // ⏱️ لحظة الكشف: الاستراحة + نصف أسوأ RTT معروف (حتى تصل الوثيقة
    // للطرف البطيء ولنلاحظ الاستراحة المكتملة) — بسقف 1200ms
    const revealIn = BREAK_MS + Math.min(1200, Math.floor((this._maxKnownRtt || 0) / 2));
    const nextQ = {
      ...nextRaw,
      id: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      startTimeMs: serverNow() + revealIn   // ⏱️ لحظة الكشف بعد الاستراحة
    };

    fields.question = nextQ;
    fields.questionIndex = playedCount + 1;
    fields.answers = {};      // 🧹 إجابات الجولة المنتهية (المتأخرة تُتجاهل)
    fields.swapRequest = null;
    fields.skipRequest = null;
    fields.updatedAt = serverTimestamp();

    try {
      await updateDoc(gameRef, fields);
      console.info('[stateSync] ' + (winnerEntry ? '🏆' : '🤝'),
        winnerEntry ? `فائز السؤال: ${winnerEntry.controllerId} (+1 انتصار)`
                    : 'لا فائز — لا نقاط',
        `| السؤال التالي (${playedCount + 1}) جُهِّز أثناء الاستراحة`);
    } catch (e) {
      console.warn('[stateSync] فشل إغلاق السؤال:', e?.message || e);
      this._closingQid = null;
    }
  }

  /**
   * 🔄 طلب استبدال سؤال من عميل غير مضيف → المضيف يولّد السؤال الجديد
   */
  async pushSwapRequest(controllerId, expectedQuestionId) {
    const { engine } = this;
    if (engine._ended) return;
    await ensureAuth();
    await updateDoc(doc(db, 'gameStates', engine.roomId), {
      swapRequest: {
        by: controllerId,
        questionId: expectedQuestionId,
        at: serverNow(),
        origin: SESSION_ID
      },
      updatedAt: serverTimestamp()
    }).catch((e) => console.warn('[stateSync] فشل طلب الاستبدال:', e?.message || e));
  }

  /**
   * 🏁 تعليم المباراة منتهية (انسحاب / فقدان اتصال).
   * 🆕 الإصلاح: كانت مفقودة في v2 رغم استدعاء endGame.js لها
   *    — كان يسبب TypeError عند الانسحاب.
   */
  async markEnded(winnerCharId) {
    const { engine } = this;
    await ensureAuth();
    try {
      await updateDoc(doc(db, 'gameStates', engine.roomId), {
        status: 'ended',
        winnerCharId: winnerCharId || null,
        updatedAt: serverTimestamp()
      });
      console.info('[stateSync] 🏁 تم تعليم المباراة منتهية — الفائز:', winnerCharId);
    } catch (e) {
      console.warn('[stateSync] فشل تعليم نهاية المباراة:', e?.message || e);
    }
  }

  /* ------------------- تهيئة الوثيقة ------------------- */

  /**
   * 🏗️ ضمان وجود وثيقة اللعبة + خرائط hp/wins/shields:
   *  - المضيف ينشئها بوضع "شرح" (intro) مع introEndsAtMs موحد
   *  - غير المضيف يقرأها فقط (للحصول على لحظة الإطلاق الموحدة)
   *  - الوثائق القديمة الناقصة تُكمَّل خرائطها بأمان
   *  - 🏆 الطرفان يبدآن بنقاط صفر دائمًا
   *
   * @returns {Promise<object|null>} بيانات الوثيقة إن وُجدت
   */
  async ensureGameDoc() {
    const { engine } = this;
    await ensureAuth();
    const gameRef = doc(db, 'gameStates', engine.roomId);
    try {
      const snap = await getDoc(gameRef);
      const winsMap = Object.fromEntries(engine.characters.map(c => [c.id, 0]));
      if (!snap.exists()) {
        if (!engine.isHost) return null;
        const docData = {
          hostId: engine.me?.id || null,
          mode: engine.match?.mode || '1v1',
          characters: engine.characters,
          wins: winsMap,        // 🏆 انطلاق من صفر للطرفين
          freeze: {},           // ❄️ لا تجميد فعال
          questionIndex: 0,
          question: null,
          answers: {},
          lastResult: null,
          hb: {},               // 💓 نبضات الحضور
          status: 'intro',      // 📖 شاشة الشرح أولًا
          introEndsAtMs: serverNow() + INTRO_MS + 1200, // ⏱️ إطلاق موحد
          startedAtMs: serverNow(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        await setDoc(gameRef, docData);
        console.info('[stateSync] 🏗️ تمت تهيئة وثيقة اللعبة (شرح + إطلاق موحد):', engine.roomId);
        return docData;
      }
      const d = snap.data();
      const patch = {};
      if (!d.wins) patch.wins = winsMap;      // توافق الوثائق القديمة
      if (!d.freeze) patch.freeze = {};
      if (!d.hb) patch.hb = {};
      // 📖 وثيقة قديمة لم تبدأ بعد (غرف مخصصة سابقة) → أضف وضع الشرح
      if (!d.introEndsAtMs && !d.question && (d.questionIndex || 0) === 0
          && (!d.status || d.status === 'playing')) {
        patch.status = 'intro';
        patch.introEndsAtMs = serverNow() + INTRO_MS + 1200;
        patch.startedAtMs = serverNow();
      }
      if (Object.keys(patch).length) {
        await updateDoc(gameRef, patch).catch(() => {});
        Object.assign(d, patch);
      }
      return d;
    } catch (e) {
      console.warn('[stateSync] تعذّر التأكد من وثيقة اللعبة:', e?.message || e);
      return null;
    }
  }

  unsubscribeAll() {
    this._clearRoundTimers();
    if (this.unsubscribe) try { this.unsubscribe(); } catch {}
  }
}
