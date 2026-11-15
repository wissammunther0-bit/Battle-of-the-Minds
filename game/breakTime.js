// game/breakTime.js
// ============================================================
// ⏸️ الاستراحة التفاعلية + 📖 شاشة الشرح قبل الجولة — v23
//
//  📖 showIntro(endsAtMs): شاشة شرح تفاعلية قبل أول سؤال بتعليمات
//     مختلفة لكل نمط حسب آليته (طلب المستخدم v23) — وبلا نص
//     "جاري تجهيز الأسئلة" (معلومة المطور لا تُعرض للاعب).
//  ⏸️ show(...):
//     ⚔️ النمط الفردي: بطاقة نتيجة بأنصاف اللاعبين (أسماؤهم بدل
//        "الفريق الأزرق/البنفسجي") ونص "إجابة صحيحة + 1 انتصار".
//     🧨 الأنماط الجماعية: مرحلة إعلان النتيجة تملأ الشاشة كاملة —
//        صاحب الإجابة الصحيحة أعلى اللوحة وتحته نتيجة كل لاعب —
//        وتختفي تلقائيًا عند انتهاء وقتها ويبدأ السؤال التالي.
//  ⏱️ أثناء أي استراحة: يختفي عدّاد وقت الأسئلة وزر الانسحاب
//     (المرحلة مرحلة إعلان نتيجة — لا عناصر لعب فوقها).
// ============================================================

import { serverNow } from './serverTime.js';
import { modeRules } from './config.js';
import { intelIcon } from '../ui/helpers.js';
import { sfxMark } from './sound.js';
import { t } from '../i18n.js';

const REVEAL_EPS_MS = 400;   // سماحية: أقل من هذا = اكشف فورًا
const TICK_MS = 200;

export class BreakTime {
  constructor(engine) {
    this.engine = engine;
    this._el = null;
    this._revealTimer = null;
    this._tickTimer = null;
    this._introMode = false;
  }

  /* ------------------- DOM ------------------- */

  _ensureEl() {
    if (this._el && document.body.contains(this._el)) return this._el;
    const host = document.querySelector('.game-3d')
      || document.getElementById('view-game');
    const el = document.createElement('div');
    el.id = 'break-overlay';
    el.className = 'break-overlay hidden';
    (host || document.body).appendChild(el);
    this._el = el;
    return el;
  }

