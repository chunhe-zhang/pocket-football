// Thin WebSocket client for the room relay in server/server.js.
// The server only forwards messages; the host's browser runs the match.

export function defaultServerUrl() {
  const p = new URLSearchParams(location.search).get('server');
  if (p) return p;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export class NetClient {
  constructor(url = defaultServerUrl()) {
    this.url = url; this.ws = null; this.handlers = new Map();
    this.id = null; this.code = null; this.isHost = false;
    this.lastPong = 0; this.rtt = 0;
  }

  on(type, fn) { this.handlers.set(type, fn); return this; }
  _emit(type, msg) { this.handlers.get(type)?.(msg); }

  connect(timeout = 5000) {
    return new Promise((resolve, reject) => {
      let done = false;
      try { this.ws = new WebSocket(this.url); } catch (e) { reject(e); return; }
      const timer = setTimeout(() => { if (!done) { done = true; try { this.ws.close(); } catch {} reject(new Error('timeout')); } }, timeout);
      this.ws.onopen = () => { if (done) return; done = true; clearTimeout(timer); this._ping(); resolve(); };
      this.ws.onerror = () => { if (done) return; done = true; clearTimeout(timer); reject(new Error('connect failed')); };
      this.ws.onclose = () => { clearInterval(this.pingTimer); this._emit('closed'); };
      this.ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'pong') { this.rtt = performance.now() - m.at; return; }
        this._emit(m.t, m);
      };
    });
  }

  _ping() {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => this.send({ t: 'ping', at: performance.now() }), 2000);
  }

  send(o) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); }

  /** resolves with the next message of `type` (or rejects on an error message) */
  _await(type) {
    return new Promise((resolve, reject) => {
      this.on(type, (m) => resolve(m));
      this.on('error', (m) => reject(new Error(m.msg || 'error')));
    });
  }

  async create(name) {
    const p = this._await('created');
    this.send({ t: 'create', name });
    const m = await p; this.id = m.id; this.code = m.code; this.isHost = true; return m;
  }

  async join(code, name) {
    const p = this._await('joined');
    this.send({ t: 'join', code: String(code).toUpperCase().trim(), name });
    const m = await p; this.id = m.id; this.code = m.code; this.isHost = false; return m;
  }

  toHost(data) { this.send({ t: 'to-host', data }); }
  broadcast(data) { this.send({ t: 'broadcast', data }); }
  to(id, data) { this.send({ t: 'to', id, data }); }
  close() { clearInterval(this.pingTimer); try { this.ws?.close(); } catch {} }
}
