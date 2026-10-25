import * as THREE from 'three';
import { TEAMS } from './config.js';
import { NetClient } from './net.js';

const $ = (s) => document.querySelector(s);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

const HELP = {
  1: `<div class="grid">
    <b>移动</b><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 或方向键</span>
    <b>射门</b><span>按住 <kbd>Space</kbd> 或 <kbd>J</kbd> 蓄力，松开出脚</span>
    <b>挑射</b><span>按住 <kbd>K</kbd> 蓄力</span>
    <b>冲刺</b><span><kbd>Shift</kbd>（消耗体力，看头顶蓝条）</span>
    <b>弧线球</b><span>出脚瞬间按住左右方向</span>
    <b>其它</b><span><kbd>C</kbd> 视角 · <kbd>M</kbd> 静音 · <kbd>P</kbd> 暂停</span></div>`,
  2: `<div class="grid">
    <b style="color:${TEAMS[0].css}">P1 蓝</b><span><kbd>WASD</kbd> 移动 · <kbd>F</kbd> 射门 · <kbd>G</kbd> 挑射 · <kbd>左Shift</kbd> 冲刺</span>
    <b style="color:${TEAMS[1].css}">P2 橙</b><span>方向键 移动 · <kbd>Enter</kbd> 射门 · <kbd>/</kbd> 挑射 · <kbd>右Shift</kbd> 冲刺</span></div>`,
  pads: `<div class="grid">
    <b style="color:${TEAMS[2].css}">P3 紫</b><span>手柄 1：左摇杆移动 · A 射门 · B 挑射 · RB 冲刺</span>
    <b style="color:${TEAMS[3].css}">P4 粉</b><span>手柄 2：同上</span></div>`,
  touch: '<div class="grid"><b>左摇杆</b><span>移动</span><b>射门</b><span>按住蓄力，松开出脚</span><b>挑射 / 冲刺</b><span>右侧按钮</span></div>',
};

export class UI {
  constructor({ sfx, input, camera }) {
    this.sfx = sfx; this.input = input; this.camera = camera;
    this.settings = { net: 'local', humans: 1, level: 'normal', duration: 180 };
    this.muted = false;
    this.tags = [];
    this.net = null;
    this.lobby = null; // host: { slots: [...] }
    this._v = new THREE.Vector3();
  }

