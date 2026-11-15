// lobby.js
// ============================================================
// 🏟️ المطابقة — النسخة 5 "30 ثانية + دخول تدريجي + طقم 7 بوتات"
//
// القواعد الجديدة (بناءً على طلب المستخدم):
//  1) من يضغط "ابدأ جولة" يبحث فورًا عن غرفة منتظرة وينضم لها —
//     قاعدة الحسم: الأقدم فوزًا (أصغر معرف) فيلتقي الجميع في نفس
//     الغرفة ولا يفتح كل لاعب جولة منفصلة.
//  2) من لا يجد غرفة يُنشئها ويقف فيها 30 ثانية — ويلتحق به بقية
//     اللاعبين خلال ثوانٍ (إعادة بحث كل 3.5 ثوانٍ).
//  3) أول 25 ثانية: للبحث عن لاعبين حقيقيين حصريًا. آخر 5 ثوانٍ
//     (26→30): البوتات تدخل واحدًا تلو الآخر في لحظات عشوائية
//     متفرقة — انضمام طبيعي بلا مفاجأة دفعة واحدة.
//  4) 🤖 طقم 7 بوتات لكل لاعب حقيقي بمستويات متدرجة فوق مستواه:
//     1v1 خصم واحد | 2v2 زميل + خصمان | 4v4 ثلاثة زملاء + 4 خصوم —
//     وأسماؤهم تتبدل عشوائيًا في كل جولة جديدة.
//  5) 🧩 الفريق = لاعب واحد مجازي: أول إجابة من أي عضو تُعتمد
//     للفريق كله وتُقفل الخيارات على بقية الأعضاء (انظر stateSync).
//  6) اعتماد غرفتي المنتظرة بعد تحديث الصفحة بدل إنشاء أخرى +
//     حذف الغرف اليتيمة → لا جولات مكررة في قاعدة البيانات.
//  7) إطلاق موحد: وثيقة اللعبة تُنشأ بوضع "شرح" — شاشة شرح 5
//     ثوانٍ يُكتب فيها السؤال الأول بوقت بدء موحد للطرفين.
//  8) تسجيل الجولة النشطة (presence) → استئناف خلال دقيقتين
//     من الغياب، وبعدها تُحسب انسحابًا (انظر game/presence.js).
// ============================================================

import { ensureAuth, db } from './firebase-config.js';
import { getPlayer } from './auth.js';
import { serverNow } from './game/serverTime.js';
import {
  fetchVirtualPlayers, pickVirtualOpponents
} from './game/virtualPlayers.js';
import { claimActiveRound } from './game/presence.js';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp,
  collection, query, where, getDocs, runTransaction, arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import {
  INTRO_MS, BOT_FILL_AT_MS, ROOM_TTL_MS, RESCAN_MS, WAIT_TOTAL_MS
} from './game/config.js';
import { levelFromWins } from './game/levels.js';

// ⚙️ توافق الاستيرادات القديمة — مصدر الحقيقة game/levels.js
export { getPlayerLevel, botSkillForLevel } from './game/levels.js';

export const MODE_CONFIG = {
  // 🎮 v23 — أنماط التحدي: كل اللاعبين منافسون أفرادًا (فريق = لاعب واحد):
  //   1v1  → فردي  (2 لاعبين، 11 سؤالًا، سؤال حاسم عند التعادل)
  //   2v2  → الرباعية (4 لاعبين، أول من يصل 5 إجابات صحيحة يفوز، 20 سؤالًا)
  //   4v4  → 8 ضد 8 (8 لاعبين، أول من يصل 8 إجابات صحيحة يفوز، 64 سؤالًا)
  '1v1': { capacity: 2, characters: 2, teamSize: 1 },
  '2v2': { capacity: 4, characters: 4, teamSize: 1 },
  '4v4': { capacity: 8, characters: 8, teamSize: 1 }
};

