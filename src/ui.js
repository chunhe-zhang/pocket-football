import * as THREE from 'three';
import { TEAMS } from './config.js';

const $ = (s) => document.querySelector(s);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

const HELP = {
  solo: `<div class="grid">
    <b>移动</b><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 或方向键</span>
    <b>射门 / 传球</b><span>按住 <kbd>Space</kbd> 或 <kbd>J</kbd> 蓄力，松开出脚</span>
    <b>挑射</b><span>按住 <kbd>K</kbd> 蓄力</span>
    <b>冲刺</b><span><kbd>Shift</kbd>（消耗体力）</span>
    <b>弧线球</b><span>出脚瞬间按住左右方向</span>
    <b>其它</b><span><kbd>C</kbd> 视角 · <kbd>M</kbd> 静音 · <kbd>P</kbd> 暂停</span></div>`,
  duo: `<div class="grid">
    <b style="color:var(--blue)">P1 蓝</b><span><kbd>WASD</kbd> 移动 · <kbd>F</kbd> 射门 · <kbd>G</kbd> 挑射 · <kbd>左Shift</kbd> 冲刺</span>
    <b style="color:var(--orange)">P2 橙</b><span>方向键 移动 · <kbd>Enter</kbd> 射门 · <kbd>/</kbd> 挑射 · <kbd>右Shift</kbd> 冲刺</span>
    <b>技巧</b><span>按住越久越大力；出脚瞬间按住侧向可踢出弧线</span></div>`,
};

export class UI {
  constructor({ sfx, input, camera }) {
    this.sfx = sfx; this.input = input; this.camera = camera;
    this.settings = { mode: 'solo', level: 'normal', duration: 180 };
    this.muted = false;
    this.tags = [];
    this._v = new THREE.Vector3();
  }

