// game/sound.js
// ============================================================
// 🔊 مدير الأصوات — v23 (تحميل كامل عند الإقلاع + تخزين دائم + إعدادات في Firebase)
//
// الأصوات الخمسة من مجلد sound/ (يضيفها المطور خارجيًا):
//   sound1 — النقر (اللمس)
//   sound2 — العلامات ✓/✗ + صوت بين الجولات
//   sound3 — الإجابة الصحيحة
//   sound4 — الإجابة الخاطئة
//   sound5 — موسيقى الخلفية (تكرار دائم)
//
// ✅ جديد v23 (طلب المستخدم):
//  • 🚀 كل الأصوات تُحمّل وتُفك ترميزها فور تحميل اللعبة (قبل أول لمسة)
//    — الأصوات الخمسة جاهزة 100% من اللحظة الأولى فيتعرف اللاعب عليها.
//  • 💾 تخزين دائم عبر IndexedDB: تُحفظ المخازن الرقمية على الجهاز
//    فلا يُعاد تنزيلها في المرات التالية — التشغيل فوري (بلا إعادة تحميل).
//  • ☁️ إعدادات الصوت (تشغيل/إيقاف) تُحفظ مع بيانات اللاعب في Firebase
//    وتُستعاد على أي جهاز يسجّل فيه اللاعب دخوله.
// ============================================================

import { getPlayer, hasPlayer, updatePlayer } from '../auth.js';

const SOUND_FILES = {
  tap:      ['sound/sound1.mp3', 'sound/sound1.ogg', 'sound/sound1.wav', 'sound/sound1.m4a'],
  mark:     ['sound/sound2.mp3', 'sound/sound2.ogg', 'sound/sound2.wav', 'sound/sound2.m4a'],
  correct:  ['sound/sound3.mp3', 'sound/sound3.ogg', 'sound/sound3.wav', 'sound/sound3.m4a'],
  wrong:    ['sound/sound4.mp3', 'sound/sound4.ogg', 'sound/sound4.wav', 'sound/sound4.m4a'],
  bg:       ['sound/sound5.mp3', 'sound/sound5.ogg', 'sound/sound5.wav', 'sound/sound5.m4a']
};

const VOLUMES = { tap: .5, mark: .55, correct: .75, wrong: .75, bg: .32 };
/** مدة صعود صوت الخلفية من الصمت إلى مستواه الطبيعي */
const BG_FADE_MS = 4000;

/* ==========================================================
 * 💾 ذاكرة دائمة (IndexedDB) — المخازن الرقمية تُحفظ على الجهاز
 *    فتعمل الأصوات فورًا في كل زيارة قادمة بلا أي إعادة تنزيل.
 * ========================================================== */
const IDB_NAME = 'ba_sound_cache';
const IDB_STORE = 'buffers';

