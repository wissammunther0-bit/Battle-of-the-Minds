// ui/icons.js — v17 (نظام الأيقونات المحلية الكامل — دقة بلا 404)
// ============================================================
// 🎨 مكتبة الأيقونات — نظام مزدوج (طلب المستخدم v13):
//
//   1) أيقونات مدمجة (SVG مرسومة داخل الملف) — تعمل دائمًا
//      حتى لو لم تضع أي ملفات، ولا تعتمد على أي CDN أو إنترنت.
//
//   2) مجلد icons/ المحلي — أنت تحمّل أيقوناتك من الإنترنت وتضعها
//      في مجلد icons/ بنفس الأسماء المذكورة في icons/README-ICONS.md
//      واللعبة تكتشفها تلقائيًا عند كل تشغيل وتستخدمها بدل المدمجة:
//        icons/gems.svg   أو  icons/gems.png
//        icons/start.svg  أو  icons/start.png
//        ... إلخ (الاسم = مفتاح الأيقونة بالضبط)
//
//   القواعد:
//   • يُفحص الملف بصيغة .svg أولًا ثم .png — الأولى الموجودة تفوز.
//   • ملف SVG يُحقن داخل الصفحة فيتلوّن مع الثيم إن كان يستخدم
//     currentColor، وملف PNG يظهر كما هو (صورة).
//   • لا حاجة لتعديل أي كود — ضع الملف وحدّث الصفحة فقط.
//
//  الاستخدام في الكود:
//    import { icon, hydrateIcons, initIcons } from './icons.js';
//    el.innerHTML = icon('start');          // svg جاهز
//    <span data-ico="gems"></span>          // في HTML ثم hydrateIcons()
// ============================================================

