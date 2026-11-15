import { getPlayer, updatePlayer } from './auth.js';
import { getFlag } from './ui/helpers.js';

export function saveProfile(name, country) {
  if (!name || !name.trim()) return { ok: false, msg: 'أدخل اسماً صحيحاً' };
  const updated = updatePlayer({ name: name.trim(), country });
  return { ok: true, player: updated };
}

export function getProfileStats() {
  const p = getPlayer();
  return { wins: p.wins, losses: p.losses, tokens: p.tokens, gems: p.gems };
}

// 🌍 توحيد الأعلام — يفوَّض إلى ui/helpers.js (توليد تلقائي لأي دولة،
// بلا علم أبيض 🏳️ — طلب المستخدم v11)
export { getFlag };
