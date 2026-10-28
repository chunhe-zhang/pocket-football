import * as THREE from 'three';
import { TEAMS, SIDES, FIELD, GOALS, CHARS, CHAR, CAMP, CAMP_NAME, beats } from './config.js';
import { NetClient } from './net.js';

const $ = (s) => document.querySelector(s);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

const HELP = {
  1: `<div class="grid">
    <b>移动</b><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 或方向键</span>
    <b>射门</b><span>按住 <kbd>Space</kbd> 或 <kbd>J</kbd> 蓄力，松开出脚，蓄满是重炮。瞄到球门附近会自动修正到门框以内</span>
    <b>平传</b><span>按住 <kbd>I</kbd> 或 <kbd>Q</kbd>：贴地传给你指着的那个队友（大致方向就行），轻点传到脚下，蓄力越多越往前送、打身后</span>
    <b>瞄准</b><span>蓄力时第一下的方向定大方向，之后按住方向键准星会慢慢转过去，点一下转一点，想打多细的角度都行（手柄、手机摇杆直接指哪打哪）。地上的小点和门上的圈是球会飞的路线</span>
    <b>完美射门</b><span>在蓄力条的金色框里松手：没有偏差；蓄满再松手力量最大但会偏、会往上飘</span>
    <b>挑传 / 挑射</b><span>按住 <kbd>K</kbd>：朝队友是高空传中，球会落到他头顶或胸腿高度，方便头球、凌空；朝着球门就是挑射吊门</span>
    <b>一脚出球</b><span>队友的球还在路上就按键：跑过去不停球直接打——地滚球一脚射门/一脚传，空中球就是凌空抽射或头球。配合打出来的射门更准更狠，回传给刚传你的人就是撞墙配合</span>
    <b>头球</b><span>球在空中时按 <kbd>Space</kbd>：起跳头球攻门（会自动修正到门框里）；按 <kbd>I</kbd> 是头球摆渡给队友；按 <kbd>K</kbd> 是轻轻往上顶或倒钩</span>
    <b>冲刺</b><span><kbd>Shift</kbd>（消耗体力，看头顶蓝条）</span>
    <b>抢断 / 铲球 / 扑救</b><span><kbd>L</kbd> 或 <kbd>E</kbd>：离球近时正面抢断（对手用身体护着球时很难抢到），离得远或冲刺时滑铲（范围大、威力强，但铲空了会躺地、扣体力）；在自己的禁区里是扑救</span>
    <b>过人</b><span>带球时按 <kbd>L</kbd>：放出角色专属过人（雷 Z 字闪电冲刺、影瞬移、风高高腾空飞越（空中还能凌空射门）、火怒吼震飞、冰把人冻成冰雕、土低头冲撞），4 秒一次；冷却中按是普通闪身步。技能放到一半或刚放完时按射门/传球，立刻以最舒服的力度出脚（技能射门）</span>
    <b>必杀射门</b><span>每个角色有自己的必杀（闪电、火焰、冰冻、旋风、幻影、重炮）。每一脚爆射（蓄力超过 30%，轻点的传球除外）都是必杀；地上的预览线会变成角色的颜色。单人必杀对门将效果不大（冰除外）</span>
    <b>元素连携</b><span>每个一脚出球的队友都把自己的元素加到球上：两人连携有组合特效（雷+影瞬移进门、土+火炸飞门将…），三人以上是合击，门将挡不住</span>
    <b>规则</b><span>每人守一个球门，有 2 条命，被进两球就出局，球门会被挡板封死；最后留下的人（2v2 时是最后还有人的一队）获胜</span>
    <b>其它</b><span><kbd>C</kbd> 视角 · <kbd>M</kbd> 静音 · <kbd>P</kbd> 暂停</span></div>`,
  2: `<div class="grid">
    <b>P1</b><span><kbd>WASD</kbd> 移动 · <kbd>F</kbd> 射门/头球 · <kbd>R</kbd> 平传 · <kbd>G</kbd> 挑传/挑射 · <kbd>H</kbd> 抢断/闪身步 · <kbd>左Shift</kbd> 冲刺</span>
    <b>P2</b><span>方向键 移动 · <kbd>Enter</kbd> 射门/头球 · <kbd>,</kbd> 平传 · <kbd>/</kbd> 挑传/挑射 · <kbd>.</kbd> 抢断/闪身步 · <kbd>右Shift</kbd> 冲刺</span></div>`,
  pads: `<div class="grid">
    <b>P3</b><span>手柄 1：左摇杆移动和瞄准 · A 射门/头球 · Y 平传 · B 挑传/挑射 · X 抢断/闪身步 · RB 冲刺</span>
    <b>P4</b><span>手柄 2：同上</span></div>`,
  touch: '<div class="grid"><b>左摇杆</b><span>移动，蓄力时就是瞄准</span><b>射门</b><span>按住蓄力，松开出脚；球在空中时是头球</span><b>传球</b><span>贴地传给指着的队友</span><b>挑传</b><span>朝队友是高空传中，朝球门是挑射</span><b>抢断 / 冲刺</b><span>带球时“抢断”键是闪身步</span></div>',
};

