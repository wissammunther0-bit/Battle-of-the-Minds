// game/versusbar.js
// ============================================================
// ⚔️ ساحة المواجهة — النسخة v21 «مطابقة التصميم المعتمد + طلبات المستخدم»
//
// (طلب المستخدم v21):
//  • 🏆 شارة الجولة «الجولة x/11» انتقلت من أعلى الساحة إلى صف معلومات
//    السؤال (بطاقة عداد الأسئلة السابقة) بجانب نص «أول إجابة صحيحة
//    تكسب النقطة» — شارة "مكان بطاقة عداد الأسئلة"
//  • بطاقتا لاعبين مشطوفتا الزوايا بإطار متوهج (أنا أزرق يسارًا /
//    الخصم بنفسجي يمينًا) بأفاتار دائري بارز خارج الحافة
//  • الاسم + شارة المستوى نحو المنتصف + لوحة نقاط داخلية داكنة
//    بإطار ذهبي متناسق مع بقية عناصر التصميم (خلفية بطاقة النقطة)
//  • شارة انتصارات أسفل كل بطاقة (كأس + التسمية + الرقم)
//  • شريط مواجهة بإطار ذهبي (أزرق يسارًا / بنفسجي يمينًا)
//    مع نجمة التقاء بيضاء — الأنماط في styles/v20.css و styles/v21.css
//
// كل نقاط الربط data-el محفوظة كما هي — لا تغيير في المنطق.
// تقنيًا: DOM/CSS خالص — بلا WebGL ولا حلقات rAF دائمة: صفر حمل.
// ============================================================

import { getPlayer } from '../auth.js';
import { modeRules } from './config.js';
import { getProfilePicture } from '../store-catalog.js';
import { getFlag } from '../ui/helpers.js';
import { t } from '../i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/* ============================================================
 * ساحة المباراة (أعلى قسم الجولة)
 * ========================================================== */

export class ArenaStage {
  constructor(engine) {
    this.engine = engine;
    this.el = null;
    this.fxTimers = [];
    this._lastWinsSig = '';
    this._lastRound = -1;
  }

  async init() {
    const { engine } = this;
    const host = engine.container;
    if (!host) return;
    host.innerHTML = '';
    host.classList.add('arena-stage');
    // 🎮 v23: النمط الجماعي = لاعبون أفراد بلا شريط لوني (طلب المستخدم:
    //    الشريط يجعل الشاشة مزدحمة في الجولات الجماعية — يُحذف هناك)
    const rules = modeRules(engine.match?.mode);
    this.isGroup = rules.firstTo > 0;
    this.maxQ = rules.maxQuestions;

    const barHTML = this.isGroup ? '' : `
        <div class="duel-bar" data-el="bar">
          <div class="vb-ticks"></div>
          <div class="vb-fill me" data-el="fill-me"></div>
          <div class="vb-fill opp" data-el="fill-opp"></div>
          <div class="vb-seam" data-el="seam"><span class="vb-sword">⚔️</span></div>
          <div class="vb-pct me" data-el="pct-me">50%</div>
          <div class="vb-pct opp" data-el="pct-opp">50%</div>
          <div class="vb-sparks" data-el="sparks"></div>
        </div>`;

    host.innerHTML = `
      <div class="arena-backdrop">
        <div class="arena-beam b1"></div>
        <div class="arena-beam b2"></div>
        <div class="arena-grid"></div>
        <div class="arena-spot"></div>
        <div class="arena-flash"></div>
      </div>

      <div class="duel-wrap ${this.isGroup ? 'group' : ''}">
        <div class="duel-row ${this.isGroup ? 'squad' : ''}">
          <!-- 🧑‍🤝‍🧑 بطاقات اللاعبين (فردي: طرفان — جماعي: أنا مقابل الجميع) -->
          <div class="duel-side me" data-side="me">
            <div class="ds-frame" aria-hidden="true"></div>
            <div class="ds-chips" data-el="me-chips"></div>
            <div class="ds-score me" data-el="me-score">0</div>
            <div class="ds-career-wins" data-el="me-career-wins"></div>
          </div>

          <div class="duel-vs" aria-hidden="true">VS</div>

          <div class="duel-side opp" data-side="opp">
            <div class="ds-frame" aria-hidden="true"></div>
            <div class="ds-chips" data-el="opp-chips"></div>
            <div class="ds-score opp" data-el="opp-score">0</div>
            <div class="ds-career-wins" data-el="opp-career-wins"></div>
          </div>
        </div>
        ${barHTML}
      </div>`;

    this.el = host;
    this.setTeams();
    this.setRound(engine.questionIndex || 0);
    this.updateWins(this.engine.wins || {});
  }