  /** ⏱️ إخفاء عدّاد السؤال وزر الانسحاب طوال مرحلة النتيجة/الشرح */
  _setPlayChrome(hidden) {
    const view = document.getElementById('view-game');
    if (view) view.classList.toggle('break-active', !!hidden);
    ['q-timer', 'btn-exit-game'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (hidden) {
        el.dataset.breakHidden = '1';
        el.style.setProperty('display', 'none', 'important');
        el.setAttribute('aria-hidden', 'true');
      } else if (el.dataset.breakHidden === '1') {
        delete el.dataset.breakHidden;
        el.style.removeProperty('display');
        el.removeAttribute('aria-hidden');
      }
    });
  }

  _esc(s) {
    return String(s ?? '').replace(/[&<>"']/g,
      ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  _clearTimers() {
    if (this._revealTimer) { clearTimeout(this._revealTimer); this._revealTimer = null; }
    if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = null; }
  }

  hide() {
    this._clearTimers();
    this._introMode = false;
    this._setPlayChrome(false);
    if (this._el) {
      this._el.classList.add('hidden');
      this._el.classList.remove('intro-fullscreen', 'result-fullscreen');
    }
  }

  destroy() {
    this._clearTimers();
    this._setPlayChrome(false);
    if (this._el) { try { this._el.remove(); } catch {} this._el = null; }
  }

  /* ------------------- قواعد اللعب — تعليمات لكل نمط ------------------- */

  /** 📖 التعليمات حسب النمط — آلية كل نمط مختلفة (طلب المستخدم v23) */
  _rulesList() {
    const { engine } = this;
    const rules = modeRules(engine.match?.mode);
    const tools = `
      <li>🧰 أدواتك المساعدة من المتجر تعمل داخل التحدي: تخطي وتبديل وتجميد وحذف خيارين.</li>`;

    if (rules.firstTo > 0) {
      // 🧨 الأنماط الجماعية — الرباعية (4) و8 ضد 8
      return `
      <ul class="intro-rules">
        <li>🎮 ${rules.label === '8 ضد 8' ? '8 لاعبين' : '4 لاعبين'} يتنافسون في تحدي واحد — كل لاعب يضع وقود علامة انتصار واحدة عند الدخول.</li>
        <li>🎯 أول من يصل إلى <b>${rules.firstTo} إجابات صحيحة</b> يفوز بالتحدي ويأخذ كل علامات الوقود (${rules.pot} علامات).</li>
        <li>📚 عدد أسئلة التحدي: ${rules.maxQuestions} سؤالًا — وإذا استُنفدت يفوز صاحب أعلى نتيجة.</li>
        <li>⏱️ الوقت والنتائج متزامنة بين جميع اللاعبين، وأصوات إجاباتك خاصة بك.</li>
        ${tools}
      </ul>`;
    }

    // ⚔️ النمط الفردي
    return `
      <ul class="intro-rules">
        <li>🎟️ دخول التحدي يستهلك علامة انتصار واحدة — الفائز يأخذ وقود الخصم مع استعادة وقوده (علامتان).</li>
        <li>🎯 11 سؤالًا — كل سؤال لمن يجيب صحيحًا أولًا، والأكثر انتصارات في النهاية يكسب التحدي.</li>
        <li>⚡ عند التعادل يُلعب سؤال حاسم — الفائز به يكسب التحدي.</li>
        <li>❌ لا عقاب على الإجابة الخاطئة — تخسر فقط فرصة نقطة السؤال.</li>
        ${tools}
        <li>⏱️ الوقت والنتائج متزامنة بين اللاعبين.</li>
      </ul>`;
  }

  /** 🏷️ اسم عرض للاعب (مع تمييز "أنت") */
  _displayName(p, isMe) {
    return `${p?.name || 'لاعب'}${isMe ? ' (أنت)' : ''}`;
  }

  _playerCell(name, score, isMe) {
    return `
      <div class="break-player ${isMe ? 'me' : ''}">
        <div class="bp-name">${this._esc(name)}</div>
        <div class="bp-score">${score}</div>
      </div>`;
  }

  /* ------------------- الشاشات ------------------- */

  /**
   * 📖 شاشة الشرح التفاعلية قبل الجولة:
   * آلية النمط + تجهيز السؤال الأول + إطلاق موحد.
   * 🚫 لا نص "جاري تجهيز الأسئلة" — عدّاد بداية فقط (معلومة المطور مخفية).
   */
  showIntro(endsAtMs, deferReveal = false) {
    const { engine } = this;
    if (engine.isDestroyed) return;
    this._introMode = true;
    this._clearTimers();
    this._setPlayChrome(true);
    const el = this._ensureEl();
    el.classList.add('intro-fullscreen');
    el.classList.remove('hidden');

    const rules = modeRules(engine.match?.mode);
    const chars = engine.characters || [];
    const myCharId = engine.myChar?.id;

    // 🧑‍🤝‍🧑 عرض المشاركين: الفردي = بطاقتان متقابلتان، والجماعية = صفوف
    let roster;
    if (rules.firstTo > 0) {
      roster = `<div class="break-grid">${chars.map(c => {
        const p = c.controllers?.[0] || {};
        return this._playerCell(this._displayName(p, c.id === myCharId), '0', c.id === myCharId);
      }).join('')}</div>`;
    } else {
      const opp = chars.find(c => c.id !== myCharId);
      const meP = engine.myChar?.controllers?.[0] || {};
      const oppP = opp?.controllers?.[0] || {};
      const oppLvl = oppP.level;
      roster = `
        <div class="break-results">
          ${this._playerCell(this._displayName(meP, true), '0', true)}
          <div class="break-vs">VS</div>
          ${this._playerCell(this._displayName(oppP, false) + (oppLvl ? ` (مستوى ${oppLvl})` : ''), '0', false)}
        </div>`;
    }

    el.innerHTML = `
      <div class="break-card intro">
        <div class="break-header">${t('introHeader', '📖 كيف تلعب؟ — التحدي يبدأ بعد قليل')}</div>
        ${this._rulesList()}
        ${roster}
        <div class="break-bar"><div class="break-bar-fill" style="width:100%"></div></div>
        <div class="break-next">${t('introFirstSoon', 'السؤال الأول')}</div>
      </div>`;

    if (!deferReveal) this._scheduleReveal(endsAtMs, t('introFirstSoon', 'السؤال الأول'));
  }

  /** بدء عدّ الشرح بعد اكتمال تهيئة المباراة */
  scheduleIntroReveal(endsAtMs) {
    if (!this._introMode || this.engine.isDestroyed) return;
    this._scheduleReveal(endsAtMs, t('introFirstSoon', 'السؤال الأول'));
  }

  isIntroActive() {
    return this._introMode;
  }

  /** ⏲️ جدولة الكشف بالساعة الموحدة + شريط وعدّاد نصي متزامنان */
  _scheduleReveal(endsAtMs, waitingText) {
    const el = this._el;
    if (!el) return;
    const revealAt = endsAtMs || 0;
    const waitMs = revealAt - serverNow();

    if (!revealAt || waitMs <= REVEAL_EPS_MS) {
      this._reveal();
      return;
    }

    // شريط العد التنازلي (انتقال CSS واحد سلس طوال المدة)
    const fill = el.querySelector('.break-bar-fill');
    if (fill) {
      requestAnimationFrame(() => {
        if (!fill.isConnected) return;
        fill.style.transition = `width ${waitMs}ms linear`;
        fill.style.width = '0%';
      });
    }

    // نص العدّاد — يُحدَّث من الساعة الموحدة كل نبضة
    const nextEl = el.querySelector('.break-next');
    const paint = () => {
      if (nextEl && nextEl.isConnected) {
        nextEl.textContent = `${waitingText} — ${t('startsInWord', 'تبدأ خلال')} ${Math.max(0, Math.ceil((revealAt - serverNow()) / 1000))} ${t('secondsWord', 'ث')}`;
      }
    };
    paint();
    this._tickTimer = setInterval(paint, TICK_MS);

    this._revealTimer = setTimeout(() => this._reveal(), Math.max(0, waitMs));
  }

  /**
   * ⏸️ مرحلة ما بين الأسئلة:
   *  • لا نتيجة سابقة → شاشة الشرح (آلية النمط)
   *  • نتيجة + نمط فردي → بطاقة النتيجة (نص "إجابة صحيحة + 1 انتصار"
   *    وأسماء اللاعبين بدل أسماء الفرق)
   *  • نتيجة + نمط جماعي → مرحلة إعلان النتيجة تملأ الشاشة كاملة:
   *    صاحب الإجابة الصحيحة أعلى + نتيجة كل لاعب تحته.
   */
  show({ pendingQuestion, lastResult, wins, questionIndex }) {
    const { engine } = this;
    if (engine.isDestroyed || engine._ended) return;
    this._clearTimers();
    const el = this._ensureEl();
    el.classList.remove('hidden');
    this._setPlayChrome(true);   // ⏱️ العدّاد وزر الانسحاب يختفيان أثناء إعلان النتيجة

    const rules = modeRules(engine.match?.mode);
    const chars = engine.characters || [];
    const myCharId = engine.myChar?.id;
    const myWins = (wins && myCharId && wins[myCharId]) || 0;

    const nextNumber = questionIndex || ((lastResult?.number || 0) + 1);
    const sudden = rules.firstTo === 0 && nextNumber > rules.maxQuestions;
    const revealAt = pendingQuestion?.startTimeMs || 0;
    el.classList.toggle('intro-fullscreen', !lastResult);
    el.classList.toggle('result-fullscreen', !!lastResult && rules.firstTo > 0);

    // 📖 قبل السؤال الأول: شاشة الشرح (آلية اللعب) بدل بطاقة جافة
    if (!lastResult) {
      let roster;
      if (rules.firstTo > 0) {
        roster = `<div class="break-grid">${chars.map(c => {
          const p = c.controllers?.[0] || {};
          const w = (wins && wins[c.id]) || 0;
          return this._playerCell(this._displayName(p, c.id === myCharId), w, c.id === myCharId);
        }).join('')}</div>`;
      } else {
        const opp = chars.find(c => c.id !== myCharId);
        const oppWins = (wins && opp && wins[opp.id]) || 0;
        roster = `
          <div class="break-results">
            ${this._playerCell(this._displayName(engine.myChar?.controllers?.[0], true), myWins, true)}
            <div class="break-vs">VS</div>
            ${this._playerCell(this._displayName(opp?.controllers?.[0], false), oppWins, false)}
          </div>`;
      }
      el.innerHTML = `
        <div class="break-card intro ${sudden ? 'sudden' : ''}">
          <div class="break-header">${t('introHeaderShort', '📖 كيف تلعب؟')}</div>
          ${this._rulesList()}
          ${roster}
          <div class="break-bar"><div class="break-bar-fill" style="width:100%"></div></div>
          <div class="break-next">${t('introFirstSoon', 'السؤال الأول')}</div>
        </div>`;
      this._scheduleReveal(revealAt, t('introFirstSoon', 'السؤال الأول'));
      return;
    }

    // 🔊 صوت العلامات (sound2) — يرافق ظهور ✓/✗ النتيجة
    try { sfxMark(); } catch {}

    /* ---------- 🧨 الأنماط الجماعية: مرحلة إعلان النتيجة بملء الشاشة ---------- */
    if (rules.firstTo > 0) {
      const entries = lastResult.entries || {};
      const winCharId = lastResult.winner?.charId || null;

      // صاحب الإجابة الصحيحة (أعلى اللوحة)
      let answererHTML = `
        <div class="brx-answerer none">
          <span>${t('resultNoWinner', '🤝 لا فائز')} — ${t('qWord', 'السؤال')} ${lastResult.number}/${rules.maxQuestions}${lastResult.skipped ? ' ' + t('resultNoPoints', '— لا نقاط لأحد') : ''}</span>
        </div>`;
      if (winCharId) {
        const winChar = chars.find(c => c.id === winCharId);
        const winP = (winChar?.controllers || [])
          .find(p => p.id === lastResult.winner.controllerId) || winChar?.controllers?.[0] || {};
        answererHTML = `
          <div class="brx-answerer">
            <span>${t('breakAnswerer', '⚡ صاحب الإجابة الصحيحة')}</span>
            <b>${this._esc(this._displayName(winP, winCharId === myCharId))}</b>
          </div>`;
      }

      // نتيجة كل لاعب (أنا أولًا ثم البقية)
      const rows = chars.map(c => {
        const p = c.controllers?.[0] || {};
        const isMe = c.id === myCharId;
        const isWinner = winCharId === c.id;
        const myEntries = (c.controllers || []).map(x => entries[x.id]).filter(Boolean);
        let status, cls;
        if (isWinner) {
          status = `⚡ ${t('breakCorrectWin', 'إجابة صحيحة + 1 انتصار')}`;
          cls = 'win';
        } else if (myEntries.some(e => e.correct)) {
          status = t('breakCorrectNoPoint', '✅ إجابة صحيحة');
          cls = 'win';
        } else if (myEntries.some(e => e.skipped)) {
          status = t('breakSkipped', '⏭️ تخطّى السؤال');
          cls = 'bad';
        } else if (myEntries.length > 0) {
          status = t('breakWrongAnswer', '❌ إجابة خاطئة');
          cls = 'bad';
        } else {
          status = t('breakNoAnswer', '⏱️ لم يجب');
          cls = 'none';
        }
        const frozenUntil = Number((engine.freezeMap || {})[c.id]) || 0;
        const frozen = frozenUntil && frozenUntil >= (lastResult.number || 0);
        const score = (wins && wins[c.id]) || 0;
        return `
          <div class="brx-row ${cls} ${isMe ? 'me' : ''} ${isWinner ? 'winner' : ''}">
            <span class="brx-pos">${this._esc(this._displayName(p, isMe))}</span>
            <span class="brx-status">${status}${frozen ? `<span class="bp-freeze">${t('breakFrozen', '❄️ مجمّد — لا إجابة خلال التجميد')}</span>` : ''}</span>
            <span class="brx-score">${score}</span>
          </div>`;
      }).join('');

      el.innerHTML = `
        <div class="break-card result-stage ${sudden ? 'sudden' : ''}">
          <div class="break-header">${lastResult.skipped
            ? `${t('resultSkipped', '⏭️ تم تخطي السؤال')} ${lastResult.number}/${rules.maxQuestions}`
            : `${t('resultHeaderQ', '⚡ نتيجة السؤال')} ${lastResult.number}/${rules.maxQuestions}`}</div>
          ${answererHTML}
          <div class="brx-rows">${rows}</div>
          <div class="break-bar"><div class="break-bar-fill" style="width:100%"></div></div>
          <div class="break-next">${t('breakNextQ', 'السؤال التالي')}</div>
        </div>`;
      this._scheduleReveal(revealAt, t('breakNextQ', 'السؤال التالي'));
      return;
    }

    /* ---------- ⚔️ النمط الفردي: بطاقة النتيجة ---------- */
    const oppChar = chars.find(c => c.id !== myCharId);
    const oppWins = (wins && oppChar && wins[oppChar.id]) || 0;

    let header;
    if (nextNumber > rules.maxQuestions) {
      header = t('duelSudden', '⚡ سؤال حاسم — الفائز به يكسب التحدي');
    } else if (lastResult.skipped) {
      header = `⏭️ ${t('resultSkipped', 'تم تخطي السؤال')} ${lastResult.number}/${rules.maxQuestions} ${t('resultNoPoints', '— لا نقاط لأحد')}`;
    } else if (!lastResult.winner) {
      header = `${t('resultNoWinner', '🤝 لا فائز — السؤال')} ${lastResult.number}/${rules.maxQuestions}`;
    } else {
      header = `${t('resultHeaderQ', '⚡ نتيجة السؤال')} ${lastResult.number}/${rules.maxQuestions}`;
    }

    const rowFor = (charData, isMe) => {
      if (!charData) return '';
      const name = this._displayName(charData.controllers?.[0], isMe);
      let status = t('breakNoAnswer', '⏱️ لم يجب');
      let cls = 'none';
      let sub = '';

      const entries = lastResult.entries || {};
      const myEntries = (charData.controllers || [])
        .map(p => entries[p.id]).filter(Boolean);
      const isWinner = lastResult.winner && lastResult.winner.charId === charData.id;

      if (isWinner) {
        // ✅ النص الجديد (طلب المستخدم): إجابة صحيحة + 1 انتصار
        status = `✅ ${t('breakCorrectWin', 'إجابة صحيحة + 1 انتصار')}`;
        cls = 'win';
      } else if (myEntries.some(e => e.correct)) {
        status = t('breakCorrectNoPoint', '✅ إجابة صحيحة');
        cls = 'win';
      } else if (myEntries.some(e => e.skipped)) {
        status = t('breakSkipped', '⏭️ تخطّى السؤال');
        cls = 'bad';
      } else if (myEntries.length > 0) {
        status = t('breakWrongAnswer', '❌ إجابة خاطئة');
        cls = 'bad';
      }

      // ❄️ أثر التجميد
      const frozenUntil = Number((engine.freezeMap || {})[charData.id]) || 0;
      if (frozenUntil && frozenUntil >= (lastResult.number || 0)) {
        sub = `<span class="bp-freeze">${t('breakFrozen', '❄️ مجمّد — لا إجابة خلال التجميد')}</span>`;
      }

      return `
        <div class="break-player ${cls} ${isMe ? 'me' : ''}">
          <div class="bp-name">${this._esc(name)}</div>
          <div class="bp-status ${cls}">${status}</div>
          ${sub}
        </div>`;
    };

    // اسم اللاعب الذي أرسل الإجابة الصحيحة الفائزة
    let answererName = '';
    if (lastResult.winner) {
      const winnerChar = chars.find(c => c.id === lastResult.winner.charId);
      const winnerPlayer = (winnerChar?.controllers || [])
        .find(p => p.id === lastResult.winner.controllerId);
      answererName = winnerPlayer?.name || winnerChar?.controllers?.[0]?.name || '';
    }

    // 🏷️ لوحة النتيجة بأسماء اللاعبين (حُذفت "الفريق الأزرق/البنفسجي")
    const meP = engine.myChar?.controllers?.[0] || {};
    const oppP = oppChar?.controllers?.[0] || {};
    const body = `
      ${lastResult.winner ? `<div class="break-answerer"><span>${t('breakAnswerer', '⚡ صاحب الإجابة الصحيحة')}</span><b>${this._esc(answererName)}</b></div>` : ''}
      <div class="break-results">
        ${rowFor(engine.myChar, true)}
        <div class="break-vs">VS</div>
        ${rowFor(oppChar, false)}
      </div>
      <div class="break-scoreboard">
        <span class="score-num me">${myWins}</span>
        <span class="score-label">${this._esc(meP.name || 'أنت')}</span>
        <span class="score-dash">—</span>
        <span class="score-label">${this._esc(oppP.name || 'الخصم')}</span>
        <span class="score-num opp">${oppWins}</span>
      </div>`;

    el.innerHTML = `
      <div class="break-card ${sudden ? 'sudden' : ''}">
        <div class="break-header">${header}</div>
        ${body}
        <div class="break-bar"><div class="break-bar-fill" style="width:100%"></div></div>
        <div class="break-next">✓ ${t('breakNextQ', 'السؤال التالي جاهز')}</div>
      </div>`;

    this._scheduleReveal(revealAt, t('breakNextQ', 'السؤال التالي'));
  }

  /** ▶️ انتهاء الاستراحة/الشرح — إخفاء اللوحة وعرض السؤال المحضَّر */
  _reveal() {
    this._clearTimers();
    this._introMode = false;
    this._setPlayChrome(false);   // ⏱️ العدّاد وزر الانسحاب يعودان مع السؤال
    if (this._el) {
      this._el.classList.add('hidden');
      this._el.classList.remove('intro-fullscreen', 'result-fullscreen');
    }
    const { engine } = this;
    if (engine.isDestroyed || engine._ended) return;
    engine.roundActive = true;
    engine.rounds.renderQuestion();
  }

  /**
   * 🚫 لا أسئلة في قاعدة البيانات — رسالة واضحة للاعب:
   * الأسئلة يضيفها المطور من صفحة الإدارة (طلب المستخدم).
   */
  showNoQuestions() {
    const { engine } = this;
    if (engine.isDestroyed) return;
    this._clearTimers();
    const el = this._ensureEl();
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="break-card intro">
        <div class="break-header">🚫 ${t('noQuestionsTitle', 'لا توجد أسئلة مطروحة حاليًا')}</div>
        <p class="bq-empty">${t('noQuestionsMsg', 'لم يُضِف مطوّر اللعبة أسئلة بعد — ستبدأ الجولات تلقائيًا بمجرد إضافتها من لوحة الإدارة.')}</p>
      </div>`;
  }
}
