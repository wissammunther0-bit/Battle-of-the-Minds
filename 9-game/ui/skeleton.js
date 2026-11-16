// ui/skeleton.js
// ============================================================
// 💀 هياكل تحميل (Skeletons) — بديل احترافي عن "جاري التحميل..."
//    صفوف متوهجة متحركة تعطي إحساس فوري بالاستجابة.
// ============================================================

/** صفوف skeleton عامة للقوائم */
export function skeletonRows(count = 5, cls = '') {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `<div class="sk-row ${cls}" style="animation-delay:${(i * 0.08).toFixed(2)}s">
      <div class="sk-avatar"></div>
      <div class="sk-lines">
        <div class="sk-line" style="width:${65 + ((i * 13) % 25)}%"></div>
        <div class="sk-line short" style="width:${35 + ((i * 7) % 20)}%"></div>
      </div>
      <div class="sk-chip"></div>
    </div>`;
  }
  return html;
}

/** skeleton صغير للنوافذ المنبثقة */
export function skeletonCard() {
  return `
    <div class="sk-card">
      <div class="sk-row" style="height:72px">
        <div class="sk-avatar big"></div>
        <div class="sk-lines">
          <div class="sk-line" style="width:55%"></div>
          <div class="sk-line short" style="width:30%"></div>
        </div>
      </div>
      <div class="sk-row" style="height:40px"><div class="sk-lines" style="flex:1"><div class="sk-line" style="width:80%"></div></div></div>
      <div class="sk-row" style="height:64px"><div class="sk-lines" style="flex:1"><div class="sk-line" style="width:90%"></div><div class="sk-line short" style="width:60%"></div></div></div>
    </div>`;
}