const SVG = (paths, cls = '') => `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round"
     class="ico ${cls}" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  /* ---------- أدوات الجولة ---------- */
  /** ⏭️ تخطي السؤال — سهم مزدوج (التصميم المعتمد v20) */
  skip2: SVG('<polyline points="5 5 12 12 5 19"/><polyline points="12 5 19 12 12 19"/>'),
  /** ⏭️ تخطي السؤال (توافق قديم) */
  skip: SVG('<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>'),
  /** 🔄 تبديل السؤال */
  swap: SVG('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
  /** 🔍 البحث */
  search: SVG('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
  /** ❄️ تجميد الخصم */
  freeze: SVG('<line x1="12" x2="12" y1="2" y2="22"/><line x1="2" x2="22" y1="12" y2="12"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>'),
  /** ✂️ حذف خيارين (50:50) — أداة الجولة (v29: كانت نصًا "50:50" بلا أيقونة
   *  فلم تكن قابلة للتغيير من قسم الأيقونات في الإدارة) */
  fifty: SVG('<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>'),
  /** ✖️ إغلاق / انسحاب */
  close: SVG('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),

  /* ---------- الإعدادات ---------- */
  /** ⚙️ الإعدادات */
  settings: SVG('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
  /** 🔊 صوت مفعّل */
  soundOn: SVG('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>'),
  /** 🔇 صوت موقوف */
  soundOff: SVG('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>'),
  /** 🌐 اللغة */
  language: SVG('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'),

  /* ---------- العملات والإحصائيات ---------- */
  /** 💎 الجواهر */
  gems: SVG('<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>'),
  /** 🎖️ علامات الانتصار (وسام) */
  tokens: SVG('<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>'),
  /** 🧠 جوائز الذكاء (دماغ) */
  intel: SVG('<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M19.938 10.5a4 4 0 0 1 .585.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M19.967 17.484A4 4 0 0 1 18 18"/>'),
  /** ⭐ نجمة (المستوى) */
  star: SVG('<polygon points="12 2 15.09 6.26 22 9.27 17 14.14 18.18 20.02 12 17.77 5.82 20.02 7 14.14 2 9.27 8.91 6.26 12 2"/>'),

  /* ---------- التنقل (الشريط السفلي) ---------- */
  /** 👥 الأصدقاء */
  friends: SVG('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  /** 🕘 السجل */
  history: SVG('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),
  /** ⚔️ ابدأ / معركة (سيوف متقاطعة) */
  start: SVG('<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="21"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 10"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>'),
  /** 🏆 المتصدرون (كأس) */
  leaderboard: SVG('<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>'),
  /** 🛍️ المتجر (حقيبة تسوق) */
  store: SVG('<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>'),
  /** 👤 الملف الشخصي (شخص واحد) */
  profile: SVG('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),

  /* ---------- عامة ---------- */
  /** 🎧 الدعم الفني */
  support: SVG('<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>'),
  /** 🚪 تسجيل الخروج */
  logout: SVG('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>'),
  /** ‹ سهم رجوع (يتقلب تلقائيًا في RTL عبر CSS) */
  back: SVG('<path d="m15 18-6-6 6-6"/>'),
  /** ▶ تشغيل (زر ابدأ الجولة) */
  play: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" class="ico" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
  /** 🎮 الغرف */
  rooms: SVG('<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>'),
  /** 🚫 محظور */
  banned: SVG('<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>'),
  /** ⚠️ تحذير */
  warn: SVG('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  /** ❓ مساعدة */
  help: SVG('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
  /** 🎁 هدية (جوائز) */
  gift: SVG('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>'),
  /** 🖼️ الأفاتار — صور شخصية */
  avatar: SVG('<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
  /** 🧰 أدوات مساعدة (مفتاح ربط) */
  tools: SVG('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
  /** ✨ تألق (شاشة الترحيب) */
  sparkles: SVG('<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>'),

  /* ---------- v14 — المكافآت والحقيبة والقرص ---------- */
  /** 🎁 صندوق المكافآت (box) */
  box: SVG('<rect width="20" height="5" x="2" y="10" rx="1"/><path d="M4 15v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M12 15v7"/><path d="M12 10 9.5 4.5a1.8 1.8 0 0 0-3.4.9C6.1 7.3 8 10 12 10c4 0 5.9-2.7 5.9-4.6a1.8 1.8 0 0 0-3.4-.9Z"/>'),
  /** 🎒 حقيبة اللاعب (bag) */
  bag: SVG('<path d="M6 7V6a6 6 0 0 1 12 0v1"/><rect width="18" height="14" x="3" y="7" rx="3"/><path d="M3 12h18"/><path d="M9 16h6"/>'),
  /** 🎡 قرص الحظ (wheel) */
  wheel: SVG('<circle cx="12" cy="12" r="10"/><path d="M12 2v20"/><path d="m4.93 4.93 14.14 14.14"/><path d="M2 12h20"/><path d="m4.93 19.07 14.14-14.14"/><circle cx="12" cy="12" r="2.5"/>'),
  /** 🎬 علامة الفيديو — شاهد الإعلان (video) */
  video: SVG('<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/>'),

  /* ---------- v16 — الرئيسية الجديدة (وفق نموذج المستخدم) ---------- */
  /** 🏠 الرئيسية */
  home: SVG('<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 22V12h6v10"/>'),
  /** 🕐 ساعة (السجل) */
  clock: SVG('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  /** 🛒 سلة التسوق (متجر الجوائز) */
  cart: SVG('<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>'),
  /** ➕ إضافة (إنشاء غرفة) */
  plus: SVG('<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>'),
  /** 💡 مصباح (جوائز الذكاء) */
  bulb: SVG('<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>'),
  /** 🎚️ أشرطة الإعدادات */
  tune: SVG('<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>'),
  /** ⚔️ سيوف متقاطعة صغيرة (زر المعركة) */
  swords: SVG('<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="21"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 10"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>'),

  /* ---------- v18 — القرص والاسترداد ---------- */
  /** ✏️ قلم (أداة تغيير الاسم) */
  pen: SVG('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'),
  /** ⭕ خانة فارغة بالقرص (دائرة متقطعة بشرطة) */
  none: SVG('<circle cx="12" cy="12" r="9" stroke-dasharray="3.2 3.2" opacity=".85"/><line x1="8.5" x2="15.5" y1="12" y2="12"/>'),

  /* ---------- v24 — طلبات المستخدم ---------- */
  /** ✈️ سهم مُرسل — طلب صداقة أُرسل (شاشة النهاية) */
  send: SVG('<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/>'),
  /** 🧠⏳ مؤشر القياس اللحظي — دائرة تحميل احترافية (المتصدرون) */
  loader: SVG('<path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v6h-6"/>'),
  /** ⬇️ تحميل — سهم لأسفل بخط (أيقونة احترافية) */
  download: SVG('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
  /** 🏠 الرئيسية — بجانب زر «العودة» في شاشة النهاية */
  homeNav: SVG('<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 22V12h6v10"/>'),
  /** 📹 كاميرا فيديو — شعار الإعلان الاحترافي */
  camera: SVG('<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="3"/><circle cx="9" cy="12" r="2"/>')
};

/* ============================================================
 * 📂 نظام المجلد المحلي icons/ — دقة كاملة بلا أي خطأ 404 (v17)
 *
 *   1) يُقرأ icons/manifest.json أولًا (قائمة الملفات الموجودة فعلًا،
 *      تُولَّد من المجلد) — فلا تُطلب من الشبكة إلا ملفات موجودة:
 *      لا يظهر أي خطأ 404 في سجل السيرفر إطلاقًا.
 *   2) بلا manifest (نسخة قديمة/مجلد مخصص): فحص تسلسلي svg ثم png
 *      كما في v13 — أول صيغة موجودة تفوز.
 *   3) 🎯 دقة الاستبدال بـ PNG: إن وُجد الاسم بالصيغتين (svg و png)
 *      يُقارَن تاريخ آخر تعديل للملفين (Last-Modified) وتظهر الأيقونة
 *      الأحدث — أي أن أيقونتك المستبدلة بـ PNG تظهر فورًا بلا حذف
 *      القديمة ولا تعديل أي كود، ولا خطأ في الأيقونة السابقة.
 * ============================================================ */
const LOCAL_DIR = 'icons';
const LOCAL_EXTS = ['svg', 'png'];   // الترتيب عند غياب manifest فقط

const _local = {};     // name → HTML جاهز (svg أو img) من المجلد المحلي
let _probed = false;   // هل اكتمل فحص المجلد في هذه الجلسة؟

/** تنظيف نص SVG المُحمّل: إزالة xml/DOCTYPE و width/height الثابتة
 *  حتى تبقى مقاسات الأيقونة تحت سيطرة CSS اللعبة */
function _svgFromText(txt) {
  const m = String(txt).match(/<svg[\s\S]*<\/svg>/i);
  if (!m) return null;
  return m[0]
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/\sclass="[^"]*"/i, '')
    .replace(/\s(width|height)="[^"]*"/gi, '')
    .replace(/<svg/i, '<svg class="ico" aria-hidden="true"');
}

/** جلب ملف أيقونة واحد — يرجع { ext, html, mtime } أو null إن لم يوجد */
async function _fetchOne(name, ext) {
  try {
    const res = await fetch(`${LOCAL_DIR}/${name}.${ext}`, { cache: 'no-store' });
    if (!res.ok) return null;
    if (ext === 'svg') {
      const svg = _svgFromText(await res.text());
      return svg ? { ext, html: svg, mtime: res.headers.get('last-modified') } : null;
    }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.startsWith('image/') || ct === '') {
      const html = `<img class="ico" src="${LOCAL_DIR}/${name}.${ext}" alt="" draggable="false">`;
      return { ext, html, mtime: res.headers.get('last-modified') };
    }
  } catch {
    // لا يوجد سيرفر محلي (فتح الملف مباشرة file://) — اعتمد المدمجة
  }
  return null;
}

/** اختيار أيقونة الاسم من بين الصيغ المتاحة:
 *  صيغة واحدة → تُستخدم فورًا | صيغتان → الأحدث تعديلًا تفوز (وإلا PNG) */
async function _pickIcon(name, exts, parallel) {
  if (!exts.length) return;
  if (exts.length === 1) {
    const r = await _fetchOne(name, exts[0]);
    if (r) _local[name] = r.html;
    return;
  }
  // الصيغتان موجودتان فعلًا (manifest يؤكد وجودهما) — قارن الأحدث
  if (parallel) {
    const found = (await Promise.all(exts.map(e => _fetchOne(name, e)))).filter(Boolean);
    if (found.length === 1) { _local[name] = found[0].html; return; }
    if (found.length === 2) {
      const [a, b] = found;
      const ta = Date.parse(a.mtime || '') || 0;
      const tb = Date.parse(b.mtime || '') || 0;
      const win = (ta && tb && ta !== tb)
        ? (ta > tb ? a : b)                    // ⏱️ الأحدث تعديلًا
        : found.find(f => f.ext === 'png');    // بلا تاريخ: الاستبدال بـ PNG مقصود
      _local[name] = (win || a).html;
    }
    return;
  }
  // فحص تسلسلي (بلا manifest): svg ثم png — أول موجودة تفوز
  for (const ext of LOCAL_EXTS) {
    const r = await _fetchOne(name, ext);
    if (r) { _local[name] = r.html; return; }
  }
}

/** قراءة manifest.json — { "gems": ["svg"], "home": ["svg","png"], … } */
async function _loadManifest() {
  try {
    const res = await fetch(`${LOCAL_DIR}/manifest.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : null;
  } catch { return null; }
}

