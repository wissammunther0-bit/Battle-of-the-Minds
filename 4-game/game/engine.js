// game/engine.js
// ============================================================
// 🎮 محرك المباراة — النسخة v4 (دفعة v11)
//
// الجديد:
//  - 🗑️ حذف الضرر/HP بالكامل (طلب المستخدم): لا hp ولا شريط أخضر —
//    الحسم بالانتصارات فقط عبر شريط المواجهة الأوسط
//  - 🧰 أدوات المساعدة: تخطي ⏭️ / تبديل 🔄 / تجميد ❄️ (شريط أدوات ديناميكي)
//  - 🔄 ذاكرة الدورة: لا تكرار سؤال حتى تُعرض كل الأسئلة على اللاعب
//    (rotationMemory — تُحمّل من وثائق المشاركين وتُحفظ في نهاية الجولة)
//  - 📊 عدّادات إجاباتي الصحيحة/الخاطئة لهذه الجولة (لملف اللاعب بالأدمن)
// ============================================================

import { getPlayer } from '../auth.js';
import { db } from '../firebase-config.js';
import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { ArenaStage } from './versusbar.js';
import { StateSync } from './stateSync.js';
import { Rounds } from './rounds.js';
import { Answers } from './answers.js';
import { Animations } from './animations.js';
import { EndGame } from './endGame.js';
import { BreakTime } from './breakTime.js';
import { syncServerTimeWithTimeout, serverNow } from './serverTime.js';
import { claimActiveRound, markLeftRound } from './presence.js';
import { QUESTION_TIME, INTRO_MS, HEARTBEAT_MS } from './config.js';
import { loadRotationMemory } from './rotation.js';

export class GameEngine {
  constructor({ match, onEnd }) {
    this.match = match;
    this.onEnd = onEnd;

    this.characters = match.characters.map(c => ({
      ...c,
      controllers: c.controllers.map(p => ({ ...p }))
    }));

    this.me = null;
    this.myChar = null;
    for (const c of this.characters) {
      const me = c.controllers.find(p => !p.isBot && p.id === getPlayer().id);
      if (me) { this.me = me; this.myChar = c; break; }
    }
    if (!this.me) {
      this.myChar = this.characters[0];
      this.me = this.myChar.controllers[0];
    }

    this.questionIndex = 0;
    this.timer = null;
    this.timeLeft = QUESTION_TIME;
    this.currentQuestion = null;
    this.askedQuestions = new Set();
    this.answeredThisRound = new Set();
    this.roundActive = false;
    this.botTimers = [];
    this.isDestroyed = false;
    this.isHost = false;
    this._ended = false;

    // 🕐 مؤقت نافذة السماح بعد وصول العدّاد إلى صفر
    this.timeoutTimer = null;

    // 🏆 مرآة انتصارات الفرق من الوثيقة
    this.wins = {};

    // ❄️ خريطة التجميد من الوثيقة {charId: حتى رقم سؤال}
    this.freezeMap = {};

    // 🔄 ذاكرة الدورة: معرفات الأسئلة المعروضة على المشاركين —
    //    لا تكرار حتى تُعرض كل الأسئلة (طلب المستخدم)
    this.rotationMemory = new Set();
    this.servedIds = [];          // معرفات أسئلة هذه الجولة (تُحفظ في النهاية)

    // 📊 عدّاداتي في هذه الجولة (تُجمع في ملفي بالأدمن)
    this.myCorrect = 0;
    this.myWrong = 0;

    // 📖 لحظة انتهاء الشرح/بداية السؤال الأول (موحدة من الوثيقة)
    this.introEndsAtMs = 0;
    // 💓 مؤقت نبضة الحضور
    this._hbTimer = null;

    this.roomId = match.roomCode || match.mode || '1v1';

    // ⚔️ ساحة المواجهة (بديل الـ 3D — DOM/CSS خالص بلا WebGL)
    this.arena = new ArenaStage(this);
    this.stateSync = new StateSync(this);
    this.rounds = new Rounds(this);
    this.answers = new Answers(this);
    this.animations = new Animations(this);
    this.endGame = new EndGame(this);
    this.breakTime = new BreakTime(this);
  }

