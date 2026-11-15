// ui/modal.js — v12
// ============================================================
// 🪟 النافذة المنبثقة العامة — طلب المستخدم (v12):
//  • زر إغلاق ✕ أيقوني أعلى النافذة
//  • الضغط في أي مكان خارج النافذة يغلقها
//  • بلا تحديد نصوص داخل النافذة (انظر v12.css)
// ============================================================
export function openModal(title, bodyHTML, actionsHTML) {
  const m = document.getElementById('modal');
  const box = m.querySelector('.modal-box');
  // 🧹 إعادة ضبط صناديق النافذة — لا تتراكم أصناف النوافذ السابقة
  if (box) box.className = 'modal-box';
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  document.getElementById('modal-actions').innerHTML = actionsHTML || '';
  document.getElementById('modal-actions').classList.toggle('hidden', !actionsHTML);

  // ✕ زر الإغلاق الأيقوني أعلى النافذة
  //   (يظهر افتراضيًا في كل نافذة — والنوافذ ذات زر ✕ مخصص
  //    مثل محادثة الدعم تخفيه عبر hideModalX())
  const x = document.getElementById('modal-x');
  if (x) {
    x.classList.remove('hidden');
    x.onclick = closeModal;
  }

  // 🖱️ الضغط خارج صندوق النافذة (على الخلفية) يغلقها
  m.onclick = (e) => { if (e.target === m) closeModal(); };

  m.classList.remove('hidden');
}

export function closeModal() {
  const m = document.getElementById('modal');
  m.classList.add('hidden');
  m.classList.remove('prep-overlay');
  m.onclick = null;
}

/** إخفاء علامة ✕ العامة — للنوافذ التي لها زر إغلاق مخصص
 *  (يُعاد إظهارها تلقائيًا عند كل استدعاء openModal) */
export function hideModalX() {
  const x = document.getElementById('modal-x');
  if (x) x.classList.add('hidden');
}

export function setModalBody(html) {
  document.getElementById('modal-body').innerHTML = html;
}

export function setModalActions(html) {
  document.getElementById('modal-actions').innerHTML = html;
}