function _idbOpen() {
  return new Promise((resolve) => {
    try {
      if (!('indexedDB' in window)) return resolve(null);
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function _idbGet(name) {
  const dbp = await _idbOpen();
  if (!dbp) return null;
  return new Promise((resolve) => {
    try {
      const tx = dbp.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(name);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function _idbPut(name, buf) {
  const dbp = await _idbOpen();
  if (!dbp || !buf) return;
  try {
    const tx = dbp.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(buf, name);
  } catch {}
}

/* ==========================================================
 * 🔇 إعداد الصوت العام (تشغيل/إيقاف)
 *    المصدر: ملف اللاعب (Firebase) ← نسخة محلية احتياطية
 * ========================================================== */
const SOUND_PREF_KEY = 'bqa_sound';

function _readInitialPref() {
  // 1) من ملف اللاعب (المحفوظ في Firebase مع بياناته)
  //    🆕 v33.5/v36 (طلب المستخدم): الصوت يعمل دائمًا من أول دخول حتى يوقفه
  //    اللاعب بنفسه من الملف الشخصي — الاختيار الصريح فقط (soundSet=true)
  //    يُحترم على كل الأجهزة
  try {
    const p = getPlayer();
    if (p && p.soundSet === true && typeof p.soundEnabled === 'boolean') return p.soundEnabled;
  } catch {}
  // 🛠️ v36 — الجذر الذي فات v33.5 (شكوى المستخدم: «لم تُحل مشكلة الصوت»):
  //    قيمة bqa_sound='0' القديمة في localStorage كانت تُكتم الصوت عند كل
  //    دخول رغم أن اللاعب لم يوقفه أبدًا. القيمة المحلية الآن لا تُكتم
  //    إلا مع اختيار صريح (soundSet) — والقيمة القديمة تُهاجَر إلى '1'
  try {
    const p = getPlayer();
    if (p && p.soundSet !== true && localStorage.getItem(SOUND_PREF_KEY) === '0') {
      try { localStorage.setItem(SOUND_PREF_KEY, '1'); } catch {}
    }
  } catch {}
  return true;
}

let soundEnabled = true;
try { soundEnabled = _readInitialPref(); } catch {}

/* ==========================================================
 * 👆 بوابة صوت النقرات — v24 (طلب المستخدم):
 *    كل الأصوات تعمل فور دخول اللاعب الصفحة الرئيسية أول مرة،
 *    ما عدا صوت النقرات (sound1) — لا يعمل إلا بعد ضغط اللاعب
 *    على زر «متابعة» في بداية التسجيل قبل كتابة الاسم واختيار العلم.
 *
 * 🛠️ v26 — إصلاح "الأصوات لا تعمل في الدخول الثاني والثالث":
 *    البوابة كانت تُفتح فقط من شاشة التسجيل — واللاعب العائد
 *    (مسجَّل سابقًا) لا يمر بشاشة التسجيل إطلاقًا، فيبقى صوت
 *    النقرات ميتًا طول الجلسة رغم أن الأصوات «مفعّلة» في الملف
 *    الشخصي. الآن: اللاعب العائد (له ملف محفوظ) تُفتح له البوابة
 *    فور الإقلاع، والبوابة تبقى مغلقة فقط لأول تسجيل جديد قبل «متابعة».
 * ========================================================== */
let tapEnabled = false;
try { tapEnabled = hasPlayer(); } catch {}   // 👈 اللاعب العائد: نقرات مفعّلة

/** 🔓 تفعيل صوت النقرات — يُستدعى عند الضغط على زر «متابعة» في التسجيل */
export function enableTapSound() { tapEnabled = true; }

/** 🔊 هل الأصوات مفعّلة؟ */
export function isSoundEnabled() { return soundEnabled; }

/**
 * ☁️ مزامنة تفضيل الصوت من ملف اللاعب (بعد استعادة البيانات من Firebase)
 * — تُستدعى من app.js بعد pullPlayerFromFirestore.
 */
export function applySoundPrefFromPlayer() {
  try {
    const p = getPlayer();
    // 🆕 v33.5 — نطبّق من السحابة فقط إن كان اختيار اللاعب صريحًا (soundSet)
    if (p && p.soundSet === true && typeof p.soundEnabled === 'boolean' && p.soundEnabled !== soundEnabled) {
      soundEnabled = p.soundEnabled;
      try { localStorage.setItem(SOUND_PREF_KEY, soundEnabled ? '1' : '0'); } catch {}
      if (soundEnabled) _resumeBg(); else _silenceBg();
    }
  } catch {}
}

/** 🔇/🔊 تشغيل أو إيقاف كل الأصوات — ويُحفظ مع بيانات اللاعب في Firebase */
export function setSoundEnabled(v) {
  soundEnabled = !!v;
  try { localStorage.setItem(SOUND_PREF_KEY, soundEnabled ? '1' : '0'); } catch {}
  // ☁️ حفظ الإعداد مع بيانات اللاعب — يُزامَن تلقائيًا إلى Firestore
  //    🆕 v33.5: soundSet=true يعني «اختيار صريح من اللاعب» يُحترم على
  //    كل الأجهزة، وبعده فقط نطبّق القيمة المخزنة عند الدخول
  try {
    const p = getPlayer();
    if (p && (p.soundEnabled !== soundEnabled || p.soundSet !== true)) {
      updatePlayer({ soundEnabled, soundSet: true });
    }
  } catch {}
  if (soundEnabled) _resumeBg();
  else _silenceBg();
  return soundEnabled;
}

const state = {
  ctx: null,            // AudioContext
  buffers: {},          // name -> AudioBuffer
  fallbacks: {},        // name -> HTMLAudio (بديل فوري لكل صوت)
  failed: {},           // name -> تعذّر تحميله نهائيًا (لا محاولات أخرى)
  loaded: {},           // name -> اكتمل تحميله (من أي مسار)
  inited: false,
  bgStarted: false,     // طُلبت الخلفية (قبل فتح القفل ربما)
  bgPlaying: false,     // تعمل فعليًا الآن؟ 'web' | 'html' | false
  bgGain: null,
  _bgRampIv: null       // مؤقت الصعود في مسار HTMLAudio
};

/* ----------------------------------------------------------
 * 🚀 التحميل المسبق الكامل — فور تحميل اللعبة (لا انتظار لمسة):
 *    IndexedDB أولًا (فوري بلا شبكة) ← وإلا الشبكة مع كاش المتصفح
 * -------------------------------------------------------- */

async function fetchBuffer(name) {
  // 1) الذاكرة الدائمة على الجهاز — بلا أي اتصال
  const cached = await _idbGet(name);
  if (cached) return cached;
  // 2) الشبكة (مع كاش HTTP force-cache) ثم حفظها للأبد
  for (const url of SOUND_FILES[name]) {
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) continue;
      const arr = await res.arrayBuffer();
      const buf = await state.ctx.decodeAudioData(arr.slice(0));
      _idbPut(name, buf);          // 💾 تخزين دائم للمرة القادمة
      return buf;
    } catch { /* الملف غير موجود أو صيغة غير مدعومة — جرّب التالي */ }
  }
  return null;
}

/** 🔈 عنصر HTMLAudio لكل صوت — بديل فوري إن لم يكن المسار الرقمي جاهزًا */
function _getFallbackEl(name) {
  if (state.failed[name]) return null;
  if (state.fallbacks[name]) return state.fallbacks[name];
  for (const url of SOUND_FILES[name]) {
    const a = new Audio(url);
    a.preload = 'auto';
    a.volume = VOLUMES[name] ?? .6;
    a.addEventListener('error', () => {
      if (state.fallbacks[name] === a) {
        delete state.fallbacks[name];
        state.failed[name] = true;
      }
    }, { once: true });
    state.fallbacks[name] = a;
    return a;
  }
  return null;
}

/** 🔊 شغّل النظام — يُستدعى تلقائيًا عند إقلاع اللعبة */
export function initSoundSystem() {
  if (state.inited) return;
  state.inited = true;

  // 🔓 فتح قفل التشغيل التلقائي — سياسات المتصفحات تتطلب لمسة بشرية:
  //    أي لمسة/نقرة/مفتاح تُنهي الحالة المعلّقة لـ AudioContext
  const unlock = () => unlockAudio();
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach(ev =>
    window.addEventListener(ev, unlock, { passive: true, capture: true }));

  // 🔁 v26 — مراقب استرجاع الخلفية:
  //    إن طُلبت الخلفية ولم تنطلق فعليًا (لمسة لم تصل بعد / رفض
  //    المتصفح الصامت للمسار الصوتي) تُعاد المحاولة دوريًا حتى تنطلق،
  //    وأيضًا عند العودة للتطبيق. هذا ما كان يجبر اللاعب على إيقاف
  //    الأصوات وتشغيلها يدويًا من الملف الشخصي كي تبدأ بالعمل.
  state._bgRetryIv = setInterval(() => {
    if (!state.bgStarted || state.bgPlaying || !soundEnabled) return;
    _maybeStartBg();
  }, 2500);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      unlockAudio();
      if (state.bgStarted && !state.bgPlaying && soundEnabled) _maybeStartBg();
    }
  });

  const boot = async () => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        state.ctx = new AC();
        // 🚀 تحميل كل الأصوات الخمسة فور الإقلاع (من الذاكرة الدائمة أو الشبكة)
        await Promise.all(Object.keys(SOUND_FILES).map(async (name) => {
          const buf = await fetchBuffer(name);
          if (buf) { state.buffers[name] = buf; state.loaded[name] = true; }
        }));
      }
      // 🎵 v26: اكتمل تحميل المخازن — إن كانت الخلفية مطلوبة ولم تنطلق
      //    بعد (لمسة وصلت قبل جاهزية المخزن) ابدأها الآن
      _maybeStartBg();
    } catch { /* صمت تام — الأصوات ميزة اختيارية */ }
  };

  // ⚡ فورًا (وليس عند حدث load فقط) — ثم نُعيد المحاولة بعد load لأي ملف فات
  boot();
  if (document.readyState !== 'complete') {
    window.addEventListener('load', () => {
      Object.keys(SOUND_FILES).forEach(name => {
        if (state.loaded[name]) return;
        fetchBuffer(name).then(buf => {
          if (buf) { state.buffers[name] = buf; state.loaded[name] = true; }
        }).catch(() => {});
      });
    }, { once: true });
  }
}