export function getMode() {
  const el = document.querySelector('input[name="mode"]:checked');
  return el ? el.value : '1v1';
}

/* ==========================================================
 * 1. المطابقة العشوائية (قائمة انتظار عالمية)
 * ========================================================== */

// حالة جلسة البحث الحالية (لزر الإلغاء)
let activeMM = null;

/** 🚫 إلغاء البحث: تنظيف كامل (مستمعون + مؤقتات + حذف غرفتي المنتظرة) */
export function cancelMatchmaking() {
  const mm = activeMM;
  if (!mm) return;
  mm.finished = true;
  mm.unsubs.forEach(u => { try { u(); } catch {} });
  mm.timers.forEach(t => { clearTimeout(t); clearInterval(t); });
  if (mm.myRoomId) {
    deleteDoc(doc(db, 'matchmaking', mm.myRoomId)).catch(() => {});
  }
  if (activeMM === mm) activeMM = null;
}

export async function startMatchmaking(mode, onProgress, onReady, opts = {}) {
  await ensureAuth();
  const me = getPlayer();
  const cfg = MODE_CONFIG[mode];
  const cap = cfg.capacity;

  // 🧬 حمل شخصيتك ومستواك معك في مقعدك — فيرى خصمك مظهرك الحقيقي
  const mePlayer = {
    id: me.id, name: me.name, country: me.country, isBot: false,
    level: levelFromWins(me.wins || 0),
    wins: me.wins || 0,
    characterId: me.equippedCharacter || me.equippedAvatar || null,
  };

  const mm = {
    finished: false,
    myRoomId: null,      // الغرفة التي أنشأتها
    joinedRoomId: null,  // غرفة صاحبها غيري انضممت إليها
    unsubs: [],
    timers: [],
    listening: new Set(),
    roomPlayers: []       // 🧠 آخر لقطة لاعبين (تمنع الإضافات الزائدة)
  };
  activeMM = mm;

  const cleanup = () => {
    mm.unsubs.forEach(u => { try { u(); } catch {} });
    mm.timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    mm.unsubs = [];
    mm.timers = [];
  };
  const finish = () => {
    if (mm.finished) return;
    mm.finished = true;
    cleanup();
    if (activeMM === mm) activeMM = null;
  };

  /* --- الاستماع لغرفة (عندي أو غرفة انضممت لها) --- */
  const listenRoom = (roomId) => {
    if (mm.listening.has(roomId)) return;
    mm.listening.add(roomId);
    const unsub = onSnapshot(doc(db, 'matchmaking', roomId), (snap) => {
      if (mm.finished) return;
      if (!snap.exists()) {
        // 🚪 v24: الغرفة اختفت — أنا منضم (لست المنشئ)؟
        //    يعني أن منشئ الجولة ألغاها → رسالة + عودة للرئيسية + استرجاع العلامة
        if (roomId === mm.joinedRoomId && opts.onRoomClosed) {
          finish();
          opts.onRoomClosed('cancelled');
        }
        return;
      }
      const data = snap.data();
      mm.roomPlayers = [...(data.players || [])]; // 🧠 ذاكرة اللقطة الحية

      // 🚪 v24: أُزلت من الغرفة بعلامة ✕ من منشئ الجولة
      const amHost = data.hostId === me.id;
      if (roomId === mm.joinedRoomId && !amHost
          && !(data.players || []).some(p => p.id === me.id)
          && opts.onRoomClosed) {
        finish();
        opts.onRoomClosed('removed');
        return;
      }

      // ⏱️ v24: وقت الجولة واحد لكل اللاعبين — نمرر لحظة إنشاء الغرفة
      //    (الساعة الموحدة) كي يكون عدّاد التجهيز متطابقًا على كل الأجهزة
      onProgress('جاري البحث عن لاعبين...', data.players, {
        roomId,
        createdAtMs: data.createdAt?.toMillis?.() || 0
      });
      if ((data.players?.length || 0) >= (data.capacity || cap)) {
        launchMatch({ roomId, ...data });
      }
    }, (err) => {
      console.warn('[Matchmaking] خطأ استماع:', err?.message || err);
    });
    mm.unsubs.push(unsub);
  };

  /* --- حجز مقعد داخل غرفة عبر معاملة (مسار بارد — مرة لكل مباراة)
         لضمان عدم انضمام لاعبين اثنين لنفس المقعد الأخير ---
         🧩 تفضيل الفريق الأول: البشر يتجمعون في فريق المضيف أولًا
         ثم يُوجَّه الفائض لفريق الخصوم (فريق = كتلة واحدة). */
  const tryClaimSeat = async (roomId) => {
    try {
      return await runTransaction(db, async (tx) => {
        const ref = doc(db, 'matchmaking', roomId);
        const snap = await tx.get(ref);
        if (!snap.exists()) return null;
        const d = snap.data();
        if (d.status !== 'waiting') return null;

        const players = [...(d.players || [])];
        if (players.some(p => p.id === me.id)) {
          return { roomId, ...d, players }; // أنا موجود مسبقًا — استئناف
        }

        const roomCap = d.capacity || cap;
        if (players.length >= roomCap) return null; // امتلأت

        // استبدل مقعد بوت: أقرب بوت داخل فريق المضيف أولًا، وإلا أي بوت
        const ts = MODE_CONFIG[d.mode || mode]?.teamSize || cfg.teamSize;
        const inMyTeam = players.findIndex((p, i) => i < ts && p.isBot);
        const anyBot = players.findIndex(p => p.isBot);
        const botIndex = inMyTeam !== -1 ? inMyTeam : anyBot;
        if (botIndex !== -1) players[botIndex] = mePlayer;
        else players.push(mePlayer);

        tx.update(ref, { players });
        return { roomId, ...d, players };
      });
    } catch {
      return null; // تصادم مع منضم آخر — الفحص التالي يعيد المحاولة
    }
  };

  /* --- مسح الغرف المنتظرة (الأقدم أولًا = قاعدة الحسم) ---
     ⚖️ بلا ساعات أجهزة: عندما أملك غرفة أنضم فقط لغرفة معرفها
     أصغر من معرفي — فلكل اللاعبين اتجاه واحد مهما تزامن الضغط. */
  const scanForWaitingRoom = async (onlyOlderThanMine) => {
    try {
      const q = query(
        collection(db, 'matchmaking'),
        where('mode', '==', mode),
        where('status', '==', 'waiting')
      ); // فلترتا مساواة فقط — لا حاجة لأي Composite Index
      const snap = await getDocs(q);
      const nowMs = Date.now();

      const candidates = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(r => r.id !== mm.myRoomId && r.id !== mm.joinedRoomId)
        .filter(r => r.hostId !== me.id)                              // لا غرفتي
        .filter(r => (r.players?.length || 0) < (r.capacity || cap))  // فيها شاغر
        .filter(r => !r.createdAt?.toMillis
          || (nowMs - r.createdAt.toMillis()) < ROOM_TTL_MS)          // ليست ميتة
        .filter(r => !onlyOlderThanMine || !mm.myRoomId
          || r.id < mm.myRoomId)                                      // ⚖️ الأقدم يفوز
        .sort((a, b) =>
          (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));

      for (const room of candidates) {
        const claimed = await tryClaimSeat(room.id);
        if (claimed) return claimed;
      }
    } catch (e) {
      console.warn('[Matchmaking] فشل المسح:', e?.message || e);
    }
    return null;
  };

  /* --- 🔄 اعتماد غرفتي المنتظرة إن وُجدت (استئناف بعد التحديث) ---
     نفس الغرفة تُستأنف بدل إنشاء غرفة جديدة — فلا جولات مكررة
     في قاعدة البيانات ولا "بوت أخذ مكاني". */
  const adoptMyWaitingRoom = async () => {
    try {
      const snap = await getDocs(query(
        collection(db, 'matchmaking'),
        where('hostId', '==', me.id),
        where('status', '==', 'waiting')
      ));
      const now = Date.now();
      let freshest = null;
      snap.docs.forEach(d => {
        const created = d.data().createdAt?.toMillis?.() || 0;
        if (!created || now - created > ROOM_TTL_MS) {
          deleteDoc(d.ref).catch(() => {}); // 🧹 غرفة يتيمة قديمة
          return;
        }
        if (!freshest || created < (freshest.createdAt?.toMillis?.() || Infinity)) {
          freshest = { id: d.id, ...d.data() };
        }
      });
      return freshest;
    } catch { return null; }
  };

  /* --- إنشاء غرفتي الخاصة والاستماع لها --- */
  const ensureOwnRoom = async () => {
    if (mm.myRoomId || mm.joinedRoomId) return;
    const roomId = mode + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    mm.myRoomId = roomId;
    try {
      await setDoc(doc(db, 'matchmaking', roomId), {
        roomId,
        hostId: me.id,
        mode,
        capacity: cap,
        status: 'waiting',
        players: [mePlayer],
        createdAt: serverTimestamp()
      });
      listenRoom(roomId);
    } catch (e) {
      console.warn('[Matchmaking] فشل إنشاء الغرفة:', e?.message || e);
    }
  };

  /* --- بعد الانضمام لغرفة غيري: احذف غرفتي وانتظر فيها --- */
  const onJoinedRoom = (room) => {
    if (mm.finished) return;
    mm.joinedRoomId = room.roomId || room.id;
    mm.roomPlayers = [...(room.players || [])];
    if (mm.myRoomId) {
      deleteDoc(doc(db, 'matchmaking', mm.myRoomId)).catch(() => {});
      mm.myRoomId = null;
    }
    listenRoom(mm.joinedRoomId);
    if ((room.players?.length || 0) >= (room.capacity || cap)) {
      launchMatch(room);
    }
  };

  /* --- 🤖 دخول الخصوم التلقائيين تدريجيًا خلال آخر 5 ثوانٍ ---
   * المشكلة السابقة: كل البوتات كانت تدخل دفعة واحدة في آخر ثانيتين
   * (شكل مفاجئ وغير طبيعي). الحل الجديد:
   *  - الثانية 25: فحص أخير عن إنسان حقيقي قبل بدء الدخول
   *  - الثواني 26→30: كل مقعد فارغ يستلم لاعبًا واحدًا في لحظة
   *    عشوائية متفرقة (زملاء الفريق أولًا ثم الخصوم) — انضمام
   *    متدرج يبدو واقعيًا تمامًا.
   *  - عند الثانية 30: تعبئة أمان لأي مقعد تبقى ثم الإقلاع تلقائيًا.
   *  - الأسماء والأعلام والشخصيات من طقم 7 بوتات جديد كل جولة.
   *
   * 🛠️ الإصلاح (v6): كان سابقًا استخدام runTransaction لكتابة مصفوفة
   *    players كاملة — فيتصادم مع أي انضمام بشري متزامن عبر شرط
   *    updateTime ويفشل بـ 400 failed-precondition في حلقة لا تتوقف.
   *    الآن الكتابة ذرّية بسيطة: arrayUnion(bot) — لا شرط updateTime
   *    إطلاقًا (المضيف هو الكاتب الوحيد للبوتات)، وarrayUnion لا يضيف
   *    البوت مرتين أبدًا (مطابقة عميقة بالمعرف) — صفر اصطدامات.
   *    التحقق من السعة يسبق الكتابة بقراءة رخيصة + ذاكرة اللقطة الحية. */
  const addOneBotTx = async (bot) => {
    if (mm.finished || !mm.myRoomId || mm.joinedRoomId) return;
    const ref = doc(db, 'matchmaking', mm.myRoomId);
    try {
      // 🚧 فحص مسبق رخيص: غرفة مغلقة أو ممتلئة أو فيها هذا البوت؟
      //    (ذاكرة اللقطة الحية أولًا — مجانية وفورية)
      if ((mm.roomPlayers?.length || 0) >= cap) return;
      if (mm.roomPlayers?.some(p => p.id === bot.id)) return;

      // 📖 قراءة تأكيدية واحدة قبل الكتابة (تغطي الحالات النادرة)
      const pre = await getDoc(ref);
      if (!pre.exists()) return;
      const pd = pre.data();
      if (pd.status !== 'waiting') return;
      const prePlayers = [...(pd.players || [])];
      if (prePlayers.length >= (pd.capacity || cap)) return; // امتلأت ببشر
      if (prePlayers.some(p => p.id === bot.id)) return;     // مكرر
      mm.roomPlayers = prePlayers;

      // ⚛️ إضافة ذرّية آمنة — لا تصادم ولا شرط updateTime
      await updateDoc(ref, { players: arrayUnion(bot) });
      if (!mm.roomPlayers.some(p => p.id === bot.id)) {
        mm.roomPlayers = [...mm.roomPlayers, bot];
      }
    } catch {
      // فشل شبكة عابر؟ البوت التالي أو تعبئة الأمان يغطي المقعد —
      // ولا حاجة لأي إعادة محاولة عدوانية تُشبع السجل بأخطاء 400
    }
  };

  /* --- 🤖 تعبئة المقاعد: لاعبون افتراضيون من قائمة الإدارة فقط ---
   * 🚫 v24 (طلب المستخدم): لا لاعبين افتراضيين عشوائيين إطلاقًا —
   *    لا ينضم أي بوت لم يضفه المطور يدويًا في قائمة اللاعبين
   *    الافتراضيين، حتى لو ضغط اللاعب «انطلق للتحدي».
   * الاختيار بالمستوى: الهدف = مستوى اللاعب الحقيقي + 2 (بسقف 200).
   * اللاعب الافتراضي يمكنه الدخول لأكثر من جولة في نفس الوقت —
   * كل جولة تأخذ نسخة مستقلة من القالب باسم عشوائي من قائمة أسمائه. */
  const fillSeats = async (teammatesNeeded, opponentsNeeded, seedStr) => {
    const needed = teammatesNeeded + opponentsNeeded;
    if (needed <= 0) return [];
    const myLevel = levelFromWins(me.wins || 0);
    await fetchVirtualPlayers().catch(() => {});
    return pickVirtualOpponents(myLevel, needed, seedStr || mm.myRoomId || mode);
  };

  const scheduleGradualBotFill = async ({ compressMs = 0 } = {}) => {
    if (mm.finished || !mm.myRoomId || mm.joinedRoomId) return;

    // 🔍 فرصة أخيرة عن إنسان حقيقي قبل بدء دخول البوتات
    const room = await scanForWaitingRoom(true);
    if (mm.finished) return;
    if (room) { onJoinedRoom(room); return; }
    if (!mm.myRoomId || mm.joinedRoomId) return;

    // ⏱️ عمر الغرفة الحقيقي (استئناف غرفة قديمة يضغط النافذة)
    let age = 0;
    let cur = [];
    try {
      const snap = await getDoc(doc(db, 'matchmaking', mm.myRoomId));
      if (!snap.exists()) return;
      age = Math.max(0, Date.now() - (snap.data().createdAt?.toMillis?.() || Date.now()));
      cur = [...(snap.data().players || [])];
    } catch { return; }
    if (cur.length >= cap) return; // امتلأت أثناء الفحص — الإقلاع قادم

    // 🧮 التكوين: مقاعد فريقي الفارغة أولًا ثم مقاعد الخصوم
    const teammatesNeeded = Math.max(0, Math.min(cfg.teamSize, cap) - cur.length);
    const opponentsNeeded = Math.max(0, cap - cur.length - teammatesNeeded);

    const myLevel = levelFromWins(me.wins || 0);
    const seedStr = mm.myRoomId || mode;
    const picked = await fillSeats(teammatesNeeded, opponentsNeeded, seedStr);
    if (!picked.length) return;

    // 🎲 نافذة التوزيع العشوائي: افتراضيًا الثواني 26→30
    const startIn = compressMs
      ? Math.round(compressMs * 0.2)
      : Math.max(600, BOT_FILL_AT_MS - age);
    const spread = compressMs
      ? Math.max(1200, compressMs - startIn)
      : Math.max(1500, WAIT_TOTAL_MS - age - startIn - 700);

    const slot = spread / picked.length;
    picked.forEach((bot, i) => {
      const jitter = Math.random() * slot * 0.55;
      const delay = Math.max(200, startIn + i * slot + jitter);
      const t = setTimeout(() => addOneBotTx(bot), delay);
      mm.timers.push(t);
    });

    // 🧯 تعبئة أمان عند نهاية الانتظار: أي مقعد لم يمتلئ (مؤقت مُقيَّد
    //    في خلفية الجوال مثلًا) يُملأ فورًا ليقلاع الجميع في موعدهم
    const safetyIn = Math.max(startIn + spread + 500, (WAIT_TOTAL_MS - age) + 800);
    const safety = setTimeout(async () => {
      if (mm.finished || !mm.myRoomId || mm.joinedRoomId) return;
      try {
        const snap = await getDoc(doc(db, 'matchmaking', mm.myRoomId));
        if (!snap.exists()) return;
        const players = [...(snap.data().players || [])];
        const left = cap - players.length;
        const filled = await fillSeats(0, left, mm.myRoomId + ':safe:' + Date.now());
        for (const b of filled) {
          await addOneBotTx(b);
        }
      } catch {}
    }, safetyIn);
    mm.timers.push(safety);

    console.info('[Matchmaking] 🤖 جدولة دخول تدريجي:', picked.length,
      'لاعبين خلال', Math.round((startIn + spread) / 1000), 'ثانية');
  };

  /* --- 🏁 إقلاع المباراة: الطرفان يشاركان نفس gameStates/{roomId} ---
     وثيقة بوضع "شرح" (intro) مع introEndsAtMs موحد → شاشة شرح
     5 ثوانٍ ثم السؤال الأول في نفس اللحظة على الجهازين. */
  const launchMatch = async (roomData) => {
    if (mm.finished) return;
    finish();

    const players = roomData.players || [];
    const isOwner = players[0]?.id === me.id;
    onProgress('تم إيجاد المباراة!', players);

    const allPlayers = players.map(p => ({
      ...p,
      characterId: p.characterId || (p.isBot ? 'warrior' : (me.equippedCharacter || null)),
      level: p.level || (p.isBot ? null : levelFromWins(me.wins || 0))
    }));

    const characters = [];
    for (let c = 0; c < cfg.characters; c++) {
      characters.push({
        id: 'char_' + c,
        index: c,
        controllers: allPlayers.slice(c * cfg.teamSize, (c + 1) * cfg.teamSize)
      });
    }

    if (isOwner) {
      try {
        const introEndsAtMs = serverNow() + INTRO_MS + 1200;
        await setDoc(doc(db, 'gameStates', roomData.roomId), {
          hostId: roomData.hostId,
          mode,
          characters,
          wins: Object.fromEntries(characters.map(ch => [ch.id, 0])),   // 🏆 صفر للطرفين
          shields: {},
          questionIndex: 0,
          question: null,
          answers: {},
          lastResult: null,
          hb: {},                     // 💓 نبضات الحضور
          status: 'intro',            // 📖 شاشة الشرح أولًا
          introEndsAtMs,              // ⏱️ الإطلاق الموحد للطرفين
          startedAtMs: serverNow(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        await deleteDoc(doc(db, 'matchmaking', roomData.roomId)).catch(() => {});
      } catch (e) {
        console.warn('[Matchmaking] فشل تهيئة وثيقة اللعبة:', e?.message || e);
      }
    }

    // 📌 تسجيل الجولة النشطة — للاستئناف خلال دقيقتين بعد أي خروج
    claimActiveRound(roomData.roomId);

    // الطرفان معًا — نفس roomCode → نفس وثيقة اللعبة المشتركة
    onReady({
      mode,
      characters,
      teamSize: cfg.teamSize,
      roomCode: roomData.roomId,
      isBotMatch: allPlayers.some(p => p.isBot)
    });
  };

  /* ================ الدورة الرئيسية ================ */
  onProgress('جاري البحث عن لاعبين...', null);

  // 1) 🔄 اعتماد غرفتي المنتظرة إن وُجدت (استئناف بعد تحديث الصفحة)
  const mine = await adoptMyWaitingRoom();
  if (mm.finished) return;
  let fillDelay = BOT_FILL_AT_MS; // موعد دخول الخصوم التلقائيين (الثانية 25)
  if (mine) {
    mm.myRoomId = mine.id;
    listenRoom(mine.id);
    const age = Date.now() - (mine.createdAt?.toMillis?.() || Date.now());
    fillDelay = Math.max(3000, BOT_FILL_AT_MS - age);
    onProgress('جاري البحث عن لاعبين...', mine.players);
    if ((mine.players?.length || 0) >= cap) {
      launchMatch(mine);
      return;
    }
  } else {
    // 2) انضمام فوري لأي غرفة منتظرة
    const initial = await scanForWaitingRoom(false);
    if (mm.finished) return;
    if (initial) {
      onJoinedRoom(initial);
    } else {
      await ensureOwnRoom();
    }
  }

  // 3) 🔄 إعادة البحث الدورية — الالتحاق بأقدم غرفة (قاعدة الحسم):
  //    الجميع يتقارب في غرفة واحدة بدل عشرات الغرف المتوازية
  const rescanTimer = setInterval(async () => {
    if (mm.finished || mm.joinedRoomId) return;
    const room = await scanForWaitingRoom(true);
    if (mm.finished || !room) return;
    onJoinedRoom(room);
  }, RESCAN_MS);
  mm.timers.push(rescanTimer);

  // 4) 🤖 بعد 25 ثانية: دخول تدريجي عشوائي للبوتات خلال الثواني 26→30
  const botFillTimer = setTimeout(() => { scheduleGradualBotFill(); }, fillDelay);
  mm.timers.push(botFillTimer);

  // 5) 🧯 حماية المنضم العالق: غرفة مات صاحبها (ميتة > 40 ثانية
  //    ولم تمتلئ)؟ اخرج منها وابدأ دورة خاصة بك مع دخول سريع للبوتات
  const stuckTimer = setTimeout(async () => {
    if (mm.finished || !mm.joinedRoomId || mm.myRoomId) return;
    try {
      const ref = doc(db, 'matchmaking', mm.joinedRoomId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const d = snap.data();
        if ((d.players?.length || 0) >= (d.capacity || cap)) return; // امتلأت
        const age = Date.now() - (d.createdAt?.toMillis?.() || Date.now());
        if (age < 40000) return; // ما زالت حية — صاحبها سيلحق بها
        // 🧟 غرفة ميتة: أزل نفسي منها
        const players = (d.players || []).filter(p => p.id !== me.id);
        await updateDoc(ref, { players }).catch(() => {});
      }
    } catch {}
    mm.joinedRoomId = null;
    await ensureOwnRoom();
    const retryFillTimer = setTimeout(() => { scheduleGradualBotFill({ compressMs: 5000 }); }, 3000);
    mm.timers.push(retryFillTimer);
  }, 45000);
  mm.timers.push(stuckTimer);
}

/* ==========================================================
 * 2. الغرف المخصصة (Custom Rooms)
 * ========================================================== */
export async function createCustomRoom(mode, customCode) {
  await ensureAuth();
  const me = getPlayer();
  const code = (customCode || '').trim().toUpperCase();
  if (code.length < 3 || code.length > 10) return { ok: false, msg: 'الرمز يجب أن يكون بين 3 و10 أحرف' };

  const roomRef = doc(db, 'rooms', 'custom_' + code);
  const existing = await getDoc(roomRef);
  if (existing.exists()) return { ok: false, msg: 'الرمز مستخدم' };

  const cfg = MODE_CONFIG[mode];
  const room = {
    ownerId: me.id, mode, capacity: cfg.capacity, teamSize: cfg.teamSize,
    characters: cfg.characters, status: 'open', isCustom: true, code,
    createdAt: serverTimestamp(),
    players: [{
      id: me.id, name: me.name, country: me.country, isBot: false,
      level: levelFromWins(me.wins || 0),
      wins: me.wins || 0,
      characterId: me.equippedCharacter || null,
      }]
  };
  await setDoc(roomRef, room);
  return { ok: true, room: { ...room, code } };
}

export async function joinCustomRoom(code) {
  await ensureAuth();
  const me = getPlayer();
  const roomRef = doc(db, 'rooms', 'custom_' + code.trim().toUpperCase());
  const snap = await getDoc(roomRef);
  if (!snap.exists()) return { ok: false, msg: 'الغرفة غير موجودة' };

  const data = snap.data();
  if (data.players.some(p => p.id === me.id)) return { ok: true, room: data };
  if (data.players.length >= data.capacity) return { ok: false, msg: 'الغرفة ممتلئة' };

  const players = [...data.players, {
    id: me.id, name: me.name, country: me.country, isBot: false,
    level: levelFromWins(me.wins || 0),
    wins: me.wins || 0,
    characterId: me.equippedCharacter || null,
  }];
  await updateDoc(roomRef, { players });
  return { ok: true, room: { ...data, players } };
}

export async function buildMatchFromRoom(room) {
  const me = getPlayer();
  const cfg = MODE_CONFIG[room.mode] || MODE_CONFIG['1v1'];
  const allPlayers = room.players.map(p => ({
    ...p,
    characterId: p.characterId || me.equippedCharacter || null,
    level: p.level || levelFromWins(me.wins || 0)
  }));
  // 🤖 المقاعد الناقصة تُكمّل باللاعبين الافتراضيين المُدارين فقط —
  //    لا بوتات مولّدة عشوائيًا إطلاقًا (v24 — طلب المستخدم)
  const realCount = allPlayers.length;
  const teammatesNeeded = Math.max(0, Math.min(cfg.teamSize, cfg.capacity) - realCount);
  const opponentsNeeded = Math.max(0, cfg.capacity - realCount - teammatesNeeded);
  if (teammatesNeeded + opponentsNeeded > 0) {
    try {
      await fetchVirtualPlayers();
    } catch {}
    const picked = pickVirtualOpponents(
      levelFromWins(me.wins || 0),
      teammatesNeeded + opponentsNeeded,
      (room.code || 'room') + ':' + Date.now()
    );
    allPlayers.push(...picked.slice(0, teammatesNeeded + opponentsNeeded));
  }
  const characters = [];
  for (let c = 0; c < cfg.characters; c++) {
    characters.push({
      id: 'char_' + c, index: c,
      controllers: allPlayers.slice(c * cfg.teamSize, (c + 1) * cfg.teamSize)
    });
  }
  return {
    mode: room.mode, characters, teamSize: cfg.teamSize,
    roomCode: room.code, isBotMatch: allPlayers.some(p => p.isBot)
  };
}