export class UI {
  constructor({ sfx, input, camera }) {
    this.sfx = sfx; this.input = input; this.camera = camera;
    const saved = (store.get('pf-chars') || '').split(',');
    this.settings = { net: 'local', humans: 1, level: 'hard', mode: 'match5', practice: 'gk', pairing: 'humans', map: 'classic', duration: 180, who: '0',
      chars: [0, 1, 2, 3].map((i) => (CHAR[saved[i]] ? saved[i] : CHARS[i].id)) };
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
        // the 6v6 pitch is the 6v6 modes' pitch: picking it picks 6v6; the 6v6 modes only play on it
        if (key === 'map' && v === 'pitch5' && !this._m5mode()) { this.settings.mode = 'match5'; for (const s2 of document.querySelectorAll('.seg[data-key="mode"]')) s2.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === 'match5')); if (this.game.state === 'menu') this.game.previewMode('match5', 'pitch5'); }
        if (key === 'map' && this.game.state === 'menu' && !this._m5mode()) this.game.applyMap(v);
        if (key === 'mode' && this.game.state === 'menu') this.game.previewMode(v, this.settings.map);
        if (key === 'humans' && +this.settings.who >= +v) this._setWho('0');
        this._refreshMenu();
        if (this.lobby) { this._renderLobby(); this._broadcastLobby(); }
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

    // character picker (menu: per local player; lobby: my own)
    for (const box of document.querySelectorAll('.char-pick')) {
      box.innerHTML = CHARS.map((c) => `<button class="char-card" data-c="${c.id}" style="--cc:${c.css}"><canvas class="cv" data-c="${c.id}" aria-hidden="true"></canvas><span class="ic">${c.icon}</span><b>${c.name}</b><small>${c.skill}</small></button>`).join('');
      box.addEventListener('click', (e) => {
        const b = e.target.closest('.char-card'); if (!b) return;
        const who = this.net || this.guestLobby ? 0 : +this.settings.who;
        this.settings.chars[who] = b.dataset.c;
        store.set('pf-chars', this.settings.chars.join(','));
        this.sfx.init(); this.sfx.touch?.();
        this._cheer = true; this._refreshChars(); this._cheer = false;
        this._sendMyChar();
      });
    }
    this.onRoster(game);
    // scoreboard chips
    $('#chips').innerHTML = TEAMS.map((t, i) => `<div class="chip" id="chip${i}" style="--c:${t.css}"><i></i><span class="nm"></span><b class="ga">0</b></div>`).join('');

    this._refreshMenu();
  }

  /** name tags / charge + stamina + special meters, one per player on the pitch */
  onRoster(game) {
    const tagsRoot = $('#tags');
    tagsRoot.innerHTML = '';
    this.tags = game.athletes.map((a) => {
      const el = document.createElement('div'); el.className = 'tag-el';
      el.innerHTML = `<div class="perf">完美!</div><span class="lbl" style="background:${a.css}"></span><div class="stam"><i></i><em>体力</em></div><div class="meter"><i></i><span class="pct"></span></div>`;
      tagsRoot.appendChild(el);
      return { el, perf: el.querySelector('.perf'), lbl: el.querySelector('.lbl'), meter: el.querySelector('.meter'), fill: el.querySelector('.meter i'), pct: el.querySelector('.meter .pct'), stam: el.querySelector('.stam'), stamFill: el.querySelector('.stam i') };
    });
  }

  _setWho(v) {
    this.settings.who = v;
    for (const s2 of document.querySelectorAll('.seg[data-key="who"]')) s2.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === v));
  }

  _refreshChars() {
    const online = !!(this.net || this.guestLobby);
    const n = this.settings.humans, multi = !online && n > 1;
    for (const w of document.querySelectorAll('.who-seg')) { w.classList.toggle('hidden', !multi); w.querySelectorAll('button').forEach((b) => b.classList.toggle('hidden', +b.dataset.v >= n)); }
    const who = online ? 0 : +this.settings.who;
    const cur = CHAR[this.settings.chars[who]] || CHARS[0];
    for (const b of document.querySelectorAll('.char-card')) b.classList.toggle('on', b.dataset.c === cur.id);
    this.showroom?.select(cur.id, !!this._cheer);
    const m5 = this._m5mode();
    for (const nEl of document.querySelectorAll('.char-note')) nEl.innerHTML = `<b style="color:${cur.css}">${cur.icon} ${cur.name} · ${cur.skill}</b>：${cur.desc}。<b>过人</b>：${cur.move}（带球时按抢断键，4 秒一次，冷却时是普通闪身步）。每一脚爆射（轻点的传球除外）都是必杀射门。${m5 ? this._campLine(cur.id) : ''}${m5 ? '6v6 里你选的角色是你一开场控制的球员，队友和对手的角色随机。' : '电脑的角色随机。'}`;
  }

  _sendMyChar() {
    const c = this.settings.chars[0];
    if (this.lobby) { const me = this.lobby.slots[0]; if (me) me.char = c; this._renderLobby(); this._broadcastLobby(); }
    else if (this.guestLobby && this.net) this.net.toHost({ k: 'char', c });
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
    if (this.settings.mode === 'match5') note = `每个真人控制一名场上球员（门将永远由电脑控制），其余由电脑踢。${n >= 3 ? ` 3、4 号玩家需要手柄（已连接 ${pads} 个）。` : ''}`;
    $('#humans-note').textContent = note.trim();
    let help = online || n === 1 ? HELP[1] : HELP[2];
    if (!online && n >= 3) help += HELP.pads;
    if (isTouch && (online || n === 1)) help = HELP.touch;
    $('#controls-help').innerHTML = help;
    const team = this.settings.mode === 'team' || this.settings.mode === 'match5';
    const m5 = this._m5mode(), practice = this.settings.mode === 'practice';
    // the map row: the 6v6 modes play on the 6v6 pitch only, the others never on it
    for (const s2 of document.querySelectorAll('.seg[data-key="map"]')) s2.querySelectorAll('button').forEach((x) => {
      const p5 = x.dataset.v === 'pitch5';
      x.classList.toggle('on', m5 ? p5 : x.dataset.v === this.settings.map);
      x.classList.toggle('dis', m5 ? !p5 : false);
    });
    for (const r of document.querySelectorAll('.practice-row')) r.classList.toggle('hidden', !practice);
    this._refreshChars();
    const people = online ? (this.lobby ? this.lobby.slots.length : (this.guestLobby?.slots.length || 1)) : n;
    for (const r of document.querySelectorAll('.pairing-row')) r.classList.toggle('hidden', !team || people < 2);
    const pairNote = this.settings.pairing === 'vs' ? '真人分在两边' : '真人尽量分在同一队';
    for (const m of document.querySelectorAll('.map-note')) m.textContent = m5 ? '6v6 标准场：50 × 31 米长方形球场，两个球门，大小禁区，波浪形围板。6v6 比赛和练习场都在这块场地上。' : this.settings.map === 'track'
      ? '拼运气的方块乐园：小正方形场地，每人的球门就是自己那一整条边，中间塞满方形机关（每种四个，对每个人都一样）：传送门、加速块、漩涡、命运转盘、果冻弹块、弹跳垫。每个门前有护盾，第一次撞碎，第二次才能进。大脚一踢，球自己会找到某个门。每人 3 条命。'
      : '小巧的圆形球场，一眼看全场。';
    const LV = { easy: '简单：电脑跑得慢、射门偏，很少抢断。', normal: '普通：电脑会配合、会抢断，门将不错。', hard: '困难：电脑反应快、爱一脚出球和打连携，门将很难打穿。', gf: '女友模式：电脑很菜，拿到球就传给真人玩家，让你射门。' };
    for (const m of document.querySelectorAll('.level-note')) m.textContent = LV[this.settings.level] || '';
    for (const m of document.querySelectorAll('.mode-note')) m.textContent = practice
      ? '练习场：6v6 标准场上只有你和对方门将，可以再加一个队友或一个对手（上面的“练习”一栏），用来练带球、过人、射门和配合。没有比赛时间，不判越位，进球后从中圈重新开始。'
      : m5
      ? `大号六人制球场（波浪围板），两队各 6 人（1 门将 + 1 后卫 + 左中右三人组 + 1 前锋，每队六种元素各一个），分上下半场，${Math.round(this.settings.duration / 60)} 分钟比赛，进球多的一队赢，平局就金球加时。你从头到尾控制同一名球员（前锋），其他 11 人都是电脑，门将也由电脑控制。${people >= 2 ? (this.settings.pairing === 'vs' ? '真人分在两队。' : '真人都在蓝队。') : ''}`
      : team
      ? `两人一队，开赛时随机分配球门${people >= 2 ? `，${pairNote}` : ''}。往队友那边轻踢就是传球，挑射可以传给队友头球；最后还有人在场的一队获胜。`
      : '每人守一个球门，谁都可以打，最后留下的人获胜。';
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
    g.role = 'local'; g.net = null; g.state = 'menu'; g.controllers = []; g.side = null; g.cursors = [];
    g.previewMode(this.settings.mode, this.settings.map);
    g._resetElimination();
    for (const a of g.athletes) { a.frozen = false; a.puppet = false; a.char.stopEmotes(); }
    g.placeAll();
    g.ball.reset(0, 0);
  }

  _showHud() {
    this._hideAll();
    $('#hud').classList.remove('hidden');
    const solo = this.settings.net === 'online' || this.settings.humans === 1;
    $('#touch').classList.toggle('hidden', !(isTouch && solo));
    const team = this.game.teamMode;
    $('#btn-pass').classList.remove('hidden'); $('#btn-pass').textContent = '传球'; $('#btn-lob').textContent = '挑传';
    $('#scoreboard').classList.toggle('m5', this.game.m5);
    $('#btn-pause').classList.toggle('hidden', this.settings.net === 'online');
    $('#keyhint').innerHTML = solo
      ? `<b>Space</b> 射门（空中＝头球）　·　<b>I</b> 平传　·　<b>K</b> 挑传/挑射　·　<b>L</b> 抢断 · 带球时闪身步　·　<b>Shift</b> 冲刺　·　球在路上就按＝一脚出球`
      : `P1：WASD + F 射门 / R 平传 / G 挑传 / H 抢断　·　P2：方向键 + Enter / , / / / .　·　P3/P4：手柄`;
    $('#keyhint').style.transition = 'none'; $('#keyhint').style.opacity = '1';
    clearTimeout(this._hintT); this._hintT = setTimeout(() => { $('#keyhint').style.transition = 'opacity 1s'; $('#keyhint').style.opacity = '0'; }, 9000);
  }

  startLocal() {
    this.sfx.init();
    this.game.role = 'local';
    this.game.start({ humans: this.settings.mode === 'practice' ? 1 : this.settings.humans, practice: this.settings.practice, level: this.settings.level, mode: this.settings.mode, pairing: this.settings.pairing, map: this.settings.map, duration: this.settings.duration, chars: this.settings.chars.slice(), slots: null });
    this._showHud();
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
    else if (['play', 'kickoff', 'goal', 'halftime'].includes(g.state)) { this._prevState = g.state; g.state = 'paused'; $('#pause').classList.add('show'); }
  }

  toggleMute() { this.muted = !this.muted; this.sfx.setMuted(this.muted); $('#btn-mute').classList.toggle('off', this.muted); }

  _m5mode() { return this.settings.mode === 'match5' || this.settings.mode === 'practice'; }

  /** 6v6: which camp this element is in, which camp it beats and which beats it */
  _campLine(id) {
    const c = CAMP[id], els = (k) => CHARS.filter((x) => CAMP[x.id] === k).map((x) => `${x.icon}${x.name}`).join(' ');
    const win = { force: 'ctrl', ctrl: 'agile', agile: 'force' }[c], lose = { force: 'agile', ctrl: 'force', agile: 'ctrl' }[c];
    return `<br><b>阵营：${CAMP_NAME[c]}</b>（${els(c)}）· <b style="color:#7cf07c">克制</b> ${CAMP_NAME[win]}（${els(win)}）· <b style="color:#ff8a7a">被克制</b> ${CAMP_NAME[lose]}（${els(lose)}）。比赛里对手名字旁会标出“我克 / 克我”。<br>`;
  }

  toast(msg) {
    const k = $('#keyhint'); k.textContent = msg; k.style.transition = 'none'; k.style.opacity = '1';
    clearTimeout(this._toastT); this._toastT = setTimeout(() => { k.style.transition = 'opacity 0.8s'; k.style.opacity = '0'; }, 1300);
  }

  onScore(g) {
    if (g.m5 && g.practice) {
      $('#clock').innerHTML = `<span class="score5"><span class="t" style="background:${TEAMS[0].css}">练习场</span><span class="n">进球 ${g.conceded[1]}</span></span>`;
      this._clockKey = null; return;
    }
    if (g.m5) {
      const gold = g.golden ? ' <span class="gold">金球</span>' : '';
      const cd = (i) => { const c = g.cards?.[i]; return c ? `<span class="cd">${'▮'.repeat(Math.min(3, c.y)).replace(/▮/g, '<i class="y"></i>')}${'<i class="r"></i>'.repeat(Math.min(3, c.r))}</span>` : ''; };
      $('#clock').innerHTML = `<span class="score5">${cd(0)}<span class="t" style="background:${TEAMS[0].css}">${TEAMS[0].cn}</span><span class="n">${g.conceded[1]} : ${g.conceded[0]}</span><span class="t" style="background:${TEAMS[1].css}">${TEAMS[1].cn}</span>${cd(1)}<span class="hf">${g.golden ? '' : g.half === 2 ? '下半场' : '上半场'}</span><span class="tm">${this._mmss(g.clock)}</span>${gold}</span>`;
      this._clockKey = null;
      return;
    }
    g.athletes.forEach((a, i) => {
      const c = $(`#chip${i}`); if (!c) return;
      const alive = g.alive ? g.alive[i] : true;
      c.querySelector('.nm').textContent = a.label;
      const lives = Math.max(0, (g.lives ?? 2) - (g.conceded ? g.conceded[i] : 0));
      c.querySelector('.ga').textContent = alive ? '♥'.repeat(lives) + '♡'.repeat(Math.max(0, (g.lives ?? 2) - lives)) : '出局';
      c.classList.toggle('out', !alive);
      const s = g.side ? SIDES[g.side[i]] : null;
      c.classList.toggle('side', !!s);
      if (s) c.style.setProperty('--sc', s.css);
      c.querySelector('.nm').innerHTML = (s ? `<span class="side-badge">${s.icon}</span>` : '') + esc(a.label);
    });
    const left = g.alive ? g.alive.filter(Boolean).length : 4;
    $('#clock').innerHTML = g.side
      ? SIDES.map((s, k) => `<span class="side-badge" style="--sc:${s.css}">${s.icon}</span>${g.alive.filter((v, i) => v && g.side[i] === k).length}`).join(' : ')
      : `剩 ${left} 人`;
  }

  _mmss(t) { t = Math.max(0, Math.ceil(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }

  // no big text flashing in the middle of the screen: the scoreboard says what happened
  banner(big, small) {
    void big; void small;
    $('#banner').classList.remove('show');
  }

  _bannerOld(big, small) {
    const b = $('#banner');
    if (!big) { b.classList.remove('show'); return; }
    $('#banner-big').textContent = big; $('#banner-small').textContent = small;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(this._bannerT); this._bannerT = setTimeout(() => b.classList.remove('show'), 2600);
  }

  updateHud(g) {
    if (g.state === 'menu') { for (const t of this.tags) t.el.style.display = 'none'; return; }
    const left = g.alive ? g.alive.filter(Boolean).length : 4;
    $('#clock').classList.toggle('low', g.m5 ? g.clock < 15 && !g.golden : !g.side && left === 2);
    if (g.m5 && !g.practice) { const tm = $('#clock .tm'), key = Math.ceil(g.clock) + (g.golden ? 'g' : '') + (g.half || 1); if (tm && key !== this._clockKey) { this._clockKey = key; if ((g.golden && !$('#clock .gold')) || $('#clock .hf')?.textContent !== (g.golden ? '' : g.half === 2 ? '下半场' : '上半场')) this.onScore(g); else tm.textContent = this._mmss(g.clock); } }
    const w = innerWidth, h = innerHeight;
    g.athletes.forEach((a, i) => {
      const t = this.tags[i];
      if (g.fpAth === a) { t.el.style.display = ''; t.el.style.transform = `translate(${w / 2}px, ${h * 0.93}px) translate(-50%, -100%)`; }   // first person: my own tag (and charge meter) sits at the bottom
      else {
        this._v.set(a.pos.x, 2.0, a.pos.z).project(this.camera);
        if (this._v.z > 1 || a.out) { t.el.style.display = 'none'; return; }
        t.el.style.display = '';
        t.el.style.transform = `translate(${(this._v.x * 0.5 + 0.5) * w}px, ${(-this._v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
      }
      const ctl = g.controllers[i];
      const s = g.side && !g.m5 ? SIDES[g.side[i]] : null, d = a.charDef;
      const nm = g.m5 ? (ctl?.cursor?.name || ctl?.cursorName || (ctl?.type === 'self' ? '我' : '') || `${a.no} ${a.label}`) : a.label;
      // 6v6: next to every opponent, whether I (the player I'm controlling) beat him or he beats me
      const meA = g.m5 ? g._myAthlete?.() : null;
      const rel = meA && a !== meA && a.gi !== meA.gi ? (beats(meA.charId, a.charId) ? 'win' : beats(a.charId, meA.charId) ? 'lose' : '') : meA === a ? 'me' : '';
      const key = (s ? s.icon : '') + nm + d.id + rel;
      if (t.key !== key) {
        t.key = key;
        const relTag = rel === 'win' ? '<span class="rel win">我克</span>' : rel === 'lose' ? '<span class="rel lose">克我</span>' : rel === 'me' ? `<span class="rel me">${CAMP_NAME[CAMP[d.id]]}</span>` : '';
        t.lbl.innerHTML = `<span class="ci">${d.icon}</span>` + (s ? `<span class="side-badge">${s.icon}</span>` : '') + esc(nm) + relTag;
        t.el.classList.toggle('side', !!s);
        if (s) t.el.style.setProperty('--sc', s.css);
      }
      const showing = a.charging || a.armed;
      const cv = a.armed ? a.armed.power : a.charge;
      t.meter.style.display = showing ? '' : 'none';
      t.fill.style.width = `${Math.round(cv * 100)}%`;
      const isPass = a.chargeType === 'pass';
      t.pct.textContent = showing ? `${isPass ? '传球 ' : ''}${Math.round(cv * 100)}%` : '';
      t.meter.classList.toggle('full', showing && cv >= 1);
      t.meter.classList.toggle('pass', isPass);
      const fl = g.time - (a.flairT ?? -9) < 1.1, pf = g.time - (a.lastPerfectT ?? -9) < 0.7;
      if ((fl || pf) && !t.el.classList.contains('perfect')) t.perf.textContent = fl ? a.flairText : '完美!';
      t.el.classList.toggle('perfect', fl || pf); t.el.classList.toggle('flair', fl);
      const type = g.controllers[i]?.type;
      const human = type === 'human' || type === 'remote' || type === 'self';
      t.stam.style.display = human ? '' : 'none';
      t.stamFill.style.width = `${Math.round(a.stamina * 100)}%`;
      t.stam.classList.toggle('low', a.exhausted || a.stamina < 0.25);
      t.el.classList.toggle('me', type === 'self' || (type === 'human' && g.role !== 'guest'));
      t.el.classList.toggle('cpu5', g.m5 && !human && !ctl?.cursorName);
    });
    this._drawMinimap(g);
    if (!g.m5) g.athletes.forEach((a, i) => { const c = $(`#chip${i}`); if (c) c.classList.toggle('shielded', !!g.ball.shields?.has(i)); });
    const ni = $('#netinfo');
    if (this.net && g.role !== 'local') ni.textContent = `房间 ${this.net.code} · 延迟 ${Math.round(this.net.rtt)} ms`;
    else ni.textContent = '';
  }

  onMapChange(g) { $('#minimap').classList.toggle('hidden', !((g.bigMap || g.fpAth) && g.state !== 'menu')); }

  /** big map: a little overview of the whole arena */
  _drawMinimap(g) {
    const cv = $('#minimap');
    const show = (g.bigMap || !!g.fpAth) && g.state !== 'menu';
    cv.classList.toggle('hidden', !show);
    if (!show) return;
    const ctx = cv.getContext('2d'), W = cv.width, Hh = cv.height, pad = 8;
    const s = Math.min((W - 2 * pad) / (2 * FIELD.hx), (Hh - 2 * pad) / (2 * FIELD.hz));
    const X = (x) => W / 2 + x * s, Y = (z) => Hh / 2 + z * s;
    ctx.clearRect(0, 0, W, Hh);
    // arena
    const r = FIELD.cornerR * s, x0 = X(-FIELD.hx), x1 = X(FIELD.hx), y0 = Y(-FIELD.hz), y1 = Y(FIELD.hz);
    ctx.beginPath(); ctx.moveTo(x0 + r, y0); ctx.arcTo(x1, y0, x1, y1, r); ctx.arcTo(x1, y1, x0, y1, r); ctx.arcTo(x0, y1, x0, y0, r); ctx.arcTo(x0, y0, x1, y0, r); ctx.closePath();
    ctx.fillStyle = 'rgba(90, 190, 95, 0.75)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
    // flower beds
    ctx.lineCap = 'round';
    for (const c of FIELD.islands || []) {
      ctx.fillStyle = ctx.strokeStyle = '#ff9ecb';
      if (Math.hypot(c.bx - c.ax, c.bz - c.az) < 0.01) { ctx.beginPath(); ctx.arc(X(c.ax), Y(c.az), c.r * s, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.lineWidth = c.r * 2 * s; ctx.beginPath(); ctx.moveTo(X(c.ax), Y(c.az)); ctx.lineTo(X(c.bx), Y(c.bz)); ctx.stroke(); }
    }
    const dot = (o, col, k = 1) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(o.x), Y(o.z), Math.max(2.2, o.r * s * k), 0, Math.PI * 2); ctx.fill(); };
    for (const o of FIELD.portals || []) dot(o, o.idx % 2 ? '#ff6ad5' : '#b45cff');
    for (const o of FIELD.boosts || []) dot(o, '#ff8a2a');
    for (const o of FIELD.vortices || []) dot(o, '#3b9bff');
    for (const o of FIELD.wheels || []) dot(o, '#ffffff');
    ctx.lineCap = 'butt';
    for (const p of FIELD.pads || []) { ctx.fillStyle = 'rgba(80,220,255,0.7)'; ctx.save(); ctx.translate(X(p.x), Y(p.z)); ctx.rotate(Math.atan2(p.dz, p.dx)); ctx.fillRect(-p.len * s / 2, -p.wid * s / 2, p.len * s, p.wid * s); ctx.restore(); }
    for (const b of FIELD.bumpers || []) { ctx.fillStyle = '#ff4f7b'; ctx.beginPath(); ctx.arc(X(b.x), Y(b.z), Math.max(2, b.r * s * 1.4), 0, Math.PI * 2); ctx.fill(); }
    for (const sp of FIELD.springs || []) { ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(X(sp.x), Y(sp.z), Math.max(2, sp.r * s), 0, Math.PI * 2); ctx.fill(); }
    // goals
    for (const go of GOALS) {
      const open = g.m5 || (g.alive ? g.alive[go.team] : true);
      ctx.strokeStyle = open ? TEAMS[go.team].css : 'rgba(255,255,255,0.5)'; ctx.lineWidth = 4;
      const gw = FIELD.goalHalfW * s;
      ctx.beginPath();
      if (go.axis === 'x') { ctx.moveTo(X(go.centre.x), Y(-FIELD.goalHalfW)); ctx.lineTo(X(go.centre.x), Y(FIELD.goalHalfW)); }
      else { ctx.moveTo(X(-FIELD.goalHalfW), Y(go.centre.z)); ctx.lineTo(X(FIELD.goalHalfW), Y(go.centre.z)); }
      ctx.stroke(); void gw;
    }
    // players and ball
    g.athletes.forEach((a, i) => {
      if (a.out) return;
      const type = g.controllers[i]?.type, me = type === 'self' || (type === 'human' && g.role !== 'guest');
      ctx.fillStyle = a.css || TEAMS[g.m5 ? a.gi : i]?.css || '#fff'; ctx.beginPath(); ctx.arc(X(a.pos.x), Y(a.pos.z), me ? 5 : 4, 0, Math.PI * 2); ctx.fill();
      if (me) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
      if (g.side && !g.m5) { ctx.fillStyle = SIDES[g.side[i]].css; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(SIDES[g.side[i]].icon, X(a.pos.x), Y(a.pos.z) - 7); }
    });
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(X(g.ball.pos.x), Y(g.ball.pos.z), 3.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  showEnd(g, res) {
    if (res.m5) { this._showEnd5(g, res); return; }
    const win = res[0];
    const team = win.side !== null && win.side !== undefined;
    if (team) {
      const s = SIDES[win.side];
      $('#end-title').textContent = `${s.icon} ${s.name}获胜！`;
      $('#end-sub').textContent = res.filter((r) => r.side === win.side).map((r) => r.name).join(' + ') + ' 赢得了 2v2';
    } else {
      $('#end-title').textContent = `${win.name} 获胜！`;
      $('#end-sub').textContent = '最后留下的人赢得比赛';
    }
    const last = Math.max(...res.map((r) => r.place));
    $('#end-stats').innerHTML = '<tr><th>名次</th><th>球员</th><th>被谁淘汰</th><th>淘汰别人</th><th>射门</th></tr>' + res.map((r) =>
      `<tr class="${r.place === last ? 'lose' : ''}"><td>${r.place === 1 ? '🏆' : r.place}</td><td>${team ? `<span class="side-badge" style="--sc:${SIDES[r.side].css}">${SIDES[r.side].icon}</span>` : ''}<i class="dot" style="background:${TEAMS[r.i].css}"></i>${esc(r.name)}</td><td>${esc(r.by) || '—'}</td><td><b>${r.kos}</b></td><td>${r.shots}</td></tr>`).join('');
    $('#btn-again').classList.toggle('hidden', g.role === 'guest');
    $('#btn-again').textContent = g.role === 'host' ? '回到房间' : '再来一局';
    $('#end').classList.add('show');
    $('#touch').classList.add('hidden');
  }

  _showEnd5(g, res) {
    const [a, b] = res.score;
    $('#end-title').innerHTML = `<span style="color:${TEAMS[0].css}">${TEAMS[0].cn}队</span> ${a} : ${b} <span style="color:${TEAMS[1].css}">${TEAMS[1].cn}队</span>`;
    $('#end-sub').textContent = res.win < 0 ? '平局' : `${TEAMS[res.win].cn}队赢得了比赛`;
    $('#end-stats').innerHTML = '<tr><th>队</th><th>球员</th><th>角色</th><th>进球</th><th>射门</th></tr>' + res.players.map((r) =>
      `<tr class="${res.win >= 0 && r.side !== res.win ? 'lose' : ''}"><td><i class="dot" style="background:${TEAMS[r.side].css}"></i></td><td>${esc(r.no)} ${esc(r.name)}</td><td>${CHAR[r.char]?.icon || ''} ${CHAR[r.char]?.name || ''}</td><td><b>${r.goals}</b></td><td>${r.shots}</td></tr>`).join('');
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
    this.guestLobby = null;
  }

  async createRoom() {
    this.sfx.init();
    const name = this._name();
    const net = await this._connect(); if (!net) return;
    try { await net.create(name); } catch (e) { this._status(e.message, true); return; }
    this.lobby = { slots: [{ kind: 'local', scheme: 'solo', name, id: net.id, char: this.settings.chars[0] }] };
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
    net.on('from', (m) => {
      if (m.data?.k === 'in') this.game.remoteInput(m.id, m.data);
      else if (m.data?.k === 'char' && this.lobby && CHAR[m.data.c]) { const sl = this.lobby.slots.find((x) => x.id === m.id); if (sl) { sl.char = m.data.c; this._renderLobby(); this._broadcastLobby(); } }
    });
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
    this._sendMyChar();
  }

  _onHost(d) {
    const g = this.game;
    if (d.k === 'lobby') {
      this.guestLobby.slots = d.slots;
      if (d.settings) {
        this.guestLobby.settings = d.settings;
        if (g.state === 'menu') g.previewMode(d.settings.mode, d.settings.map);   // preview the host's map
      }
      if (g.role === 'guest') { g.role = 'local'; g.state = 'menu'; }
      this._hideAll(); this._showLobby(false);
      return;
    }
    if (d.k === 'start') {
      this.settings.net = 'online';
      g.net = this.net;
      g.startGuest(d, this.net.id);
      this._showHud();
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
      const ch = s && CHAR[s.char];
      const who = s ? `${ch ? ch.icon + ' ' : ''}${esc(s.name)}${s.id === this.net?.id ? '（你）' : ''}${i === 0 ? ' · 房主' : ''}` : `<span class="cpu">电脑 · ${t.cpuName}</span>`;
      const st = this.lobby ? this.settings : this.guestLobby?.settings || {};
      let where = `${t.cn}色球门`;
      if (st.mode === 'match5') { const k = st.pairing === 'vs' ? i % 2 : 0; where = s ? `${TEAMS[k].cn}队` : ''; }
      if (st.mode === 'team') {
        const k = st.pairing === 'vs' ? i % 2 : i < 2 ? 0 : 1, sd = SIDES[k];
        where = `<span class="side-badge" style="--sc:${sd.css}">${sd.icon}</span>${sd.name} · 随机球门`;
      }
      return `<li style="--c:${t.css}"><i></i><span>${who}</span><em>${where}</em></li>`;
    }).join('');
    this._refreshMenu();
  }

  _broadcastLobby() {
    if (!this.lobby || !this.net) return;
    this.net.broadcast({ k: 'lobby', slots: this.lobby.slots.map(({ name, id, kind, char }) => ({ name, id, kind, char })), settings: { level: this.settings.level, mode: this.settings.mode, pairing: this.settings.pairing, map: this.settings.map, duration: this.settings.duration } });
  }

  startOnline() {
    if (!this.lobby) return;
    const slots = TEAMS.map((t, i) => this.lobby.slots[i] || { kind: 'cpu', name: t.cpuName });
    this.settings.net = 'online';
    const g = this.game;
    g.role = 'host'; g.net = this.net;
    for (const a of g.athletes) a.puppet = false;
    g.start({ level: this.settings.level, mode: this.settings.mode, pairing: this.settings.pairing, map: this.settings.map, duration: this.settings.duration, slots });
    this._showHud();
  }
}
