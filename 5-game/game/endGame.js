// game/endGame.js
// ============================================================
// 🏁 نهاية المباراة — النسخة v4 "الفائز يأخذ كل الانتصارات"
//
//  - شاشة نهاية موحدة (فوز/خسارة/انسحاب) تُستدعى من لقطة الوثيقة
//    عبر stateSync — مسار واحد للطرفين بلا ازدواج مكافآت.
//  - 💾 حفظ التقدم: انتصارات/هزائم/مستوى/انتصارات الأسئلة
//    → محليًا + Firestore (التقدم محفوظ في قاعدة البيانات).
//  - 📜 كتابة سجل الجولة (أنا الكاتب الوحيد لسجلّي).
//  - ➕ إرسال طلب صداقة للخصم من شاشة النهاية (حتى لو بوت —
//    يُرفض بعد دقيقتين تلقائيًا فيبدو حقيقيًا).
//  - 🎉 ترقية المستوى + شريط التقدم للمستوى التالي.
//  - 🚪 handleExit: خروج نهائي — انسحاب = خسارة الجولة بلا عودة (v8)
// ============================================================

import { getPlayer, updatePlayer } from '../auth.js';
import { addVictoryReward, addLoss, bumpAwardCounter, doubleWinReward } from '../store.js';
import { playAd } from '../game/rewards.js';
import { syncPlayerToFirestore } from '../firestore-sync.js';
import { levelFromWins } from './levels.js';
import { modeRules, isGroupMode } from './config.js';
import { saveMatchResult } from './history.js';
import { clearActiveRound, forfeitMyRound } from './presence.js';
import { saveRotationMemory } from './rotation.js';
import { recordVirtualRound } from './virtualPlayers.js';
import { tankVirtualDraw, tankVirtualReturn, tankRoundPlayed } from './economy.js';
import {
  sendFriendRequest, acceptFriendRequest,
  getFriendsList, getIncomingRequestsOnce, getSentRequests
} from './social.js';
import { getFlag, confirmDialog } from '../ui/helpers.js';
import { icon } from '../ui/icons.js';
import { getProfilePicture } from '../store-catalog.js';
// 👤 v32.1 — بطاقة الملف الشخصي: ضغط بطاقة الفائز في الأنماط الجماعية يفتح ملفه
import { openPlayerProfile } from '../ui/profileCard.js';
import { t } from '../i18n.js';

export class EndGame {
  constructor(engine) {
    this.engine = engine;
    this._screenShown = false;
  }