/** 🚀 فحص مجلد icons/ ثم ترقية كل أيقونات الصفحة — يُستدعى مرة عند الإقلاع */
export async function initIcons() {
  if (_probed) { hydrateIcons(document); return; }
  _probed = true;
  const manifest = await _loadManifest();
  if (manifest) {
    // 🎯 وضع الـ manifest: اطلب الملفات الموجودة فقط — صفر 404
    await Promise.all(Object.keys(ICONS).map(async (name) => {
      const exts = Array.isArray(manifest[name])
        ? manifest[name].filter(e => LOCAL_EXTS.includes(e))
        : [];
      await _pickIcon(name, exts, true);
    }));
  } else {
    // وضع التوافق: فحص تسلسلي لكل الأسماء (svg ثم png)
    await Promise.all(Object.keys(ICONS).map(name => _pickIcon(name, [...LOCAL_EXTS], false)));
  }
  // اكتشفنا أيقوناتك المحلية؟ طبّقها على كل الصفحة فورًا
  hydrateIcons(document);
}

/** يرجع أيقونة جاهزة بالإدراج — name من ICONS (أو ملفك المحلي إن وُجد) */
export function icon(name, cls = '') {
  // ☁️ v27 أولوية التجاوز السحابي من لوحة الإدارة (مجموعة iconOverrides)
  const ovr = _overrides[name];
  const html = (ovr
    ? `<img class="ico" src="${ovr}" alt="" draggable="false">`
    : (_local[name] || ICONS[name] || ICONS.help));
  return cls ? html.replace('class="ico"', `class="ico ${cls}"`) : html;
}

