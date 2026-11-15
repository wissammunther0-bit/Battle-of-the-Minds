// ui/history.js
// ============================================================
// 📜 سجل الجولات — آخر 7 أيام:
//   ⚡ عرض فوري من الكاش المحلي ثم تحديث خلفي — بلا شاشات انتظار.
//   من لعبت معه + النتيجة (فوز/خسارة) + النتيجة بالانتصارات + التاريخ
//   — والضغط على اسم اللاعب يفتح ملفه.
// ============================================================

import { getWeekHistory } from '../game/history.js';
import { getFlag } from './helpers.js';
import { openPlayerProfile } from './profileCard.js';
import { skeletonRows } from './skeleton.js';
import { t } from '../i18n.js';

const CACHE_KEY = 'ba_cache_history_v1';

const _esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function fmtDate(ms) {
  try {
    const d = new Date(ms);
    return d.toLocaleDateString('ar', { day: 'numeric', month: 'short' }) + ' · ' +
           d.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

/** تطبيع الصفوف — من كاش أو Firestore إلى شكل موحد */
function normalize(rows) {
  return (rows || []).map(r => ({
    roundId: r.roundId,
    result: r.result,
    myScore: r.myScore || 0,
    oppScore: r.oppScore || 0,
    reason: r.reason || null,
    atMs: r.atMs || (r.at?.toMillis?.() || r.at?.seconds * 1000 || 0),
    opponent: r.opponent || {}
  }));
}

function renderRows(box, rows) {
  if (!rows.length) {
    box.innerHTML = `<p class="friend-empty">${t('noRounds')}</p>`;
    return;
  }
  box.innerHTML = rows.map(r => {
    const win = r.result === 'win';
    const opp = r.opponent || {};
    const when = r.atMs ? fmtDate(r.atMs) : '';
    const reasonTag = r.reason === 'forfeit'
      ? ` <span class="hist-tag">${t('forfeit')}</span>`
      : (r.reason === 'knockout' ? ` <span class="hist-tag">${t('knockout')}</span>` : '');
    return `
      <div class="hist-row ${win ? 'win' : 'loss'}">
        <div class="hist-result">${win ? t('winTag') : t('lossTag')}${reasonTag}</div>
        <div class="hist-opp">
          <button class="hist-name" data-uid="${_esc(opp.uid || '')}"
                  data-name="${_esc(opp.name || '')}" data-country="${_esc(opp.country || '')}"
                  ${opp.uid ? '' : 'disabled'}>
            ${getFlag(opp.country)} ${_esc(opp.name || 'خصم')}
          </button>
          <span class="hist-score">${r.myScore} — ${r.oppScore}</span>
        </div>
        <div class="hist-date">${when}</div>
      </div>`;
  }).join('');

  box.querySelectorAll('.hist-name[data-uid]').forEach(btn => {
    btn.onclick = () => {
      if (!btn.dataset.uid) return;
      openPlayerProfile(btn.dataset.uid, {
        name: btn.dataset.name,
        country: btn.dataset.country
      });
    };
  });
}

export async function initHistory() {
  const box = document.getElementById('history-list');
  if (!box) return;

  // ⚡ 1) عرض فوري من الكاش المحلي (إن وجد) — إحساس لحظي
  let cached = [];
  try { cached = normalize(JSON.parse(localStorage.getItem(CACHE_KEY) || '[]')); } catch {}
  if (cached.length) renderRows(box, cached);
  else box.innerHTML = skeletonRows(6);

  // 2) جلب البيانات الحديثة وتحديث الشاشة + الكاش
  const rows = normalize(await getWeekHistory(7));
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(rows)); } catch {}
  if (!box.isConnected) return;
  renderRows(box, rows);
}