  _esc(s) {
    return String(s ?? '').replace(/[&<>"']/g,
      ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  /** 📊 صف لاعب في سجل الجولة */
  _rosterRow(p) {
    const you = p.isMe ? ` <span class="you">(${t('rosterYou', 'أنت')})</span>` : '';
    const picture = getProfilePicture({
      equippedCharacter: p.characterId || p.equippedCharacter || p.equippedAvatar
    });
    const avatar = picture?.image
      ? `<img src="${this._esc(picture.image)}" alt="" draggable="false">`
      : this._esc(picture?.emoji || getFlag(p.country));
    const add = p.isMe
      ? '<span class="er-add ghost" aria-hidden="true"></span>'
      : `<button class="er-add" data-add="${this._esc(p.id)}" title="${t('addFriend', 'إضافة صديق')}" aria-label="${t('addFriend', 'إضافة صديق')}">➕</button>`;
    // 🎨 v24 — لون اللاعب: الأخضر أنا، وكل خصم لونه الخاص
    //    (فردي: أخضر ضد أحمر — رباعي: 4 ألوان — ثماني: 8 ألوان)
    const pcCls = p.isMe ? 'pc-1' : `pc-${Math.min(8, Math.max(2, p.colorIndex || 2))}`;
    return `
      <div class="er-row ${p.isMe ? 'me' : ''} ${pcCls} pc-row">
        <span class="er-avatar">${avatar}</span>
        <div class="er-info">
          <div class="er-name">${this._esc(p.name)}${you}</div>
          <div class="er-lvl">${t('lvlTag', 'مستوى')} ${Number(p.level) || '—'}</div>
        </div>
        <div class="er-chips">
          <span class="er-chip ok" title="${t('rosterCorrect', 'إجابات صحيحة')}"><b>✓ ${p.correct}</b><small>صحيح</small></span>
          <span class="er-chip bad" title="${t('rosterWrong', 'إجابات خاطئة')}"><b>✗ ${p.wrong}</b><small>خطأ</small></span>
        </div>
        ${add}
      </div>`;
  }

  /**
   * 🚪 خروج نهائي — v23: نافذة تأكيد بعنوان وزر جديدين
   *  (الانسحاب من التحدي / استمر في التحدي)، ومن ينفّذ الانسحاب
   *  يرى شاشة النهاية كخاسر تمامًا كما لو خسر الجولة (طلب المستخدم).
   */
  async handleExit() {
    const { engine } = this;

    const ok = await confirmDialog({
      title: t('exitForfeitTitle', 'الانسحاب من التحدي'),
      message: t('exitForfeitMsg', 'إذا انسحبت الآن ستُحسب خاسرًا في هذه الجولة نهائيًا ولن تستطيع العودة إليها مجددًا. هل أنت متأكد؟'),
      icon: 'warn',
      okText: t('forfeit', 'انسحاب'),
      cancelText: t('forfeitStay', 'استمر في التحدي'),
      danger: true
    });
    if (!ok) return;

    engine.roundActive = false;
    engine.rounds.clearTimeouts();
    engine.stateSync?._clearRoundTimers?.();
    engine.breakTime?.hide();
    engine.botTimers.forEach(t => clearTimeout(t));

    // 🏳️ انسحاب رسمي فوري: نهاية الجولة + الخصم فائز + خسارة في سجلي
    await forfeitMyRound({
      id: engine.roomId,
      characters: engine.characters,
      wins: engine.wins
    }, engine.me?.id);

    // 🖥️ شاشة النهاية كخاسر — تمامًا كما تظهر عند خسارة الجولة
    const oppChar = engine.characters.find(c => c.id !== engine.myChar?.id);
    engine._ended = true;
    this.showEndScreen({
      status: 'ended',
      winnerCharId: oppChar?.id || null,
      forfeitBy: engine.me?.id,
      wins: engine.wins || {},
      lastResult: { over: true, reason: 'forfeit' }
    });
  }

  /**
   * 🏁 شاشة النهاية الموحدة — تُستدعى من لقطة stateSync عند status=ended
   * @param {object} data لقطة وثيقة اللعبة النهائية
   */
  async showEndScreen(data) {
    const { engine } = this;
    if (this._screenShown || engine.isDestroyed) return;
    this._screenShown = true;

    engine.roundActive = false;
    engine.rounds.clearTimeouts();
    engine.stateSync?._clearRoundTimers?.();
    engine.breakTime?.hide();
    engine.botTimers.forEach(t => clearTimeout(t));

    // لا نعتمد على CSS وحده: أخفِ أدوات اللعب فور وصول حالة ended
    // حتى لا تظهر لحظةً أثناء بناء شاشة النتيجة أو على الأجهزة البطيئة.
    const exitButton = document.getElementById('btn-exit-game');
    const questionTimer = document.getElementById('q-timer');
    [exitButton, questionTimer].forEach(el => {
      if (!el) return;
      el.hidden = true;
      el.style.setProperty('display', 'none', 'important');
      el.style.pointerEvents = 'none';
      el.setAttribute('aria-hidden', 'true');
    });

    const myCharId = engine.myChar?.id;
    const oppChar = engine.characters.find(c => c.id !== myCharId);
    const oppCtrl = oppChar?.controllers?.[0] || {};   // 🛡️ نطاق دالة كامل — تُستخدم في الحفظ وفي الواجهة
    const iWon = data.winnerCharId === myCharId;
    const forfeited = !!data.forfeitBy;
    const wMe = data.wins?.[myCharId] || engine.wins?.[myCharId] || 0;
    const wOpp = oppChar ? (data.wins?.[oppChar.id] || engine.wins?.[oppChar.id] || 0) : 0;
    const reason = data.lastResult?.reason || null;

    // 🎮 v23 — قواعد النمط: وقود الجولة (2 فردي / 4 رباعي / 8 ثماني)
    const rules = modeRules(engine.match?.mode);
    const pot = rules.pot;

    // 💾 حفظ التقدم — مرة واحدة لكل شاشة
    // 🏆 نظام الوقود: الفائز يأخذ كل العلامات (علامته + وقود الخصوم)،
    //    والخاسر خسر علامة دخوله (استُقطعت عند البداية — لا استرجاع)
    // 🛡️ v25 إصلاح تعليق الجولة: كل عمليات الحفظ محمية بـ try/catch —
    //    أي خطأ في الشبكة/الاقتصاد لا يمنع ظهور شاشة النهاية إطلاقًا
    //    (كان انهيار واحد هنا يجمّد الشاشة ويُفقد سجل الجولة).
    const prev = getPlayer() || {};
    const prevLevel = levelFromWins(prev.wins || 0);
    let newLevel = prevLevel;   // 🛡️ يُحدّث داخل الحفظ — وإن فشل يبقى كما هو

    try {
      // 🤖 عدّاد الخصوم الافتراضيين — حركات الخزان تسجلها جهاز المضيف فقط
      const botOppCount = engine.characters
        .filter(c => c.id !== myCharId)
        .reduce((a, c) => a + (c.controllers || []).filter(p => p.isBot).length, 0);
      const winnerIsBot = !!engine.characters
        .find(c => c.id === data.winnerCharId)?.controllers?.some(p => p.isBot);
      const isHostSide = !!engine.isHost;

      if (iWon) {
        addVictoryReward(pot);
        if (isHostSide && botOppCount > 0) {
          // 🏦 الافتراضيون خسروا: وقودهم سُحب من الخزان وأُعطي للاعب الحقيقي
          tankVirtualDraw(botOppCount).catch(() => {});
        }
      } else {
        addLoss();
        if (isHostSide && winnerIsBot) {
          // 🏦 الافتراضي ربح: علامتي عادت إلى الخزان (طلب المستخدم)
          tankVirtualReturn(1).catch(() => {});
        }
      }
      if (isHostSide) tankRoundPlayed(1).catch(() => {});

      // 🤖 تسجيل نتائج اللاعبين الافتراضيين في ملفاتهم بسجلهم (جهاز المضيف)
      if (isHostSide) {
        engine.characters.forEach(c => {
          const vp = (c.controllers || []).find(p => p.isVirtual && p.vpId);
          if (!vp) return;
          recordVirtualRound(vp.vpId, {
            won: data.winnerCharId === c.id,
            myScore: data.wins?.[c.id] || 0,
            oppScore: data.wins?.[myCharId] || 0,
            opponent: { name: prev.name || 'لاعب', isVirtual: false }
          }).catch(() => {});
        });
      }

      // 📊 عدّادات ملف اللاعب (الأدمن يراجعها): صحيحة/خاطئة/جولات
      const after = updatePlayer({
        totalVictories: (prev.totalVictories || 0) + wMe,
        correctAnswers: (prev.correctAnswers || 0) + (engine.myCorrect || 0),
        wrongAnswers: (prev.wrongAnswers || 0) + (engine.myWrong || 0),
        roundsPlayed: (prev.roundsPlayed || 0) + 1
      });

      // 🧮 عدّادات شروط جوائز الذكاء (تُصفّر عند استلام جائزة)
      bumpAwardCounter('roundsPlayed', 1);
      if (iWon) bumpAwardCounter('wins', 1);

      // 🔄 حفظ أسئلة هذه الجولة في ذاكرة الدورة — لا تكرار حتى تُعرض كلها
      saveRotationMemory(engine.servedIds || []).catch(() => {});

      newLevel = levelFromWins(after.wins || 0);
      syncPlayerToFirestore(after).catch(() => {});
      clearActiveRound(engine.roomId); // 🧹 الجولة انتهت — امسح التسجيل

      // 📜 سجل الجولة (كاتبي أنا — معرف الجولة يجعلها آمنة للتكرار)
      saveMatchResult({
        roundId: engine.roomId,
        result: iWon ? 'win' : 'loss',
        myScore: wMe,
        oppScore: wOpp,
        reason: forfeited ? 'forfeit' : reason,
        opponent: {
          uid: oppCtrl.id || null,
          name: oppCtrl.name || 'الخصم',
          country: oppCtrl.country || '',
          isBot: !!oppCtrl.isBot,
          level: oppCtrl.level || null
        }
      });
    } catch (saveErr) {
      // 🛡️ لا تُفقد شاشة النهاية أبدًا بسبب فشل حفظ — سجل وواصل العرض
      console.warn('[endGame] فشل جزء من حفظ النتيجة (الشاشة ستظهر كالمعتاد):', saveErr?.message || saveErr);
      clearActiveRound(engine.roomId);
    }

    // 🖥️ الواجهة
    document.getElementById('view-game').classList.add('game-over-active');
    if (engine.el.qText) engine.el.qText.textContent = '...';
    if (engine.el.qOptions) engine.el.qOptions.innerHTML = '';

    const leveledUp = newLevel > prevLevel;
    const oppName = this._esc(oppCtrl.name || 'الخصم');

    // 🏆 v24 — «ناتج التحدي»: الفائز يأخذ كل علامات الجولة، والخاسر خسر علامة دخوله
    const rewardCard = iWon
      ? `<div class="end-reward won" id="end-reward-card">
          <span class="end-reward-ico">${icon('tokens')}</span>
          <span class="end-reward-copy">
            <span class="end-reward-label">${t('roundYieldLabel', 'ناتج التحدي')}</span>
            <strong id="end-reward-amount">+${pot}</strong>
            <span class="end-reward-unit">علامة انتصار</span>
          </span>
          <span class="end-reward-note">أخذت كل علامات الجولة</span>
        </div>`
      : `<div class="end-reward spent">
          <span class="end-reward-ico">${icon('tokens')}</span>
          <span class="end-reward-copy">
            <span class="end-reward-label">النتيجة</span>
            <strong>−1</strong>
            <span class="end-reward-unit">علامة انتصار</span>
          </span>
          <span class="end-reward-note">وقود الدخول</span>
        </div>`;

    const headMsg = iWon
      ? (forfeited ? 'فزت — الخصم انسحب!' : 'فزت بالجولة!')
      : (forfeited
          ? (data.forfeitBy === engine.me?.id
              ? '🏳️ انسحبت — حُسبت خسارة'
              : '⏳ غاب الخصم — فزت بالجولة')
          : 'انتهت المباراة');

    // 📊 إحصائيات هذه الجولة فقط (بلا أي إحصائيات تراكمية للحساب):
    // كل الزملاء والخصم من المشاركين مرتّبين بوضوح
    const roundStats = engine.stateSync?.getRoundStats?.() || {};
    let colorCursor = 2;   // 🎨 أنا الأخضر (1) وكل خصم يأخذ لونه بالترتيب (2..8)
    const participants = [];
    engine.characters.forEach(c => {
      (c.controllers || []).forEach(p => {
        const s = roundStats[p.id] || {};
        participants.push({
          id: p.id,
          name: p.name || '—',
          country: p.country || '',
          isBot: !!p.isBot,
          level: p.level || null,
          isMe: p.id === engine.me?.id,
          colorIndex: p.id === engine.me?.id ? 1 : colorCursor++,
          characterId: p.characterId || p.equippedCharacter || p.equippedAvatar || null,
          teamId: c.id,
          answered: s.answered || 0,
          correct: s.correct || 0,
          wrong: s.wrong || 0
        });
      });
    });
    const orderedTeams = engine.characters
      .map(c => ({
        id: c.id,
        won: c.id === data.winnerCharId,
        players: participants.filter(p => p.teamId === c.id)
      }))
      .sort((a, b) => Number(b.won) - Number(a.won));
    orderedTeams.forEach(team => team.players.sort((a, b) =>
      (b.correct - a.correct) || (b.wrong - a.wrong) || String(a.name).localeCompare(String(b.name))));

    /* 🏆 v32.1 (طلب المستخدم) — كتلة النتيجة أسفل «انتهت المباراة»:
     *  النمطان الجماعيان («الرباعية» 2v2 و«8 ضد 8» 4v4) لا يعروضان نتيجتي
     *  أنا ضد شخص واحد — فالمباراة جماعية! بدلها بطاقة «الفائز» فقط:
     *  صورته واسمه وعلم دولته + عدد إجابات الصحيحة والخاطئة + زر إضافة
     *  صديق، والضغط على البطاقة يفتح ملفه الشخصي.
     *  النمط الفردي يبقى كما هو تمامًا (أنت — الخصم)، وكل ما عدا هذه
     *  الكتلة (ناتج التحدي · حظًا أوفر · سجل الجولة · الفريق الخاسر ·
     *  زر العودة) يبقى كما هو في كل الأنماط. */
    const groupMode = isGroupMode(engine.match?.mode);
    const winTeam = orderedTeams.find(t => t.won) || null;
    const winnerPerson = (groupMode && winTeam) ? (winTeam.players[0] || null) : null;

    let scoreBlock = `
      <div class="end-score">
        <div class="end-side me"><span class="end-num">${wMe}</span><span class="end-lbl">أنت</span></div>
        <div class="end-dash">—</div>
        <div class="end-side opp"><span class="end-num">${wOpp}</span><span class="end-lbl">${oppName}</span></div>
      </div>`;

    if (groupMode && winnerPerson) {
      const wp = winnerPerson;
      const wpic = getProfilePicture({ equippedCharacter: wp.characterId });
      const wAvatar = wpic?.image
        ? `<img src="${this._esc(wpic.image)}" alt="" draggable="false">`
        : this._esc(wpic?.emoji || getFlag(wp.country));
      const wYou = wp.isMe ? ` <span class="you">(${t('rosterYou', 'أنت')})</span>` : '';
      const wAdd = wp.isMe
        ? '<span class="er-add ghost" aria-hidden="true"></span>'
        : `<button class="er-add" data-add="${this._esc(wp.id)}" title="${t('addFriend', 'إضافة صديق')}" aria-label="${t('addFriend', 'إضافة صديق')}">➕</button>`;
      scoreBlock = `
        <div class="end-winner">
          <div class="ew-tag">🏆 ${t('winnerTag', 'الفائز')}</div>
          <div class="ew-row" id="ew-profile" data-uid="${this._esc(wp.id)}"
            data-name="${this._esc(wp.name)}" data-country="${this._esc(wp.country || '')}"
            data-level="${Number(wp.level) || 1}" data-bot="${wp.isBot ? '1' : '0'}">
            <span class="ew-avatar">${wAvatar}</span>
            <div class="ew-info">
              <div class="ew-name">${this._esc(wp.name)} <span class="ew-flag">${getFlag(wp.country || '')}</span>${wYou}</div>
              <div class="ew-chips">
                <span class="er-chip ok" title="${t('rosterCorrect', 'إجابات صحيحة')}"><b>✓ ${wp.correct}</b><small>${t('rosterCorrect', 'صحيح')}</small></span>
                <span class="er-chip bad" title="${t('rosterWrong', 'إجابات خاطئة')}"><b>✗ ${wp.wrong}</b><small>${t('rosterWrong', 'خطأ')}</small></span>
              </div>
            </div>
            ${wAdd}
          </div>
        </div>`;
    }

    engine.el.overlay.classList.remove('hidden');
    engine.el.overlay.innerHTML = `
      <div class="end-card ${iWon ? 'won' : 'lost'}">
        <div class="end-result-mark ${iWon ? 'win' : 'loss'}" aria-hidden="true">${icon(iWon ? 'tokens' : 'swords')}</div>
        <h2 class="end-title ${iWon ? 'win' : 'lose'}">${headMsg}</h2>

        ${scoreBlock}
        <div class="end-sub">${iWon ? 'أحسنت، انتصار رائع!' : 'حظًا أوفر'}</div>

        ${rewardCard}
        ${iWon ? `
        <button class="end-double" id="btn-double-win" title="${t('doubleResultTitle', 'مضاعفة الناتج الكلي')}">
          <span class="ed-ico">${icon('camera')}</span>
          <span class="ed-texts">
            <b>${t('doubleResultDesc', 'شاهد الفيديو واحصل على مكافئة 2X')}</b>
            <span>الناتج الكلي يصبح <b dir="ltr">+${pot * 2}</b> علامات انتصار</span>
          </span>
          <span class="ed-video">${icon('play')}</span>
        </button>` : ''}

        ${leveledUp ? `<div class="end-levelup">🎉 ترقية! وصلت إلى المستوى ${newLevel}</div>` : ''}

        <div class="end-roster">
          <div class="er-title">📊 سجل الجولة</div>
          ${orderedTeams.map(team => `
            <section class="er-team ${team.won ? 'winner' : 'loser'}">
              <h3 class="er-team-title">${team.won ? 'الفريق الفائز' : 'الفريق الخاسر'}</h3>
              ${team.players.map(p => this._rosterRow(p)).join('')}
            </section>
          `).join('')}
        </div>

        <div class="end-actions">
          <button class="btn btn-ghost big" id="btn-back-main">${icon('homeNav')} <span>${t('backHomeBtn', 'العودة')}</span></button>
        </div>
      </div>
    `;

    document.getElementById('btn-back-main').onclick = () => engine.destroy(false);

    // 👤 v32.1 — بطاقة الفائز في الأنماط الجماعية: الضغط عليها يفتح الملف
    //    الشخصي (اسمه وصورته وعلمه) — زر ➕ داخلها لا يفتح الملف
    const ewEl = document.getElementById('ew-profile');
    if (ewEl) {
      ewEl.classList.add('clickable');
      ewEl.onclick = (ev) => {
        if (ev.target.closest('.er-add')) return;   // ضغط زر إضافة الصديق — ليس ضغطًا على البطاقة
        openPlayerProfile(ewEl.dataset.uid, {
          name: ewEl.dataset.name,
          country: ewEl.dataset.country || 'SA',
          level: Number(ewEl.dataset.level) || 1,
          isBot: ewEl.dataset.bot === '1'
        }).catch(() => {});
      };
    }

    // ✖️2 مضاعفة نتيجة الجولة المنتصرة بمشاهدة إعلان (v19 — طلب المستخدم)
    const dblBtn = document.getElementById('btn-double-win');
    if (dblBtn) {
      dblBtn.onclick = async () => {
        dblBtn.disabled = true;
        dblBtn.classList.add('busy');
        const watched = await playAd('double');   // 🎬 إعلان المضاعفة
        if (!watched) {
          dblBtn.disabled = false;
          dblBtn.classList.remove('busy');
          return;
        }
        const res = doubleWinReward(engine.roomId, pot);
        if (res.ok) {
          dblBtn.classList.add('done');
          const amount = document.getElementById('end-reward-amount');
          const note = document.querySelector('#end-reward-card .end-reward-note');
          if (amount) amount.innerHTML = `+${pot + (res.extra || 0)}<span class="x2-chip">✖️2</span>`;
          if (note) note.textContent = 'اكتملت المضاعفة الكلية';
          dblBtn.innerHTML = `<span class="ed-ico">${icon('tokens')}</span>
            <span class="ed-texts"><b>تمت مضاعفة الناتج الكلي</b>
            <span>+${pot + (res.extra || 0)} علامة انتصار إجمالًا</span></span>`;
          syncPlayerToFirestore(getPlayer()).catch(() => {});
        } else {
          dblBtn.classList.add('done');
          if (res.msg === 'تمت المضاعفة سابقًا') {
            const amount = document.getElementById('end-reward-amount');
            const note = document.querySelector('#end-reward-card .end-reward-note');
            if (amount) amount.innerHTML = `+${pot * 2}<span class="x2-chip">✖️2</span>`;
            if (note) note.textContent = 'اكتملت المضاعفة الكلية';
          }
          dblBtn.innerHTML = `<span class="ed-ico">✓</span>
            <span class="ed-texts"><b>${res.msg || t('doubleDone', 'تمت مضاعفة النتيجة سابقًا')}</b></span>`;
        }
      };
    }

    // ➕ أزرار إضافة الصداقة بجانب كل مشارك — الحالات تُجلب دفعة واحدة
    //    (٣ استعلامات مهما كان عدد المشاركين) ثم تُربط محليًا:
    //    صديقان 🤝 / طلبي معلّق ⏳ / 📩 هو أرسل لي (قبول!) / ➕ إضافة
    let friends = [], incoming = [], sent = [];
    try {
      [friends, incoming, sent] = await Promise.all([
        getFriendsList(), getIncomingRequestsOnce(), getSentRequests()
      ]);
    } catch {}
    const friendSet = new Set((friends || []).map(f => f.uid));
    const incFrom = new Map((incoming || []).map(r => [r.from, r]));
    const sentTo = new Set((sent || []).filter(r => r.status === 'pending').map(r => r.to));

    document.querySelectorAll('.er-add[data-add]').forEach(btn => {
      const uid = btn.dataset.add;
      const p = participants.find(x => x.id === uid);
      if (!p) return;

      if (friendSet.has(uid)) {
        btn.textContent = '🤝';
        btn.disabled = true;
        btn.title = t('alreadyFriends', 'صديقان بالفعل');
        return;
      }

      if (incFrom.has(uid)) {
        btn.textContent = '📩';
        btn.title = t('acceptFriendTitle', 'أرسل لك طلب صداقة — اضغط للقبول');
        btn.onclick = async () => {
          btn.disabled = true;
          btn.textContent = '⏳';
          const res = await acceptFriendRequest(incFrom.get(uid)).catch(() => ({ ok: false }));
          if (res.ok) { friendSet.add(uid); btn.textContent = '🤝'; btn.title = t('alreadyFriends', 'صديقان بالفعل'); }
          else { btn.textContent = '📩'; btn.disabled = false; }
        };
        return;
      }

      if (sentTo.has(uid)) {
        btn.textContent = '⏳';
        btn.disabled = true;
        btn.title = t('requestPending', 'طلبك معلّق حتى الموافقة');
        return;
      }

      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = '⏳';
        const res = await sendFriendRequest({
          uid: p.id,
          name: p.name,
          country: p.country || 'SA',
          isBot: p.isBot
        });
        if (res.ok) {
          // ✈️ v24 (طلب المستخدم): تأثير تفاعلي — يتحول الزر إلى سهم
          //    مُرسل مع إشعار واضح باسم اللاعب المُرسل إليه الطلب
          btn.classList.add('sent');
          btn.innerHTML = icon('send');
          btn.title = t('requestPending', 'طلبك معلّق حتى الموافقة');
          notify(`✈️ ${t('friendReqSentTo', 'أرسلت طلب إضافة إلى')} (${p.name})`, 'success');
        } else {
          btn.textContent = '➕';
          btn.disabled = false;
          btn.title = res.msg || '';
        }
      };
    });
  }
}