/** يحقن كل العناصر ذات data-ico="name" بأيقونتها — يُستدعى بعد كل رسم */
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-ico]').forEach(el => {
    el.innerHTML = icon(el.getAttribute('data-ico'));
  });
}

/* ============================================================
 * ☁️ v27 — تجاوزات الأيقونات من لوحة الإدارة (Firestore)
 *
 *   مجموعة iconOverrides/{key} = { key, dataUrl, px, updatedAt }
 *   الأولوية: التجاوز السحابي ☁️ ← المجلد المحلي 📂 ← المدمجة 🎨
 *
 *   • تُقرأ عند إقلاع اللعبة (loadIconOverrides)
 *   • وتتحدّث لحظيًا أثناء اللعب (watchIconOverrides) — أي تغيير
 *     من لوحة الإدارة يصل لكل الأجهزة المفتوحة فورًا
 *   • تشمل الشخصية الافتراضية (defaultAvatar) التي يأخذها
 *     كل لاعب جديد مجانًا عند الانضمام
 * ============================================================ */
let _overrides = {};        // key → dataUrl
let _ovrWatched = false;    // هل المستمع اللحظي يعمل؟

/** رابط (dataURL) أيقونة مُتجاوزة — null إن لم تُغيَّر */
export function getOverrideDataUrl(name) { return _overrides[name] || null; }

/** 🧩 الشخصية الافتراضية (يأخذها كل لاعب جديد مجانًا) — HTML جاهز أو null
 *  🛠️ v29: بلا class="ico" — كانت class="ico" تعطيها مقاس أيقونة صغير
 *  ثابت (70×70 داخل السداسي) فتظهر صغيرة لا تملأ الإطار؛ الآن تُرسم
 *  كصورة عادية تملأ الإطار تمامًا كشخصيات المتجر */
export function getDefaultAvatarImg() {
  const url = _overrides.defaultAvatar;
  return url ? `<img src="${url}" alt="" draggable="false">` : null;
}

/** تطبيق التجاوزات فورًا على الصفحة + إبلاغ كل الشاشات المفتوحة */
export function applyIconOverrides() {
  hydrateIcons(document);
  try { window.dispatchEvent(new CustomEvent('iconschange')); } catch {}
}

/** ☁️ قراءة التجاوزات من Firestore — تُستدعى مرة عند إقلاع اللعبة */
export async function loadIconOverrides() {
  try {
    const FS = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js');
    const { db } = await import('../firebase-config.js');
    const snap = await FS.getDocs(FS.collection(db, 'iconOverrides'));
    let found = 0;
    snap.forEach(d => {
      const v = d.data();
      if (v?.dataUrl) { _overrides[d.id] = v.dataUrl; found++; }
    });
    if (found) applyIconOverrides();
    return true;
  } catch (e) {
    console.warn('[icons] overrides load:', e?.message || e);
    return false;
  }
}

/** 🔴 مستمع لحظي لأيقونات لوحة الإدارة — يطبّق أي تغيير على كل الأجهزة */
export function watchIconOverrides() {
  if (_ovrWatched) return;
  _ovrWatched = true;
  (async () => {
    try {
      const FS = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js');
      const { db } = await import('../firebase-config.js');
      FS.onSnapshot(FS.collection(db, 'iconOverrides'), (snap) => {
        let changed = false;
        snap.docChanges().forEach(ch => {
          if (ch.type === 'removed') {
            if (_overrides[ch.doc.id]) { delete _overrides[ch.doc.id]; changed = true; }
          } else {
            const v = ch.doc.data();
            if (v?.dataUrl && _overrides[ch.doc.id] !== v.dataUrl) {
              _overrides[ch.doc.id] = v.dataUrl; changed = true;
            }
          }
        });
        if (changed) applyIconOverrides();
      }, (e) => { console.warn('[icons] watch:', e?.message || e); });
    } catch (e) {
      console.warn('[icons] watch init:', e?.message || e);
    }
  })();
}