/* ----------------------------------------------------------
 * 🔓 فتح قفل الصوت — قبل كل تشغيل وعند كل لمسة
 * -------------------------------------------------------- */

let _unlocking = false;

function unlockAudio() {
  if (!state.ctx || _unlocking) {
    if (!state.ctx) _maybeStartBg();          // لا WebAudio؟ الخلفية عبر HTMLAudio
    return;
  }
  if (state.ctx.state === 'running') { _maybeStartBg(); return; }
  _unlocking = true;
  state.ctx.resume().then(() => {
    _unlocking = false;
    _maybeStartBg();
  }).catch(() => { _unlocking = false; });
}

/* ----------------------------------------------------------
 * ▶️ التشغيل — الرقمي من الذاكرة بزمن صفري، وإلا HTMLAudio فورًا
 * -------------------------------------------------------- */

function playBuffer(name, { volume = 1, rate = 1 } = {}) {
  if (!state.ctx || !state.buffers[name]) return false;
  // 🔑 السياق معلّق (لم تُفتح القفل بعد)؟ لا ننطلق صامتًا — نرجع false
  //    ليلعب البديل HTMLAudio فورًا داخل نفس اللمسة (مسموح له)
  if (state.ctx.state !== 'running') return false;
  try {
    const src = state.ctx.createBufferSource();
    src.buffer = state.buffers[name];
    src.playbackRate.value = rate;
    const g = state.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(state.ctx.destination);
    src.start(0);
    return true;
  } catch { return false; }
}