  bind(game) {
    this.game = game;
    for (const seg of document.querySelectorAll('.seg')) {
      seg.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        // keep same-key segments (menu + lobby) in sync
        const key = seg.dataset.key, v = b.dataset.v;
        for (const s2 of document.querySelectorAll(`.seg[data-key="${key}"]`)) s2.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === v));
        this.settings[key] = key === 'duration' || key === 'humans' ? +v : v;
        this._refreshMenu();
        if (this.lobby) this._broadcastLobby();
      });
    }
    $('#btn-start').addEventListener('click', () => this.startLocal());
    $('#btn-again').addEventListener('click', () => this.again());
    $('#btn-menu').addEventListener('click', () => this.showMenu());
    $('#btn-quit').addEventListener('click', () => { $('#pause').classList.remove('show'); this.showMenu(); });
    $('#btn-resume').addEventListener('click', () => this.togglePause());
    $('#btn-pause').addEventListener('click', () => this.togglePause());
    $('#btn-cam').addEventListener('click', () => game.cycleCamera());
    $('#btn-mute').addEventListener('click', () => this.toggleMute());
    $('#btn-create').addEventListener('click', () => this.createRoom());
    $('#btn-join').addEventListener('click', () => this.joinRoom());
    $('#btn-lobby-start').addEventListener('click', () => this.startOnline());
    $('#btn-lobby-leave').addEventListener('click', () => this.showMenu());
    $('#in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.joinRoom(); });
    $('#in-name').value = store.get('pf-name') || '';
    addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && $('#menu').classList.contains('show') && this.settings.net === 'local' && !/input/i.test(e.target.tagName)) this.startLocal();
    });
    if (isTouch) this.input.attachTouch($('#touch'));
    addEventListener('gamepadconnected', () => this._refreshMenu());
    addEventListener('gamepaddisconnected', () => this._refreshMenu());

    // scoreboard chips
    $('#chips').innerHTML = TEAMS.map((t, i) => `<div class="chip" id="chip${i}" style="--c:${t.css}"><i></i><span class="nm"></span><b class="ga">0</b></div>`).join('');

    // name tags / charge + stamina meters
    const tagsRoot = $('#tags');
    this.tags = game.athletes.map((a, i) => {
      const el = document.createElement('div'); el.className = 'tag-el';
      el.innerHTML = `<span class="lbl" style="background:${TEAMS[i].css}"></span><div class="stam"><i></i><em>体力</em></div><div class="meter"><i></i><span class="pct"></span></div>`;
      tagsRoot.appendChild(el);
      return { el, lbl: el.querySelector('.lbl'), meter: el.querySelector('.meter'), fill: el.querySelector('.meter i'), pct: el.querySelector('.meter .pct'), stam: el.querySelector('.stam'), stamFill: el.querySelector('.stam i') };
    });
    this._refreshMenu();
  }

  _refreshMenu() {
    const online = this.settings.net === 'online';
    $('#panel-local').classList.toggle('hidden', online);
    $('#panel-online').classList.toggle('hidden', !online);
    const n = this.settings.humans;
    const pads = this.input.padCount;
    const cpus = TEAMS.slice(n).map((t) => t.cpuName).join('、');
    let note = n === 4 ? '' : `其余位置由电脑${cpus}补上。`;
    if (n >= 3) note += ` 3、4 号玩家需要手柄（已连接 ${pads} 个${pads < n - 2 ? '，按一下手柄按键让浏览器识别' : ''}）。`;
    $('#humans-note').textContent = note.trim();
    let help = online || n === 1 ? HELP[1] : HELP[2];
    if (!online && n >= 3) help += HELP.pads;
    if (isTouch && (online || n === 1)) help = HELP.touch;
    $('#controls-help').innerHTML = help;
  }

  loading(p, text) {
    $('#load-bar').style.width = `${Math.round(p * 100)}%`;
    if (text) $('#load-text').textContent = text;
  }

  ready() { $('#loading').classList.remove('show'); this.showMenu(); }

  _hideAll() { for (const id of ['#menu', '#lobby', '#end', '#pause']) $(id).classList.remove('show'); }

  showMenu() {
    this._leaveNet();
    this._hideAll();
    $('#hud').classList.add('hidden');
    $('#touch').classList.add('hidden');
    $('#menu').classList.add('show');
    const g = this.game;
    g.role = 'local'; g.net = null; g.state = 'menu'; g.controllers = [];
    for (const a of g.athletes) { a.frozen = false; a.puppet = false; a.char.stopEmotes(); }
    g.placeAll();
    g.ball.reset(0, 0);
  }

  _showHud() {
    this._hideAll();
    $('#hud').classList.remove('hidden');
    const solo = this.settings.net === 'online' || this.settings.humans === 1;
    $('#touch').classList.toggle('hidden', !(isTouch && solo));
    $('#btn-pause').classList.toggle('hidden', this.settings.net === 'online');
    $('#keyhint').innerHTML = solo
      ? '按住 <b>Space</b> 蓄力射门　·　<b>K</b> 挑射　·　<b>Shift</b> 冲刺　·　守住你的球门！'
      : 'P1：WASD + F/G　·　P2：方向键 + Enter / /　·　P3/P4：手柄';
    $('#keyhint').style.transition = 'none'; $('#keyhint').style.opacity = '1';
    clearTimeout(this._hintT); this._hintT = setTimeout(() => { $('#keyhint').style.transition = 'opacity 1s'; $('#keyhint').style.opacity = '0'; }, 9000);
  }

  startLocal() {
    this.sfx.init();
    this._showHud();
    this.game.role = 'local';
    this.game.start({ humans: this.settings.humans, level: this.settings.level, duration: this.settings.duration, slots: null });
  }

  again() {
    if (this.game.role === 'host') { this._hideAll(); this._showLobby(); this._broadcastLobby(); return; }
    if (this.game.role === 'guest') return;
    this.startLocal();
  }

  togglePause() {
    const g = this.game;
    if (g.role !== 'local') return;
    if (g.state === 'paused') { g.state = this._prevState; $('#pause').classList.remove('show'); }
    else if (['play', 'kickoff', 'goal'].includes(g.state)) { this._prevState = g.state; g.state = 'paused'; $('#pause').classList.add('show'); }
  }

  toggleMute() { this.muted = !this.muted; this.sfx.setMuted(this.muted); $('#btn-mute').classList.toggle('off', this.muted); }

  toast(msg) {
    const k = $('#keyhint'); k.textContent = msg; k.style.transition = 'none'; k.style.opacity = '1';
    clearTimeout(this._toastT); this._toastT = setTimeout(() => { k.style.transition = 'opacity 0.8s'; k.style.opacity = '0'; }, 1300);
  }

  onScore(g) {
    const worst = Math.max(...g.conceded), best = Math.min(...g.conceded);
    g.athletes.forEach((a, i) => {
      const c = $(`#chip${i}`); if (!c) return;
      c.querySelector('.nm').textContent = a.label;
      c.querySelector('.ga').textContent = g.conceded[i];
      c.classList.toggle('worst', worst > best && g.conceded[i] === worst);
      c.classList.toggle('best', worst > best && g.conceded[i] === best);
    });
  }

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
      this._v.set(a.pos.x, 2.0, a.pos.z).project(this.camera);
      if (this._v.z > 1) { t.el.style.display = 'none'; return; }
      t.el.style.display = '';
      t.el.style.transform = `translate(${(this._v.x * 0.5 + 0.5) * w}px, ${(-this._v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
      if (t.lbl.textContent !== a.label) t.lbl.textContent = a.label;
      t.meter.style.display = a.charging ? '' : 'none';
      t.fill.style.width = `${Math.round(a.charge * 100)}%`;
      t.pct.textContent = a.charging ? `${Math.round(a.charge * 100)}%` : '';
      t.meter.classList.toggle('full', a.charging && a.charge >= 1);
      const type = g.controllers[i]?.type;
      const human = type === 'human' || type === 'remote' || type === 'self';
      t.stam.style.display = human ? '' : 'none';
      t.stamFill.style.width = `${Math.round(a.stamina * 100)}%`;
      t.stam.classList.toggle('low', a.exhausted || a.stamina < 0.25);
      t.el.classList.toggle('me', type === 'self' || (type === 'human' && g.role !== 'guest'));
    });
    const ni = $('#netinfo');
    if (this.net && g.role !== 'local') ni.textContent = `房间 ${this.net.code} · 延迟 ${Math.round(this.net.rtt)} ms`;
    else ni.textContent = '';
  }

  showEnd(g, res) {
    const sorted = [...res].sort((a, b) => a.conceded - b.conceded || b.scored - a.scored);
    const best = sorted[0].conceded, worst = sorted[sorted.length - 1].conceded;
    const winners = sorted.filter((r) => r.conceded === best).map((r) => r.name);
    const losers = sorted.filter((r) => r.conceded === worst).map((r) => r.name);
    $('#end-title').textContent = best === worst ? '平局！' : `${winners.join('、')} 获胜`;
    $('#end-sub').textContent = best === worst ? '大家丢球一样多' : `丢球最多：${losers.join('、')}（${worst} 球）`;
    let rank = 0, prev = null;
    $('#end-stats').innerHTML = '<tr><th>名次</th><th>球员</th><th>失球</th><th>进球</th><th>射门</th><th>控球</th></tr>' + sorted.map((r, k) => {
      if (prev === null || r.conceded !== prev) rank = k + 1; prev = r.conceded;
      return `<tr class="${r.conceded === worst && best !== worst ? 'lose' : ''}"><td>${rank}</td><td><i class="dot" style="background:${TEAMS[r.i].css}"></i>${esc(r.name)}</td><td><b>${r.conceded}</b></td><td>${r.scored}</td><td>${r.shots}</td><td>${r.possession}%</td></tr>`;
    }).join('');
    $('#btn-again').classList.toggle('hidden', g.role === 'guest');
    $('#btn-again').textContent = g.role === 'host' ? '回到房间' : '再来一局';
    $('#end').classList.add('show');
    $('#touch').classList.add('hidden');
  }

  // ================================================================ online ==
  _name() {
    const n = ($('#in-name').value || '').trim() || `球员${Math.floor(Math.random() * 90 + 10)}`;
    store.set('pf-name', n); return n.slice(0, 10);
  }

  _status(msg, bad = false) { const s = $('#net-status'); s.textContent = msg; s.classList.toggle('bad', bad); }

  async _connect() {
    this._leaveNet();
    const net = new NetClient();
    this._status('正在连接服务器…');
    try { await net.connect(); }
    catch {
      this._status('连不上联机服务器。联机需要把游戏部署到自己的服务器上（见 README 的“联机部署”）；现在这个网页只能本地游戏。', true);
      return null;
    }
    net.on('closed', () => { if (this.net === net) { this.net = null; this.banner('连接断开', '已回到菜单'); setTimeout(() => this.showMenu(), 1200); } });
    this.net = net;
    return net;
  }

  _leaveNet() {
    if (this.net) { const n = this.net; this.net = null; n.close(); }
    this.lobby = null;
  }

  async createRoom() {
    this.sfx.init();
    const name = this._name();
    const net = await this._connect(); if (!net) return;
    try { await net.create(name); } catch (e) { this._status(e.message, true); return; }
    this.lobby = { slots: [{ kind: 'local', scheme: 'solo', name, id: net.id }] };
    net.on('peer-join', (m) => {
      if (!this.lobby) return;
      const free = this.lobby.slots.length < 4;
      if (free) this.lobby.slots.push({ kind: 'remote', name: m.name, id: m.id });
      this._renderLobby(); this._broadcastLobby();
    });
    net.on('peer-leave', (m) => {
      if (this.lobby) this.lobby.slots = this.lobby.slots.filter((s) => s.id !== m.id);
      this.game.remoteLeft(m.id);
      this._renderLobby(); this._broadcastLobby();
      this.toast('有玩家离开，电脑接替了 TA 的球门');
    });
    net.on('from', (m) => { if (m.data?.k === 'in') this.game.remoteInput(m.id, m.data); });
    this._showLobby();
  }

  async joinRoom() {
    this.sfx.init();
    const code = ($('#in-code').value || '').trim().toUpperCase();
    if (code.length !== 4) { this._status('房间号是 4 位字母或数字', true); return; }
    const name = this._name();
    const net = await this._connect(); if (!net) return;
    try { await net.join(code, name); } catch (e) { this._status(e.message, true); this._leaveNet(); return; }
    net.on('host', (m) => this._onHost(m.data));
    net.on('host-left', () => { this.banner('房主离开了', '房间已关闭'); setTimeout(() => this.showMenu(), 1500); });
    this.guestLobby = { code, slots: [] };
    this._showLobby(false);
  }

  _onHost(d) {
    const g = this.game;
    if (d.k === 'lobby') {
      this.guestLobby.slots = d.slots;
      if (g.role === 'guest') { g.role = 'local'; g.state = 'menu'; }
      this._hideAll(); this._showLobby(false);
      return;
    }
    if (d.k === 'start') {
      this.settings.net = 'online';
      this._showHud();
      g.net = this.net;
      g.startGuest(d, this.net.id);
      return;
    }
    if (g.role === 'guest') g.onHostData(d);
  }

  _showLobby(isHost = true) {
    this._hideAll();
    $('#lobby').classList.add('show');
    $('#lobby-code').textContent = this.net?.code || '';
    $('#lobby-host').classList.toggle('hidden', !isHost);
    $('#lobby-wait').classList.toggle('hidden', isHost);
    this._renderLobby();
  }

  _renderLobby() {
    const slots = this.lobby ? this.lobby.slots : this.guestLobby?.slots || [];
    $('#lobby-slots').innerHTML = TEAMS.map((t, i) => {
      const s = slots[i];
      const who = s ? `${esc(s.name)}${s.id === this.net?.id ? '（你）' : ''}${i === 0 ? ' · 房主' : ''}` : `<span class="cpu">电脑 · ${t.cpuName}</span>`;
      return `<li style="--c:${t.css}"><i></i><span>${who}</span><em>${t.cn}色球门</em></li>`;
    }).join('');
  }

  _broadcastLobby() {
    if (!this.lobby || !this.net) return;
    this.net.broadcast({ k: 'lobby', slots: this.lobby.slots.map(({ name, id, kind }) => ({ name, id, kind })), settings: { level: this.settings.level, duration: this.settings.duration } });
  }

  startOnline() {
    if (!this.lobby) return;
    const slots = TEAMS.map((t, i) => this.lobby.slots[i] || { kind: 'cpu', name: t.cpuName });
    this.settings.net = 'online';
    this._showHud();
    const g = this.game;
    g.role = 'host'; g.net = this.net;
    for (const a of g.athletes) a.puppet = false;
    g.start({ level: this.settings.level, duration: this.settings.duration, slots });
  }
}