  async mount(container) {
    this.container = container;
    this.isHost = this.characters[0]?.controllers[0]?.id === this.me.id;

    document.getElementById('view-game').classList.remove('game-over-active');
    // إعادة أدوات اللعب لحالتها الطبيعية عند إنشاء جولة/محرك جديد.
    ['btn-exit-game', 'q-timer'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.hidden = false;
      el.style.removeProperty('display');
      el.style.removeProperty('pointer-events');
      el.removeAttribute('aria-hidden');
    });

    // 📖 اعرض التعليمات فور دخول شاشة اللعب، قبل أي انتظار للشبكة أو تهيئة الساحة.
    this.breakTime.showIntro(serverNow() + INTRO_MS + 1200, true);

    // ⏱️ مزامنة وقت السيرفر قبل أي منطق توقيت (بمهلة قصوى حتى لا
    // تعطّل شبكة بطيئة بدء المباراة — نتراجع بساعة محلية عند الفشل)
    await syncServerTimeWithTimeout(2500);

    // 🏗️ ضمان وجود وثيقة اللعبة (المضيف ينشئها بوضع الشرح والإطلاق الموحد)
    const docData = await this.stateSync.ensureGameDoc();

    // 📖 لحظة انتهاء الشرح = لحظة بداية السؤال الأول — موحدة للطرفين
    this.introEndsAtMs = Number(docData?.introEndsAtMs) || (serverNow() + INTRO_MS + 1200);

    // 📌 تسجيل الجولة النشطة (استئناف خلال دقيقتين عند العودة)
    claimActiveRound(this.roomId);
    this._writeHeartbeat();

    await this.arena.init();
    this.bindUI();

    // 🔄 حمّل ذاكرة الدورة (أسئلة عُرضت سابقًا على المشاركين البشر)
    loadRotationMemory(this).catch(() => {});

    // 💓 نبضة الحضور كل 10 ثوانٍ — لكشف الغياب الأطول من الدقيقتين
    this._hbTimer = setInterval(() => this._writeHeartbeat(), HEARTBEAT_MS);

    this.stateSync.subscribe();

    if (this.isHost && !(docData && docData.question)) {
      // ✍️ سؤال أول لم يُكتب بعد (مباراة جديدة) — يُكتب أثناء الشرح
      //     ويُكشف لحظة انتهائها بالساعة الموحدة → إطلاق موحد للطرفين
      // 🚫 عند الاستئناف (question موجودة) لا نُعيد البداية إطلاقًا
      const revealIn = Math.max(1500, this.introEndsAtMs - serverNow());
      setTimeout(() => this.rounds.start(revealIn), 400);
    }
  }

  /** 💓 نبضة حضور: hb.{myUid} = الساعة الموحدة */
  _writeHeartbeat() {
    if (this.isDestroyed || this._ended || !this.me) return;
    try {
      updateDoc(doc(db, 'gameStates', this.roomId), {
        ['hb.' + this.me.id]: serverNow()
      }).catch(() => {});
    } catch {}
  }

  bindUI() {
    this.el = {
      qText: document.getElementById('q-text'),
      qOptions: document.getElementById('q-options'),
      qTimer: document.getElementById('q-timer'),
      overlay: document.getElementById('game-overlay'),
      toolsBar: document.getElementById('q-tools'),
      btnExit: document.getElementById('btn-exit-game')
    };
    if (this.el.btnExit) this.el.btnExit.onclick = () => this.endGame.handleExit();
    this.answers.renderTools();
  }

  /** ❄️ هل هذه الشخصية مجمّدة في رقم السؤال الحالي؟ */
  isCharFrozen(charId) {
    const until = Number(this.freezeMap?.[charId]) || 0;
    return until > 0 && (this.questionIndex || 1) <= until;
  }

  destroy(exitEarly) {
    this.isDestroyed = true;
    this.roundActive = false;
    if (this.timer) clearInterval(this.timer);
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    if (this._hbTimer) { clearInterval(this._hbTimer); this._hbTimer = null; }
    this.botTimers.forEach(t => clearTimeout(t));
    this.breakTime.destroy();
    this.arena.destroy();
    this.stateSync.unsubscribeAll();
    // 🚪 خروج مبكر دون نهاية رسمية (تنقّل/تحديث) → نافذة عودة دقيقتين
    if (exitEarly && !this._ended) markLeftRound(this.roomId);
    document.getElementById('view-game').classList.remove('game-over-active');
    if (this.onEnd) this.onEnd();
  }
}