  /* ---------------------- الفرق والأسماء ---------------------- */

  /**
   * 🧑‍🤝‍🧑 ترتيب الأسماء أعلى الساحة (طلب المستخدم v11):
   *  • فردي: اسمي يمينًا واسم الخصم يسارًا
   *  • ثنائي: اسمان يمينًا واسمان يسارًا
   *  • رباعي: أربعة أسماء مصغّرة على كل جانب
   * كل شريحة تحمل علم دولة اللاعب — بلا علم أبيض أبدًا.
   */
  setTeams() {
    const { engine } = this;
    if (!this.el || !engine.myChar) return;
    const esc2 = (x) => String(x ?? '').replace(/[&<>"']/g,
      ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

    // 🎴 شريحة اللاعب — الأفاتار الدائري البارز + الاسم والمستوى
    //    + في الجماعية: شارة نتيجة خاصة بكل لاعب (نتيجته هو)
    //    🎨 v24: كل لاعب لونه الخاص — الأخضر أنا وكل خصم لونه
    //    (فردي: أخضر ضد أحمر · رباعي: 4 ألوان · 8ضد8: 8 ألوان)
    let oppColorCursor = 2;
    const chipFor = (p, isMe, charData) => {
      const pcCls = isMe ? 'pc-1' : `pc-${Math.min(8, Math.max(2, oppColorCursor++))}`;
      return `
      <div class="ds-chip ${isMe ? 'me' : 'opp'} pc-chip ${pcCls}" data-ctrl="${esc2(p.id)}">
        ${this._avatarHtml(p)}
        <span class="ds-meta">
          <span class="ds-name" title="${esc2(p.name)}">${esc2(p.name)}</span>
          ${p.level ? `<span class="ds-lvl">${t('lvlTag', 'مستوى')} ${p.level}</span>` : ''}
          ${this.isGroup && charData ? `<span class="ds-mini-score" data-mini="${esc2(charData.id)}">0</span>` : ''}
        </span>
        <span class="ds-frozen hidden" data-frozen="${esc2(p.id)}">❄️</span>
      </div>`;
    };

    const meChips = this.el.querySelector('[data-el="me-chips"]');
    const oppChips = this.el.querySelector('[data-el="opp-chips"]');
    const oppChars = (engine.characters || []).filter(c => c.id !== engine.myChar.id);

    if (meChips) {
      meChips.innerHTML = (engine.myChar.controllers || [])
        .map(p => chipFor(p, true, engine.myChar)).join('');
    }
    if (oppChips) {
      // 🧨 الجماعية: كل اللاعبين الآخرين (أفرادًا) على الجهة المقابلة
      oppChips.innerHTML = oppChars
        .flatMap(c => (c.controllers || []).map(p => chipFor(p, false, c)))
        .join('');
    }
    const oppLead = oppChars[0];
    const meWins = engine.me?.wins ?? getPlayer()?.wins ?? 0;
    const oppWins = oppLead?.controllers?.[0]?.wins ?? 0;
    const meWinsEl = this.el.querySelector('[data-el="me-career-wins"]');
    const oppWinsEl = this.el.querySelector('[data-el="opp-career-wins"]');
    // 🏆 شارة الانتصارات: كأس + التسمية والرقم متراصَين — كما في التصميم
    if (meWinsEl) meWinsEl.innerHTML = `<span aria-hidden="true">🏆</span><span class="dw-c"><span>${t('duelWinsLabel', 'الانتصارات')}</span><b>${Number(meWins) || 0}</b></span>`;
    if (oppWinsEl) oppWinsEl.innerHTML = `<span aria-hidden="true">🏆</span><span class="dw-c"><span>${t('duelWinsLabel', 'الانتصارات')}</span><b>${Number(oppWins) || 0}</b></span>`;

    // 📏 نمط العرض حسب حجم الجهة المقابلة
    const row = this.el.querySelector('.duel-row');
    const oppSize = oppChars.reduce((a, c) => a + (c.controllers || []).length, 0);
    if (row) {
      row.classList.toggle('duo', !this.isGroup && oppSize === 1);
      row.classList.toggle('squad', this.isGroup || oppSize >= 2);
    }
  }

  _avatarHtml(player) {
    const esc = (x) => String(x ?? '').replace(/[&<>"']/g,
      ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const pic = getProfilePicture({
      equippedCharacter: player.characterId || player.equippedCharacter || player.equippedAvatar
    });
    if (pic?.image) return `<img class="ds-av" src="${esc(pic.image)}" alt="" draggable="false">`;
    if (pic?.emoji) return `<span class="ds-av">${esc(pic.emoji)}</span>`;
    return `<span class="ds-av ds-av-flag">${getFlag(player.country)}</span>`;
  }

  /** ❄️ عرض/إخفاء مؤشر التجميد على شرائح كل جانب */
  updateFreeze(freezeMap) {
    if (!this.el) return;
    this.el.querySelectorAll('[data-frozen]').forEach(el => {
      const cid = el.dataset.frozen;
      const until = Number((freezeMap || {})[cid]) || 0;
      el.classList.toggle('hidden', !until);
    });
  }

  /* ------------------- شارة رقم الجولة ------------------- */

  /**
   * 🏆 تحديث شارة "الجولة x/11" — v21: تُعرض الآن داخل صف معلومات
   * السؤال (#q-meta) في مكان بطاقة عداد الأسئلة السابقة بجانب نص
   * "أول إجابة صحيحة تكسب النقطة" (طلب المستخدم).
   * @param {number} n رقم السؤال القادم (1-based) — فوق 11 = سؤال حاسم
   */
  setRound(n) {
    // 📍 الشارة تعيش في صف معلومات السؤال — والحد من قواعد النمط
    const out = document.querySelector('#q-meta [data-el="round-text"]');
    if (!out) return;
    const maxQ = this.maxQ || modeRules(this.engine?.match?.mode).maxQuestions;
    const num = Math.max(1, Number(n) || 1);
    if (num > maxQ) {
      out.textContent = t('duelSudden', '⚡ سؤال حاسم — الفائز به يكسب التحدي');
    } else {
      const count = document.createElement('bdi');
      count.dir = 'ltr';
      count.textContent = `${num} / ${maxQ}`;
      out.replaceChildren(document.createTextNode(`${t('roundWord', 'الجولة')} `), count);
    }
    const chip = out.closest('.qm-round');
    if (chip) chip.classList.toggle('sudden', num > maxQ);
  }

  /* ------------------ موضع الشريط (منتصف مشترك) ------------------ */

  /**
   * ⚖️ تحديث موضع شريط الشد من خريطة الانتصارات المتزامنة — النسخة التدريجية.
   *
   * 🎯 (طلب المستخدم): تأثير تدريجي لوني — مع كل فوز أو خسارة يتجه لون
   * الفائز نحو لون الخاسر "قليلاً": التحرك = 1/عدد الأسئلة (1/11).
   * الموضع = 50% + (فرق الانتصارات ÷ 11) × 50% — فيرى الطرفان نفس
   * الموقف في نفس اللحظة (المصدر: وثيقة gameStates):
   *  - 0 - 0   → 50% (تعادل تام)
   *  - 1 - 0   → 54.5% (اندفاع صغير نحو الخصم)
   *  - 11 - 0  → 100% (اجتياح كامل — كل قسمة من قسع الشريط)
   * كما يتصاعد "السخونة" اللونية (heat) كلما اتسع الفارق.
   */
  updateWins(winsMap) {
    if (!this.el) return;
    const { engine } = this;
    if (!engine.myChar) return;
    const oppChars = (engine.characters || []).filter(c => c.id !== engine.myChar.id);
    if (!oppChars.length) return;

    const myW = Math.max(0, Number(winsMap[engine.myChar.id]) || 0);
    const opScores = oppChars.map(c => Math.max(0, Number(winsMap[c.id]) || 0));
    const opW = Math.max(0, ...opScores);   // في الجماعية: نتيجة المتصدر

    // 🧩 الجماعية: نتيجة كل لاعب داخل شرِطته
    if (this.isGroup) {
      this.el.querySelectorAll('[data-mini]').forEach(el => {
        const cid = el.dataset.mini;
        el.textContent = Math.max(0, Number(winsMap[cid]) || 0);
      });
    }

    // ⚔️ الفردي فقط: شريط التحدي اللوني (الجماعية بلا شريط)
    if (!this.isGroup) {
      const step = 50 / Math.max(1, this.maxQ || 11);
      const pct = Math.max(0, Math.min(100, 50 + (myW - opW) * step));
      const heat = Math.min(1, Math.abs(pct - 50) / 50);

      const bar = this.el.querySelector('[data-el="bar"]');
      const fillMe = this.el.querySelector('[data-el="fill-me"]');
      const fillOpp = this.el.querySelector('[data-el="fill-opp"]');
      const seam = this.el.querySelector('[data-el="seam"]');
      const pctMe = this.el.querySelector('[data-el="pct-me"]');
      const pctOpp = this.el.querySelector('[data-el="pct-opp"]');

      if (fillMe) fillMe.style.width = pct + '%';
      if (fillOpp) fillOpp.style.width = (100 - pct) + '%';
      if (seam) { seam.style.left = pct + '%'; seam.style.right = 'auto'; }
      if (pctMe) pctMe.textContent = Math.round(pct) + '%';
      if (pctOpp) pctOpp.textContent = Math.round(100 - pct) + '%';
      if (bar) {
        bar.style.setProperty('--vb-heat', heat.toFixed(3));
        bar.classList.toggle('lead-me', myW > opW);
        bar.classList.toggle('lead-opp', opW > myW);
        bar.classList.toggle('even', myW === opW);
      }
    }

    const scoreMe = this.el.querySelector('[data-el="me-score"]');
    const scoreOpp = this.el.querySelector('[data-el="opp-score"]');
    if (scoreMe) scoreMe.textContent = myW;
    if (scoreOpp) scoreOpp.textContent = opW;

    // 👑 توهج بطاقة الجانب المتقدم
    const sideMe = this.el.querySelector('.duel-side.me');
    const sideOpp = this.el.querySelector('.duel-side.opp');
    sideMe?.classList.toggle('leading', myW > opW);
    sideOpp?.classList.toggle('leading', opW > myW);
  }

  /* ------------------------ التفاعلات ------------------------ */

  /**
   * 🎬 تفاعل الشريط مع الأحداث — النسخة الموحدة التي تمر منها كل
   * الإجابات (أنا / البوتات / اللاعبون الآخرون عبر lastEvent).
   * @param {'win'|'me-wrong'|'opp-wrong'|'shield'} kind
   * @param {string} charId — معرف الفريق صاحب الحدث
   */
  react(kind, charId) {
    if (!this.el || this.engine?.isDestroyed) return;
    const isMine = charId ? charId === this.engine.myChar?.id : true;
    const sideEl = this.el.querySelector(isMine ? '.duel-side.me' : '.duel-side.opp');
    const bar = this.el.querySelector('[data-el="bar"]');

    if (kind === 'win') {
      // 🏆 إجابة صحيحة: اندفاع + شرر + لوحة عائمة
      sideEl?.classList.remove('flare');
      void sideEl?.offsetWidth;      // إعادة تشغيل الأنيميشن
      sideEl?.classList.add('flare');
      if (bar) {
        bar.classList.remove('push-me', 'push-opp');
        void bar.offsetWidth;
        bar.classList.add(isMine ? 'push-me' : 'push-opp');
        this._sparks(isMine ? 'me' : 'opp');
      }
      this._float(sideEl, isMine ? '+1 ' + t('duelWinWord', 'انتصار') : '+1',
        isMine ? 'good' : 'bad');
    } else if (kind === 'me-wrong') {
      // ❌ إجابة خاطئة: ارتجاج أحمر وارتداد للخلف
      const meSide = this.el.querySelector('.duel-side.me');
      meSide?.classList.remove('stumble');
      void meSide?.offsetWidth;
      meSide?.classList.add('stumble');
      if (bar) {
        bar.classList.remove('recoil-me');
        void bar.offsetWidth;
        bar.classList.add('recoil-me');
      }
      this._float(meSide, '✗ ' + t('duelWrong', 'إجابة خاطئة'), 'bad');
    } else if (kind === 'opp-wrong') {
      const opSide = this.el.querySelector('.duel-side.opp');
      opSide?.classList.remove('stumble');
      void opSide?.offsetWidth;
      opSide?.classList.add('stumble');
    } else if (kind === 'shield') {
      const meSide = this.el.querySelector('.duel-side.me');
      meSide?.classList.remove('flare');
      void meSide?.offsetWidth;
      meSide?.classList.add('flare');
      this._float(meSide, '🛡️ ' + t('duelShielded', 'درع فعال'), 'shield');
    }
  }

  /** 📳 اهتزاز كامل الساحة (بديل اهتزاز الكاميرا — DOM فقط) */
  shake(ms = 250) {
    if (!this.el || this.engine?.isDestroyed) return;
    this.el.classList.remove('shaking');
    void this.el.offsetWidth;
    this.el.classList.add('shaking');
    const t1 = setTimeout(() => this.el?.classList.remove('shaking'), Math.max(120, ms));
    this.fxTimers.push(t1);
  }

  /** 🥊 وميض النهاية: فريق الفائز يتوهّج ذهبيًا */
  koFlash(winnerCharId) {
    if (!this.el) return;
    const isMine = winnerCharId === this.engine.myChar?.id;
    this.el.classList.remove('ko-win', 'ko-lose');
    void this.el.offsetWidth;
    this.el.classList.add(isMine ? 'ko-win' : 'ko-lose');
  }

  /* ------------------------ مؤثرات داخلية ------------------------ */

  _sparks(side) {
    const box = this.el?.querySelector('[data-el="sparks"]');
    if (!box) return;
    const anchor = side === 'me' ? '100%' : '0%';
    for (let i = 0; i < 12; i++) {
      const s = document.createElement('span');
      s.className = 'spark ' + side;
      s.style.insetInlineStart = anchor;
      s.style.setProperty('--dx', (Math.random() * 2 - 1).toFixed(2));
      s.style.setProperty('--dy', (Math.random() * 2 - 1).toFixed(2));
      s.style.setProperty('--d', (500 + Math.random() * 380).toFixed(0) + 'ms');
      box.appendChild(s);
      const t1 = setTimeout(() => s.remove(), 950);
      this.fxTimers.push(t1);
    }
  }

  _float(sideEl, text, cls) {
    if (!sideEl) return;
    const f = document.createElement('span');
    f.className = 'duel-float ' + (cls || '');
    f.textContent = text;
    sideEl.appendChild(f);
    const t1 = setTimeout(() => f.remove(), 1100);
    this.fxTimers.push(t1);
  }

  /* ------------------------ دورة الحياة ------------------------ */

  setFallingAnimating() { /* توافق واجهة قديمة — لا شيء */ }

  destroy() {
    this.fxTimers.forEach(t1 => clearTimeout(t1));
    this.fxTimers = [];
    if (this.el) {
      this.el.classList.remove('arena-stage', 'shaking', 'ko-win', 'ko-lose');
      try { this.el.innerHTML = ''; } catch {}
      this.el = null;
    }
  }
}