function playFallback(name) {
  const a = _getFallbackEl(name);
  if (!a) return false;
  try { a.currentTime = 0; a.play().catch(() => {}); return true; }
  catch { return false; }
}

function play(name, opts) {
  if (!state.inited || !soundEnabled) return;   // 🔇 موقوف من الإعدادات
  // 🔓 v26: افتح قفل الصوت في لحظة اللمسة — قبل أي بوابة سابقة.
  //    كان فحص بوابة النقرات يعود مبكرًا قبل unlockAudio فلا يُفتح
  //    AudioContext أبدًا إن كان كل لمس اللاعب على أزرار فقط.
  unlockAudio();
  if (name === 'tap' && !tapEnabled) return;    // 👆 النقرات بعد «متابعة» التسجيل فقط
  if (playBuffer(name, opts)) return;           // المسار الرقمي جاهز؟ شغّله
  playFallback(name);                           // وإلا البديل الفوري — بلا صمت
}

/* ----------------------------------------------------------
 * 🎛️ الواجهة العامة — تُستدعى من محرك اللعبة
 * -------------------------------------------------------- */

/** 👆 صوت النقر (sound1) */
export function sfxTap()      { play('tap'); }

/** ✓✗ صوت العلامات (sound2) — عند ظهور النتائج وبين الجولات */
export function sfxMark()     { play('mark'); }

/** ✅ صوت الإجابة الصحيحة (sound3) */
export function sfxCorrect()  { play('correct'); }

/** ❌ صوت الإجابة الخاطئة (sound4) */
export function sfxWrong()    { play('wrong'); }

