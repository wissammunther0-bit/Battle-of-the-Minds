import { getPlayer, updatePlayer } from './auth.js';

const FRIENDS_DB = 'bqa_friends_db';

function readDB() {
  try { return JSON.parse(localStorage.getItem(FRIENDS_DB) || '{}'); }
  catch { return {}; }
}
function writeDB(db) { localStorage.setItem(FRIENDS_DB, JSON.stringify(db)); }

export function registerInDirectory(player) {
  const db = readDB();
  const key = player.name.trim().toLowerCase();
  db[key] = db[key] || { name: player.name, country: player.country, pending: [] };
  db[key].name = player.name;
  db[key].country = player.country;
  writeDB(db);
}

export function searchPlayerByName(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const db = readDB();
  const me = getPlayer();
  const myName = me?.name?.trim().toLowerCase();

  return Object.entries(db)
    // ✅ استبعاد نفسي من النتائج
    .filter(([k]) => k !== myName)
    // ✅ استبعاد من هم أصدقاء بالفعل
    .filter(([k]) => !(me?.friends || []).some(f => f.name.toLowerCase() === k))
    // ✅ استبعاد من أرسلت لهم طلبًا
    .filter(([k]) => !(me?.pendingSent || []).some(f => f.name.toLowerCase() === k))
    .filter(([k]) => k.includes(q))
    .map(([k, v]) => ({ key: k, name: v.name, country: v.country }))
    .slice(0, 20);
}

export function sendFriendRequest(targetName) {
  const me = getPlayer();
  const db = readDB();
  const targetKey = targetName.trim().toLowerCase();

  // ✅ تحقق من أن الهدف ليس أنا
  if (targetKey === me.name.trim().toLowerCase()) {
    return { ok: false, msg: 'لا يمكنك إضافة نفسك' };
  }

  const target = db[targetKey];
  if (!target) return { ok: false, msg: 'اللاعب غير موجود' };
  if ((me.friends || []).some(f => f.name.toLowerCase() === targetKey)) {
    return { ok: false, msg: 'صديق بالفعل' };
  }
  if ((me.pendingSent || []).some(f => f.name.toLowerCase() === targetKey)) {
    return { ok: false, msg: 'الطلب مرسل بالفعل' };
  }

  target.pending = target.pending || [];
  if (!target.pending.some(p => p.from.toLowerCase() === me.name.toLowerCase())) {
    target.pending.push({ from: me.name, country: me.country, at: Date.now() });
    writeDB(db);
  }
  updatePlayer({
    pendingSent: [...(me.pendingSent || []), { name: target.name, country: target.country, at: Date.now() }]
  });
  return { ok: true, msg: 'تم إرسال الطلب' };
}

export function cancelFriendRequest(targetName) {
  const me = getPlayer();
  const db = readDB();
  const targetKey = targetName.trim().toLowerCase();
  const target = db[targetKey];
  if (target) {
    target.pending = (target.pending || []).filter(p => p.from.toLowerCase() !== me.name.toLowerCase());
    writeDB(db);
  }
  updatePlayer({
    pendingSent: (me.pendingSent || []).filter(f => f.name.toLowerCase() !== targetKey)
  });
  return { ok: true, msg: 'تم إلغاء الطلب' };
}

export function getReceivedRequests() {
  const me = getPlayer();
  const db = readDB();
  const myEntry = db[me.name.trim().toLowerCase()];
  return (myEntry?.pending || []);
}

export function acceptFriendRequest(fromName) {
  const me = getPlayer();
  const db = readDB();
  const meKey = me.name.trim().toLowerCase();
  const myEntry = db[meKey];
  if (!myEntry) return { ok: false, msg: 'خطأ' };
  const req = (myEntry.pending || []).find(p => p.from.toLowerCase() === fromName.toLowerCase());
  if (!req) return { ok: false, msg: 'لا يوجد طلب' };
  myEntry.pending = myEntry.pending.filter(p => p.from.toLowerCase() !== fromName.toLowerCase());
  writeDB(db);
  const newFriends = [...(me.friends || []), { name: req.from, country: req.country, at: Date.now() }];
  updatePlayer({
    friends: newFriends,
    pendingReceived: (me.pendingReceived || []).filter(f => f.name.toLowerCase() !== fromName.toLowerCase())
  });
  return { ok: true, msg: 'تم القبول' };
}

export function rejectFriendRequest(fromName) {
  const me = getPlayer();
  const db = readDB();
  const meKey = me.name.trim().toLowerCase();
  const myEntry = db[meKey];
  if (myEntry) {
    myEntry.pending = (myEntry.pending || []).filter(p => p.from.toLowerCase() !== fromName.toLowerCase());
    writeDB(db);
  }
  updatePlayer({
    pendingReceived: (me.pendingReceived || []).filter(f => f.name.toLowerCase() !== fromName.toLowerCase())
  });
  return { ok: true, msg: 'تم الرفض' };
}

export function removeFriend(friendName) {
  const me = getPlayer();
  const updated = (me.friends || []).filter(f => f.name.toLowerCase() !== friendName.toLowerCase());
  updatePlayer({ friends: updated });
  return { ok: true };
}

export function getFriends() {
  return getPlayer()?.friends || [];
}