  bind(game) {
    this.game = game;
    for (const seg of document.querySelectorAll('.seg')) {
      seg.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        const v = b.dataset.v; this.settings[seg.dataset.key] = seg.dataset.key === 'duration' ? +v : v;
        this._refreshMenu();
      });
    }
    $('#btn-start').addEventListener('click', () => this.startMatch());
    $('#btn-again').addEventListener('click', () => this.startMatch());
    $('#btn-menu').addEventListener('click', () => this.showMenu());
    $('#btn-quit').addEventListener('click', () => { $('#pause').classList.remove('show'); this.showMenu(); });
    $('#btn-resume').addEventListener('click', () => this.togglePause());
    $('#btn-pause').addEventListener('click', () => this.togglePause());
    $('#btn-cam').addEventListener('click', () => game.cycleCamera());
    $('#btn-mute').addEventListener('click', () => this.toggleMute());
    addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && $('#menu').classList.contains('show')) this.startMatch();
    });
    if (isTouch) this.input.attachTouch($('#touch'));
    this._refreshMenu();

    // name tags / charge meters
    const tagsRoot = $('#tags');
    this.tags = game.athletes.map((a, i) => {
      const el = document.createElement('div'); el.className = 'tag-el';
      el.innerHTML = `<span class="lbl" style="background:${TEAMS[i].css}"></span><div class="meter"><i></i><span class="pct"></span></div><div class="stam"><i></i></div>`;
      tagsRoot.appendChild(el);
      return { el, lbl: el.querySelector('.lbl'), meter: el.querySelector('.meter'), fill: el.querySelector('.meter i'), pct: el.querySelector('.meter .pct'), stam: el.querySelector('.stam'), stamFill: el.querySelector('.stam i') };
    });
  }

  _refreshMenu() {
    const duo = this.settings.mode === 'duo';
    $('#row-level').style.display = duo ? 'none' : '';
    $('#controls-help').innerHTML = isTouch && !duo ? '<div class="grid"><b>左摇杆</b><span>移动</span><b>射门</b><span>按住蓄力，松开出脚</span><b>挑射 / 冲刺</b><span>右侧按钮</span></div>' : HELP[duo ? 'duo' : 'solo'];
  }

  loading(p, text) {
    $('#load-bar').style.width = `${Math.round(p * 100)}%`;
    if (text) $('#load-text').textContent = text;
  }

  ready() {
    $('#loading').classList.remove('show');
    this.showMenu();
  }

  showMenu() {
    $('#end').classList.remove('show');
    $('#hud').classList.add('hidden');
    $('#touch').classList.add('hidden');
    $('#menu').classList.add('show');
    this.game.state = 'menu';
    this.game.controllers = [];
    for (const a of this.game.athletes) { a.frozen = false; a.char.stopEmotes(); }
    this.game.athletes[0].place(-2.6, 0, Math.PI / 2);
    this.game.athletes[1].place(2.6, 0, -Math.PI / 2);
    this.game.ball.reset(0, 0);
  }

  startMatch() {
    this.sfx.init();
    $('#menu').classList.remove('show');
    $('#end').classList.remove('show');
    $('#hud').classList.remove('hidden');
    if (isTouch && this.settings.mode === 'solo') $('#touch').classList.remove('hidden');
    $('#keyhint').innerHTML = this.settings.mode === 'duo'
      ? 'P1：WASD + F/G　·　P2：方向键 + Enter / /'
      : '按住 <b>Space</b> 蓄力射门　·　<b>K</b> 挑射　·　<b>Shift</b> 冲刺';
    setTimeout(() => { $('#keyhint').style.opacity = '0'; $('#keyhint').style.transition = 'opacity 1s'; }, 9000);
    $('#keyhint').style.opacity = '1';
    this.game.start({ ...this.settings });
  }

  togglePause() {
    const g = this.game;
    if (g.state === 'paused') { g.state = this._prevState; $('#pause').classList.remove('show'); }
    else if (['play', 'kickoff', 'goal'].includes(g.state)) { this._prevState = g.state; g.state = 'paused'; $('#pause').classList.add('show'); }
  }

  toggleMute() {
    this.muted = !this.muted; this.sfx.setMuted(this.muted);
    $('#btn-mute').classList.toggle('off', this.muted);
  }

  toast(msg) {
    const k = $('#keyhint'); k.textContent = msg; k.style.transition = 'none'; k.style.opacity = '1';
    clearTimeout(this._toastT); this._toastT = setTimeout(() => { k.style.transition = 'opacity 0.8s'; k.style.opacity = '0'; }, 1300);
  }

  onScore(s) { $('#s0').textContent = s[0]; $('#s1').textContent = s[1]; }

  banner(big, small) {
    const b = $('#banner');
    if (!big) { b.classList.remove('show'); return; }
    $('#banner-big').textContent = big; $('#banner-small').textContent = small;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(this._bannerT); this._bannerT = setTimeout(() => b.classList.remove('show'), 2600);
  }

  updateHud(g) {
    if (g.state === 'menu') { for (const t of this.tags) t.el.style.display = 'none'; return; }
    const c = Math.ceil(g.clock), m = Math.floor(c / 60), s = c % 60;
    const clk = $('#clock'); clk.textContent = `${m}:${String(s).padStart(2, '0')}`;
    clk.classList.toggle('low', g.clock < 30);
    const w = innerWidth, h = innerHeight;
    g.athletes.forEach((a, i) => {
      const t = this.tags[i];
      this._v.set(a.pos.x, 2.12, a.pos.z).project(this.camera);
      if (this._v.z > 1) { t.el.style.display = 'none'; return; }
      t.el.style.display = '';
      t.el.style.transform = `translate(${(this._v.x * 0.5 + 0.5) * w}px, ${(-this._v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
      t.lbl.textContent = a.label;
      t.meter.style.visibility = a.charging ? 'visible' : 'hidden';
      t.fill.style.width = `${Math.round(a.charge * 100)}%`;
      t.pct.textContent = a.charging ? `${Math.round(a.charge * 100)}%` : '';
      t.meter.classList.toggle('full', a.charging && a.charge >= 1);
      const human = g.controllers[i]?.type === 'human';
      t.stam.style.visibility = human && a.stamina < 0.98 ? 'visible' : 'hidden';
      t.stamFill.style.width = `${Math.round(a.stamina * 100)}%`;
      t.stamFill.style.background = a.exhausted ? '#ff6b5b' : '#9fe3ff';
    });
  }

  showEnd(g) {
    const [a, b] = g.athletes, [s0, s1] = g.score;
    $('#end-title').textContent = s0 === s1 ? '平局' : `${s0 > s1 ? a.label : b.label} 获胜`;
    $('#end-s0').textContent = s0; $('#end-s1').textContent = s1;
    const tot = g.possession[0] + g.possession[1] || 1;
    const p0 = Math.round((g.possession[0] / tot) * 100);
    const rows = [
      [`${p0}%`, '控球率', `${100 - p0}%`],
      [a.stats.shots, '射门', b.stats.shots],
      [a.stats.onTarget, '射正', b.stats.onTarget],
      [a.stats.touches, '触球', b.stats.touches],
    ];
    $('#end-stats').innerHTML = rows.map((r) => `<tr><td style="color:var(--blue)">${r[0]}</td><td>${r[1]}</td><td style="color:var(--orange)">${r[2]}</td></tr>`).join('');
    $('#end').classList.add('show');
    $('#touch').classList.add('hidden');
  }
}
