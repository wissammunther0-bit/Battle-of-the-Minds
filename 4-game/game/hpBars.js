// game/hpBars.js
// 📊 أشرطة الصحة — النسخة v3: تعرض أيضًا الانتصارات 🏆 والدرع 🛡️
export class HPBars {
  constructor(engine) {
    this.engine = engine;
  }

  render() {
    const { engine } = this;
    engine.el.hpBars.innerHTML = engine.characters.map(c => {
      const low = c.hp < 30 ? 'low' : '';
      const isMine = engine.myChar?.id === c.id ? 'me' : '';
      const names = c.controllers.map(p => p.name).join(' + ');
      const wins = engine.wins?.[c.id] || 0;
      const shield = engine.shields?.[c.id] ? ' 🛡️' : '';
      return `
        <div class="hp-entry ${isMine}">
          <div class="hp-name">
            <span>${names}${shield}</span>
            <span>🏆 ${wins} · ${c.hp} HP</span>
          </div>
          <div class="hp-bar">
            <div class="hp-fill ${low}" style="width:${c.hp}%"></div>
          </div>
        </div>`;
    }).join('');
  }
}
