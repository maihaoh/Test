/* V34 local Choice D51 bridge. Paste this code into the Chrome DevTools Console
 * on the already-authorized official Choice D51 game page. This script reads
 * received application messages ONLY and relays decoded B/P/T results via
 * postMessage to the user's own dashboard; it does not access credentials,
 * call provider APIs, send WebSocket packets, click controls, or place bets.
 * The dashboard placeholders below are replaced by the Copy button.
 */
(() => {
  'use strict';
  const TARGET_URL = '__V34_DASHBOARD_URL__';
  const TARGET_ORIGIN = '__V34_DASHBOARD_ORIGIN__';
  const TAG = 'choice-d51-browser-bridge-v34';
  const RESULT_PACKET = 135176; // Source-derived BAC_FULL_RESULT_LIST
  const LIMIT = 4 * 1024 * 1024;
  const utf8 = new TextDecoder('utf-8', {fatal: true});

  if (location.origin !== 'https://gci.arvideo.video') {
    console.warn('[Choice D51] 请先打开官方 D51 房间，再在该页面 Console 运行。');
    return;
  }
  if (typeof queryObjects !== 'function') {
    console.warn('[Choice D51] 当前 Console 不支持 queryObjects(WebSocket)。请使用 Chrome DevTools Console。');
    return;
  }
  if (window.__CHOICE_D51_BRIDGE_V34__) window.__CHOICE_D51_BRIDGE_V34__.stop();

  let running = true;
  let board = null;
  let openerAcknowledged = false;
  let watched = new Map();
  let lastDigest = '';
  let lastSnapshot = null;
  let accepted = 0;
  let frames = 0;
  let malformed = 0;

  function openBoard() {
    try {
      if (!board || board.closed) board = window.open(TARGET_URL, 'choice-d51-board-v34');
    } catch (_) { board = null; }
  }
  function publish(type, extra = {}) {
    const msg = {tag: TAG, type, room: 'D51', at: Date.now(), ...extra};
    const targets = [board, window.opener];
    const sent = new Set();
    for (const target of targets) {
      if (!target || sent.has(target)) continue;
      sent.add(target);
      try { if (!target.closed) target.postMessage(msg, TARGET_ORIGIN); } catch (_) {}
    }
  }
  function u32(b, i) {
    return ((b[i] * 16777216) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]) >>> 0;
  }
  function ascii(b, start, end) {
    if (end - start !== 4) throw new Error('invalid room identifier');
    return String.fromCharCode(...b.subarray(start, end));
  }
  function varint(b, state, end) {
    let result = 0, mult = 1;
    for (let count = 0; count < 10; count++) {
      if (state.pos >= end) throw new Error('truncated varint');
      const byte = b[state.pos++];
      result += (byte & 127) * mult;
      if (!Number.isSafeInteger(result)) throw new Error('oversized integer');
      if (!(byte & 128)) return result;
      mult *= 128;
    }
    throw new Error('invalid varint');
  }
  function block(b, state, end) {
    const size = varint(b, state, end);
    if (size > end - state.pos) throw new Error('truncated field');
    const start = state.pos;
    state.pos += size;
    return {start, end: state.pos};
  }
  function skip(b, state, end, wire) {
    if (wire === 0) varint(b, state, end);
    else if (wire === 1) state.pos += 8;
    else if (wire === 2) block(b, state, end);
    else if (wire === 5) state.pos += 4;
    else throw new Error('unsupported protobuf group');
    if (state.pos > end) throw new Error('invalid wire field');
  }
  function parseSnapshot(packet) {
    if (packet.length < 16 || u32(packet, 0) !== RESULT_PACKET) return null;
    if (u32(packet, 4) !== packet.length) throw new Error('length mismatch');
    if (ascii(packet, 12, 16) !== 'D051') return null;
    const state = {pos: 16};
    const vals = [];
    let innerVid = '';
    let guard = 0;
    while (state.pos < packet.length) {
      if (++guard > 20000) throw new Error('field count limit');
      const tag = varint(packet, state, packet.length);
      const field = Math.floor(tag / 8), wire = tag & 7;
      if (field <= 0) throw new Error('invalid protobuf field');
      if (field === 1 && wire === 2) {
        const r = block(packet, state, packet.length);
        innerVid = utf8.decode(packet.subarray(r.start, r.end));
      } else if (field === 3 && wire === 2) {
        const r = block(packet, state, packet.length);
        const inner = {pos: r.start};
        while (inner.pos < r.end) {
          if (vals.length >= 2000) throw new Error('too many rounds');
          vals.push(varint(packet, inner, r.end));
        }
      } else if (field === 3 && wire === 0) {
        vals.push(varint(packet, state, packet.length));
      } else skip(packet, state, packet.length, wire);
    }
    if (innerVid && innerVid !== 'D051') throw new Error('room mismatch');
    if (!vals.length) return null;
    const codes = vals.map(n => {
      if (!Number.isInteger(n) || n < 0 || n > 0x7fffffff) throw new Error('invalid wininfo');
      const flags = n & 255, outcome = flags & 7, points = (n >>> 8) & 255;
      if (![1, 2, 4].includes(outcome) || points > 9) throw new Error('ambiguous outcome');
      return outcome === 1 ? 'B' : outcome === 2 ? 'P' : 'T';
    });
    return codes.slice(-300);
  }
  function accept(frame) {
    if (!running) return;
    if (!Array.isArray(frame) || frame.length < 1 || frame.length > 300) { malformed++; return; }
    const signature = frame.join('');
    if (signature !== lastDigest) {
      lastDigest = signature;
      lastSnapshot = frame.slice();
      accepted++;
      publish('snapshot', {results: frame, count: frame.length});
      console.log(`[Choice D51] 已解析第 ${accepted} 份 D51 历史快照，记录 ${frame.length} 条；仅同步庄/闲/和。`);
    }
  }
  function feed(session, bytes) {
    if (!running || !bytes.length || bytes.length > LIMIT) return;
    const buffer = new Uint8Array(session.pending.length + bytes.length);
    if (buffer.length > LIMIT) { session.pending = new Uint8Array(0); malformed++; return; }
    buffer.set(session.pending);
    buffer.set(bytes, session.pending.length);
    let offset = 0;
    try {
      while (buffer.length - offset >= 12) {
        const length = u32(buffer, offset + 4);
        if (length < 12 || length > LIMIT) throw new Error('unknown framing');
        if (buffer.length - offset < length) break;
        const packet = buffer.subarray(offset, offset + length);
        const decoded = parseSnapshot(packet);
        if (decoded) accept(decoded);
        offset += length;
      }
      session.pending = buffer.slice(offset);
    } catch (_) {
      session.pending = new Uint8Array(0);
      malformed++;
    }
  }
  async function onMessage(session, event) {
    try {
      const raw = event.data;
      let buf;
      if (raw instanceof ArrayBuffer) buf = raw;
      else if (typeof Blob !== 'undefined' && raw instanceof Blob) buf = await raw.arrayBuffer();
      else if (ArrayBuffer.isView(raw)) buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      else return;
      if (running) { frames++; feed(session, new Uint8Array(buf)); }
    } catch (_) { malformed++; }
  }
  function attach() {
    if (!running) return;
    let sockets;
    try { sockets = queryObjects(WebSocket); }
    catch (_) { return; }
    if (!Array.isArray(sockets)) return;
    for (const socket of sockets) {
      if (!socket || watched.has(socket) || socket.readyState !== 1) continue;
      let port = '';
      try {
        const u = new URL(socket.url);
        if (u.protocol !== 'wss:' || !(u.hostname === 'mdvuz.com' || u.hostname.endsWith('.mdvuz.com') || u.hostname.endsWith('.e9p1.com'))) continue;
        port = u.port;
      } catch (_) { continue; }
      const session = {port, pending: new Uint8Array(0), queue: Promise.resolve()};
      const listener = e => {
        session.queue = session.queue.then(() => onMessage(session, e)).catch(() => { malformed++; });
      };
      socket.addEventListener('message', listener);
      watched.set(socket, {listener, session});
      console.log(`[Choice D51] 正在监听游戏连接端口 ${port}，不发送任何数据。`);
    }
  }

  function onDashboardAck(event) {
    if (event.origin === TARGET_ORIGIN && event.data?.tag === TAG && event.data?.type === 'ack') {
      openerAcknowledged = true;
      console.log('[Choice D51] 已确认网站标签页可接收 D51 结果。');
      if (lastSnapshot) publish('snapshot', {results:lastSnapshot, count:lastSnapshot.length});
    }
  }
  window.addEventListener('message', onDashboardAck);
  attach();
  // The existing dashboard tab is preferred; try opening it immediately if no opener exists.
  // A timed popup is more likely to be blocked by the browser.
  if (!window.opener) openBoard();
  publish('hello');
  const boardTimer = setTimeout(() => {
    if (!running || openerAcknowledged) return;
    openBoard();
    publish('hello');
    publish('heartbeat', {connections: watched.size, receivedFrames: frames, decodedSnapshots: accepted, skippedFrames: malformed});
  }, 1000);
  const timer = setInterval(() => {
    attach();
    if (!openerAcknowledged) publish('hello');
    publish('heartbeat', {connections: watched.size, receivedFrames: frames, decodedSnapshots: accepted, skippedFrames: malformed});
  }, 5000);
  window.__CHOICE_D51_BRIDGE_V34__ = {
    stop() {
      running = false;
      clearInterval(timer);
      clearTimeout(boardTimer);
      window.removeEventListener('message', onDashboardAck);
      for (const [socket, row] of watched) {
        try { socket.removeEventListener('message', row.listener); } catch (_) {}
      }
      watched.clear();
      console.log('[Choice D51] 本地桥接已停止。');
    },
    status() { return {listeningSockets: watched.size, receivedFrames: frames, decodedSnapshots: accepted, skippedFrames: malformed, dashboardAcknowledged:openerAcknowledged, dashboardWindowOpened:!!(board && !board.closed), openerAvailable:!!window.opener}; }
  };
  publish('heartbeat', {connections: watched.size, receivedFrames: frames, decodedSnapshots: accepted, skippedFrames: malformed});
  console.log('[Choice D51] V34 桥接运行中。请保持游戏页面和网站页面打开，等待下一局开奖记录。');
  if (!window.opener && (!board || board.closed)) console.warn('[Choice D51] 无法打开网站窗口。请允许弹窗，或从网站的「打开 Choice 官方页」进入 D51 后再次执行。');
})();
