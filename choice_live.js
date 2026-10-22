/* V32 Choice D51: Render-only, signed official launch collector.
 * No DevTools / local bridge, login tokens, betting commands or third-party
 * browser scripting. All data is fetched from the user's existing Render API.
 * Source timestamps distinguish historical snapshots from observed new rounds.
 */
(function (root) {
  'use strict';
  const API = 'https://test-4bvi.onrender.com';
  const ROOM = 'D51';
  const POLL_MS = 12000;
  const FRESH_CHANGE_MS = 15 * 60 * 1000;
  const NAMES = Object.freeze({B:'庄', P:'闲', T:'和'});
  const STAGES = Object.freeze({
    not_started:'服务器尚未启动 D51 采集器',
    starting:'正在启动自动连接',
    requesting_authorized_choice_launch:'正在使用已有登录状态取得 Choice 官方入口',
    starting_official_choice_client:'正在打开官方 Choice 游戏客户端',
    choice_client_loaded:'Choice 页面已打开，正在等待 D51 数据',
    choice_websocket_open:'已观察到 Choice WebSocket，等待 D51 开奖快照',
    d51_snapshot_received:'已取得并验证 D51 开奖快照',
    retry_wait:'连接暂不可用，服务器将按冷却时间重试',
    provider_authentication_failed:'MZPlay 当前授权不允许启动 Choice',
    provider_access_blocked:'游戏提供方拦截了服务器访问',
    authorized_launch_throttled_or_network_error:'官方入口限频或网络异常，等待重试',
    authorized_launch_failed:'未能取得官方 Choice 入口',
    invalid_authorized_launch_url:'官方返回的 Choice 入口不符合预期',
    choice_navigation_failed:'无法打开 Choice 官方入口',
    choice_websocket_not_seen:'打开 Choice 后尚未发现游戏连接',
    d51_result_not_seen:'游戏连接存在，但尚未收到 D51 明文开奖数据',
    choice_websocket_stalled:'Choice 连接停止接收消息，正在重连',
    browser_runtime_failed:'Render 浏览器组件运行异常',
    playwright_unavailable:'Render 缺少浏览器组件',
    stopped:'Choice 自动连接已关闭',
    invalid_status:'无法读取服务器的 D51 状态'
  });

  function resultCode(value) {
    if (typeof value !== 'string') return null;
    const name = value.trim().toLowerCase();
    if (['b','banker','庄'].includes(name)) return 'B';
    if (['p','player','闲'].includes(name)) return 'P';
    if (['t','tie','和'].includes(name)) return 'T';
    return null;
  }
  function normalizeRoom(room) {
    if (!Array.isArray(room)) return [];
    return room.slice(0, 300).flatMap(item => {
      const code = resultCode(typeof item === 'string' ? item : item?.result);
      if (!code) return [];
      const issue = typeof item === 'object' && item !== null
        ? String(item.game ?? item.round ?? '').slice(0, 40) : '';
      return [{code, issue}];
    });
  }
  function signature(rows) {
    if (!Array.isArray(rows) || !rows.length) return '';
    return rows.slice(0, 25).map(r => `${r.issue}:${r.code}`).join('|') + ':' + rows.length;
  }
  const api = Object.freeze({ROOM, resultCode, normalizeRoom, signature});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  const el = id => document.getElementById(id);
  let busy = false;
  let rows = [];
  let collector = null;
  let choiceState = null;
  let networkError = '';
  let firstSignature = null;
  let observedChangeAt = 0;
  const txt = (id, value) => {const node = el(id); if (node) node.textContent = String(value);};
  function setStatus(message, type) {
    const node = el('choice-room-status'); if (!node) return;
    node.textContent = message;
    node.className = 'data-status is-' + type;
  }
  function renderHistory(codes) {
    const node = el('choice-room-history'); if (!node) return;
    const fragment = document.createDocumentFragment();
    if (!codes.length) {
      const blank = document.createElement('span');
      blank.className = 'choice-room-empty'; blank.textContent = '尚无 D51 开奖记录';
      fragment.appendChild(blank);
    }
    for (const code of codes.slice(-60)) {
      const mark = document.createElement('span');
      mark.className = 'choice-room-chip is-' + code;
      mark.textContent = NAMES[code]; fragment.appendChild(mark);
    }
    node.replaceChildren(fragment);
    node.scrollLeft = node.scrollWidth;
  }
  function renderRoad(id, cells) {
    const node = el(id); if (!node) return;
    const fragment = document.createDocumentFragment();
    const maxColumn = Math.max(0, ...cells.map(cell => cell.col));
    const first = Math.max(0, maxColumn - 35);
    node.style.gridTemplateColumns = `repeat(${Math.max(10, maxColumn - first + 1)}, 24px)`;
    for (const cell of cells) {
      if (cell.col < first) continue;
      const mark = document.createElement('span');
      mark.className = 'bc-road-mark bc-road-' + cell.code;
      mark.style.gridColumn = String(cell.col - first + 1);
      mark.style.gridRow = String(cell.row + 1);
      mark.textContent = NAMES[cell.code] || '•';
      if (cell.ties) {
        const small = document.createElement('small'); small.textContent = String(cell.ties); mark.appendChild(small);
      }
      fragment.appendChild(mark);
    }
    node.replaceChildren(fragment);
    if (node.parentElement) node.parentElement.scrollLeft = node.parentElement.scrollWidth;
  }
  function paint() {
    const chronology = rows.map(r => r.code).reverse();
    const latest = rows[0];
    txt('choice-room-latest', latest ? NAMES[latest.code] : '—');
    txt('choice-room-issue', latest?.issue || '—');
    txt('choice-room-count', rows.length);
    renderHistory(chronology);
    const road = root.BaccaratRoads?.build(chronology) || {big:[], bead:[]};
    renderRoad('choice-room-big-road', road.big);
    renderRoad('choice-room-bead-road', road.bead);

    const lastNewAt = Number(collector?.lastNewResultAt || 0) * 1000;
    const lastSnapshotAt = Number(collector?.lastSnapshotAt || 0) * 1000;
    // V32 is authoritative on whether D51 appended an actual new result.
    // The dashboard seeing a replacement snapshot is not sufficient proof.
    const observedNew = lastNewAt > 0 && Date.now() - lastNewAt < FRESH_CHANGE_MS;
    const latestSnapshotFresh = lastSnapshotAt > 0 && Date.now() - lastSnapshotAt < FRESH_CHANGE_MS;
    const stage = String(choiceState?.stage || 'not_started');
    const errorStage = String(choiceState?.lastError || stage);
    const reason = STAGES[stage] || 'Choice 状态等待确认';
    const lastError = STAGES[errorStage] || '';
    txt('choice-room-bridge-detail', 'Render 自动采集：' + reason + (lastError && errorStage !== stage ? ' · 上次错误：' + lastError : ''));
    txt('choice-room-source', collector?.mode === 'server_official_choice_client_read_only'
      ? 'Render 官方 Choice D51 游戏客户端' : rows.length ? '其他历史来源（未验证实时）' : '等待 Render');

    if (collector?.mode === 'server_official_choice_client_read_only' && latestSnapshotFresh && observedNew && rows.length) {
      setStatus('D51 已观察到新的开奖结果；Render 持续检查。', 'live');
    } else if (rows.length) {
      setStatus('已读取 D51 历史，但尚未证明新一局持续更新。' + (lastError ? ' ' + lastError : ''), 'stale');
    } else {
      setStatus(networkError || lastError || reason, 'offline');
    }

    if (rows.length && observedNew && collector?.mode === 'server_official_choice_client_read_only') {
      const forecast = root.BaccaratPredictor?.makeForecast(chronology);
      txt('choice-room-forecast', NAMES[forecast?.pick] || '观察');
      txt('choice-room-reason', forecast?.reason || '此统计分析不保证预测下一局。');
      const node = el('choice-room-forecast'); if (node) node.className = forecast?.pick ? `is-${forecast.pick}` : '';
    } else {
      txt('choice-room-forecast', '观察');
      txt('choice-room-reason', '只有验证新的 D51 开奖更新后，才显示历史统计参考；不保证下一局。');
      el('choice-room-forecast')?.removeAttribute('class');
    }
  }
  async function refreshChoiceRoom() {
    if (busy) return;
    busy = true;
    const btn = el('choice-room-refresh'); if (btn) btn.disabled = true;
    try {
      const [dataResponse, statusResponse] = await Promise.all([
        fetch(API + '/api/data?_=' + Date.now(), {cache:'no-store', mode:'cors'}),
        fetch(API + '/api/choice-status?_=' + Date.now(), {cache:'no-store', mode:'cors'}),
      ]);
      if (!dataResponse.ok) throw new Error('HTTP ' + dataResponse.status);
      const data = await dataResponse.json();
      choiceState = statusResponse.ok ? await statusResponse.json() : {stage:'invalid_status'};
      const next = normalizeRoom(data?.baccarat?.rooms?.[ROOM]);
      const nextSignature = signature(next);
      if (firstSignature && nextSignature && nextSignature !== firstSignature) {
        observedChangeAt = Date.now();
      }
      firstSignature = nextSignature;
      rows = next;
      collector = data?.baccarat?.choiceAuto || null;
      networkError = '';
    } catch (error) {
      networkError = 'Render 查询失败（' + String(error?.message || '网络错误').slice(0, 50) + '），等待重试';
    } finally {
      busy = false;
      if (btn) btn.disabled = false;
      paint();
    }
  }
  root.refreshChoiceRoom = refreshChoiceRoom;
  root.ChoiceD51V32 = api;
  const start = () => {
    if (!el('choice-section')) return;
    paint();
    refreshChoiceRoom();
    setInterval(refreshChoiceRoom, POLL_MS);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})(typeof window === 'undefined' ? globalThis : window);