/** 🎵 موسيقى الخلفية (sound5) — تلاشٍ دخول تدريجي ثم تكرار دائم */
export function startBackground() {
  if (state.bgStarted || !state.inited || !soundEnabled) return;   // 🔇 موقوف؟ لا تبدأ
  state.bgStarted = true;
  _maybeStartBg();
}

/**
 * 🏠 v24 (طلب المستخدم): كل الأصوات تبدأ بالعمل فور دخول اللاعب
 *    الصفحة الرئيسية أول مرة — موسيقى الخلفية تنطلق من هنا.
 */
export function startHomeAudio() {
  startBackground();
}

/* ----------------------------------------------------------
 * 🎵 الخلفية — مسار واحد فقط لا يتكرر (web أو html — ليس الاثنين)
 * -------------------------------------------------------- */

function _clearBgRamp() {
  if (state._bgRampIv) { clearInterval(state._bgRampIv); state._bgRampIv = null; }
}

function _maybeStartBg() {
  if (!state.bgStarted || state.bgPlaying || !soundEnabled) return;

  // أولوية WebAudio إن كان جاهزًا فعلًا (السياق يعمل والمخزن محمّل)
  if (state.ctx && state.buffers.bg && state.ctx.state === 'running') {
    try {
      const src = state.ctx.createBufferSource();
      src.buffer = state.buffers.bg;
      src.loop = true;
      const g = state.ctx.createGain();
      g.gain.setValueAtTime(0.0001, state.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(VOLUMES.bg, state.ctx.currentTime + BG_FADE_MS / 1000);
      src.connect(g).connect(state.ctx.destination);
      src.start(0);
      state.bgGain = g;
      state.bgPlaying = 'web';
      return;
    } catch { /* رجوع إلى HTMLAudio */ }
  }

  // مسار HTMLAudio — يعمل مباشرة داخل أي لمسة (سياسة التشغيل)
  const a = _getFallbackEl('bg');
  if (!a) return;
  a.loop = true;
  a.volume = 0;
  a.play().then(() => {
    state.bgPlaying = 'html';
    const step = VOLUMES.bg / (BG_FADE_MS / 120);
    _clearBgRamp();
    state._bgRampIv = setInterval(() => {
      try {
        a.volume = Math.min(VOLUMES.bg, a.volume + step);
        if (a.volume >= VOLUMES.bg) _clearBgRamp();
      } catch { _clearBgRamp(); }
    }, 120);
  }).catch(() => { /* لم تُفتح القفل بعد — تُعاد المحاولة عند اللمسة التالية */ });
}

/* ----------------------------------------------------------
 * 🔇/🔊 كتم واستئناف موسيقى الخلفية (يُدار من الإعدادات)
 * -------------------------------------------------------- */

function _silenceBg() {
  _clearBgRamp();
  try {
    if (state.bgPlaying === 'web' && state.bgGain && state.ctx) {
      const g = state.bgGain.gain;
      g.cancelScheduledValues(state.ctx.currentTime);
      g.setValueAtTime(g.value || 0.0001, state.ctx.currentTime);
      g.linearRampToValueAtTime(0.0001, state.ctx.currentTime + 0.4);
      // المسار الرقمي يبقى حيًا بمكتوم — الاستئناف يرفع مستواه فقط
      return;
    }
    if (state.fallbacks.bg) state.fallbacks.bg.pause();
    state.bgPlaying = false;
  } catch {}
}

function _resumeBg() {
  if (!state.bgStarted) { startBackground(); return; }   // لم تبدأ بعد — ابدأها الآن
  _clearBgRamp();
  try {
    if (state.bgPlaying === 'web' && state.bgGain && state.ctx) {
      const g = state.bgGain.gain;
      g.cancelScheduledValues(state.ctx.currentTime);
      g.setValueAtTime(Math.max(0.0001, g.value || 0.0001), state.ctx.currentTime);
      g.linearRampToValueAtTime(VOLUMES.bg, state.ctx.currentTime + BG_FADE_MS / 1000);
      return;
    }
    // كانت متوقفة (html أو لم تبدأ فعليًا) — انطلق من جديد
    state.bgPlaying = false;
    _maybeStartBg();
  } catch {}
}
