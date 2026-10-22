/* V34 single-room Choice D51 display.
 * Reads either verified Render snapshots or B/P/T-only snapshots from the
 * user's own authorized official Choice tab. No credentials are transmitted.
 * An initial history is NOT proof that new rounds will continue arriving.
 */
(function (root) {
    'use strict';
    const ENDPOINT = 'https://test-4bvi.onrender.com/api/data';
    const ROOM = 'D51';
    const POLL_MS = 12000;
    const CHANGE_STALE_MS = 15 * 60 * 1000;
    const BRIDGE_HEARTBEAT_STALE_MS = 30000;
    const BRIDGE_ORIGIN = 'https://gci.arvideo.video';
    const BRIDGE_TAG = 'choice-d51-browser-bridge-v34';
    const HISTORY_STORAGE_KEY = 'choice_d51_v34_history';
    const NAMES = Object.freeze({B: '庄', P: '闲', T: '和'});

    function resultCode(value) {
        if (typeof value !== 'string') return null;
        const name = value.trim().toLowerCase();
        if (name === 'b' || name === 'banker' || name === '庄') return 'B';
        if (name === 'p' || name === 'player' || name === '闲') return 'P';
        if (name === 't' || name === 'tie' || name === '和') return 'T';
        return null;
    }
    function normalizeRoom(room) {
        if (!Array.isArray(room)) return [];
        return room.slice(0, 300).flatMap(item => {
            const code = resultCode(typeof item === 'string' ? item : item?.result);
            if (!code) return [];
            const issue = typeof item === 'object' && item !== null ?
                String(item.game_id ?? item.game ?? item.round ?? item.game_no ?? '') : '';
            return [{code, issue: issue.slice(0, 100)}];
        });
    }
    function signature(room) {
        if (!Array.isArray(room) || !room.length) return '';
        return room.slice(0, 25).map(row => `${row.issue}:${row.code}`).join('|') + ':' + room.length;
    }
    function validateBridgeCodes(value) {
        return Array.isArray(value) && value.length > 0 && value.length <= 300 &&
            value.every(x => x === 'B' || x === 'P' || x === 'T');
    }
    // Browser bridge returns chronological results; dashboard stores newest first.
    function bridgeRows(value) {
        return validateBridgeCodes(value) ? value.slice().reverse().map(code => ({code, issue: ''})) : [];
    }
    const api = Object.freeze({ROOM, resultCode, normalizeRoom, signature, validateBridgeCodes, bridgeRows});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof document === 'undefined') return;

    const el = id => document.getElementById(id);
    let inFlight = false;
    let renderLastSignature = null;
    let renderObservedChangeAt = 0;
    let renderRows = [];
    let renderError = '尚未连接 Render Choice 数据';
    let bridgeLastPingAt = 0;
    let bridgeLastSnapshotAt = 0;
    let bridgeLastSignature = null;
    let bridgeObservedChangeAt = 0;
    let bridgeRowsLatest = [];
    let bridgeConnections = 0;
    let bridgeFrames = 0;
    let bridgeDecoded = 0;

    function txt(id, val) { const node = el(id); if (node) node.textContent = String(val); }
    function setStatus(message, type) {
        const node = el('choice-room-status');
        if (!node) return;
        node.textContent = message;
        node.className = 'data-status is-' + type;
    }
    function renderHistory(codes) {
        const node = el('choice-room-history'); if (!node) return;
        const fragment = document.createDocumentFragment();
        if (!codes.length) {
            const empty = document.createElement('span');
            empty.className = 'choice-room-empty'; empty.textContent = '尚无 D51 开奖记录';
            fragment.appendChild(empty);
        }
        for (const code of codes.slice(-60)) {
            const mark = document.createElement('span');
            mark.className = 'choice-room-chip is-' + code;
            mark.textContent = NAMES[code];
            fragment.appendChild(mark);
        }
        node.replaceChildren(fragment);
        node.scrollLeft = node.scrollWidth;
    }
    function renderRoad(id, cells) {
        const node = el(id); if (!node) return;
        const fragment = document.createDocumentFragment();
        const maxCol = Math.max(0, ...cells.map(x => x.col));
        const first = Math.max(0, maxCol - 35);
        node.style.gridTemplateColumns = `repeat(${Math.max(10, maxCol - first + 1)}, 24px)`;
        for (const cell of cells) {
            if (cell.col < first) continue;
            const mark = document.createElement('span');
            mark.className = 'bc-road-mark bc-road-' + cell.code;
            mark.style.gridColumn = String(cell.col - first + 1);
            mark.style.gridRow = String(cell.row + 1);
            mark.textContent = NAMES[cell.code] || '•';
            if (cell.ties) {
                const label = document.createElement('small');
                label.textContent = String(cell.ties);
                mark.appendChild(label);
            }
            fragment.appendChild(mark);
        }
        node.replaceChildren(fragment);
        if (node.parentElement) node.parentElement.scrollLeft = node.parentElement.scrollWidth;
    }
    function renderRoom(rows, changedAt) {
        const chronological = rows.map(row => row.code).reverse();
        const latest = rows[0];
        txt('choice-room-latest', latest ? NAMES[latest.code] : '—');
        txt('choice-room-issue', latest?.issue || '来源未提供局号');
        txt('choice-room-count', String(rows.length));
        renderHistory(chronological);
        const roadmap = root.BaccaratRoads?.build(chronological) || {big: [], bead: []};
        renderRoad('choice-room-big-road', roadmap.big);
        renderRoad('choice-room-bead-road', roadmap.bead);
        const fresh = changedAt > 0 && Date.now() - changedAt <= CHANGE_STALE_MS;
        if (!fresh) {
            txt('choice-room-forecast', '观察');
            txt('choice-room-reason', '已有历史不代表实时更新。等待本页面观察到 D51 新结果后再显示统计参考。');
            el('choice-room-forecast')?.removeAttribute('class');
            return;
        }
        const next = root.BaccaratPredictor?.makeForecast(chronological);
        txt('choice-room-forecast', NAMES[next?.pick] || '观察');
        txt('choice-room-reason', next?.reason || '暂无可验证的统计参考。');
        const forecast = el('choice-room-forecast');
        if (forecast) forecast.className = next?.pick ? `is-${next.pick}` : '';
    }
    function paint() {
        const now = Date.now();
        const bridgeActive = bridgeLastPingAt > 0 && now - bridgeLastPingAt < BRIDGE_HEARTBEAT_STALE_MS;
        txt('choice-room-bridge-detail', bridgeActive ?
            `本机游戏连接 ${bridgeConnections} 条 · 收到帧 ${bridgeFrames} · 解析快照 ${bridgeDecoded} 份` :
            bridgeLastSnapshotAt ? '本机桥接已暂停；以下可能是之前的历史记录' : '未启动本机 D51 桥接');

        if (bridgeActive && bridgeRowsLatest.length) {
            renderRoom(bridgeRowsLatest, bridgeObservedChangeAt);
            const hasNew = bridgeObservedChangeAt > 0 && now - bridgeObservedChangeAt <= CHANGE_STALE_MS;
            setStatus(hasNew ? '本机 D51 WebSocket 已观察到新开奖结果；浏览器保持打开以继续更新。' :
                '本机已解析 D51 历史，尚未观察到本次连接中的下一局开奖。', hasNew ? 'live' : 'stale');
            txt('choice-room-source', '本机 D51 WebSocket（当前浏览器）');
            return;
        }
        if (renderRows.length) {
            renderRoom(renderRows, renderObservedChangeAt);
            const hasNew = renderObservedChangeAt > 0 && now - renderObservedChangeAt <= CHANGE_STALE_MS;
            setStatus(hasNew ? '已观察到 Render 上的 D51 新结果；继续检查。' :
                'Render 有 D51 历史，但尚未观察到新的开奖结果。', hasNew ? 'live' : 'stale');
            txt('choice-room-source', 'Render Choice 历史来源');
            return;
        }
        if (bridgeRowsLatest.length) {
            renderRoom(bridgeRowsLatest, 0);
            setStatus('本机 D51 结果已暂停同步；以下仅为上次历史，非实时。', 'stale');
            txt('choice-room-source', '本地缓存（未连接）');
            return;
        }
        renderRoom([], 0);
        setStatus(renderError || '等待 D51 的真实开奖记录。', 'offline');
        txt('choice-room-source', '等待数据源');
    }
    function displayLastSaved(time) {
        const elSaved = el('choice-room-last-saved');
        if (!elSaved) return;
        elSaved.textContent = time > 0 ? `已自动保存在本机浏览器：${new Date(time).toLocaleString()}` : '尚未保存有效 D51 开奖历史';
    }
    function exportChoiceLocalHistory() {
        try {
            const value = localStorage.getItem(HISTORY_STORAGE_KEY);
            const payload = value ? JSON.parse(value) : null;
            if (!payload || !validateBridgeCodes(payload.codes)) throw new Error('尚无有效的本地历史');
            const blob = new Blob([JSON.stringify({room:ROOM, source:'D51 browser-local capture', ...payload},null,2)], {type:'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `choice-D51-${new Date().toISOString().slice(0,10)}.json`;
            document.body.appendChild(a);
            a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) {
            const note = el('choice-room-copy-status');
            if (note) note.textContent = `导出失败：${String(err?.message || '未知错误')}`;
        }
    }
    function onBridgeMessage(event) {
        if (event.origin !== BRIDGE_ORIGIN) return;
        const msg = event.data;
        if (!msg || typeof msg !== 'object' || msg.tag !== BRIDGE_TAG || msg.room !== ROOM) return;
        if (msg.type === 'hello') {
            try { event.source?.postMessage({tag: BRIDGE_TAG, type: 'ack', room: ROOM}, BRIDGE_ORIGIN); } catch (_) {}
            return;
        }
        if (msg.type === 'heartbeat') {
            bridgeLastPingAt = Date.now();
            bridgeConnections = Number.isSafeInteger(msg.connections) ? Math.max(0, Math.min(msg.connections, 20)) : 0;
            bridgeFrames = Number.isSafeInteger(msg.receivedFrames) ? Math.max(0, msg.receivedFrames) : 0;
            bridgeDecoded = Number.isSafeInteger(msg.decodedSnapshots) ? Math.max(0, msg.decodedSnapshots) : 0;
            paint();
            return;
        }
        if (msg.type !== 'snapshot' || !validateBridgeCodes(msg.results)) return;
        const rows = bridgeRows(msg.results);
        const sig = signature(rows);
        if (bridgeLastSignature !== null && sig !== bridgeLastSignature) bridgeObservedChangeAt = Date.now();
        bridgeLastSignature = sig;
        bridgeLastPingAt = Date.now();
        bridgeLastSnapshotAt = Date.now();
        bridgeRowsLatest = rows;
        try {
            const savedAt = Date.now();
            localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({codes: msg.results, savedAt}));
            displayLastSaved(savedAt);
        } catch (_) {
            const note = el('choice-room-copy-status');
            if (note) note.textContent = '浏览器阻止了本地保存，请检查网站储存权限。';
        }
        paint();
    }
    root.addEventListener('message', onBridgeMessage);

    async function copyChoiceBridgeCode() {
        const notice = el('choice-room-copy-status');
        try {
            const reply = await fetch('choice_console_bridge.js?v=34', {cache: 'no-store'});
            if (!reply.ok) throw new Error(`HTTP ${reply.status}`);
            const raw = await reply.text();
            const script = raw
                .replaceAll('__V34_DASHBOARD_URL__', JSON.stringify(location.href.split('#')[0].split('?')[0]).slice(1, -1))
                .replaceAll('__V34_DASHBOARD_ORIGIN__', location.origin);
            if (script.includes('__V34_')) throw new Error('配置未完成');
            await navigator.clipboard.writeText(script);
            if (notice) notice.textContent = '已复制！切换到 Choice D51 → F12 → Console → Ctrl+V → Enter。';
        } catch (err) {
            if (notice) notice.textContent = `无法自动复制（${err?.message || '浏览器限制'}），请在 HTTPS 网站操作。`;
        }
    }
    function openChoiceOfficial() {
        // This is the game *entry*, not a guaranteed deep-link to a D51 room.
        // The user must log in by the official flow and select D51 themselves.
        root.open('https://gci.arvideo.video/pc/pcv1/index.jsp?', '_blank');
    }

    async function refreshChoiceRoom() {
        if (inFlight) return;
        inFlight = true;
        const button = el('choice-room-refresh');
        if (button) button.disabled = true;
        try {
            const response = await fetch(ENDPOINT + '?_=' + Date.now(), {method: 'GET', mode: 'cors', cache: 'no-store'});
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const rows = normalizeRoom(data?.baccarat?.rooms?.[ROOM]);
            if (rows.length) {
                const sig = signature(rows);
                if (renderLastSignature !== null && sig !== renderLastSignature) renderObservedChangeAt = Date.now();
                renderLastSignature = sig;
                renderRows = rows;
                renderError = '';
            } else renderError = '服务器可访问，但暂未取得 D51 开奖记录；可用本机浏览器桥接。';
        } catch (err) {
            renderError = `Choice 服务器检查失败（${err?.message || '网络错误'}）；可以使用本机浏览器桥接。`;
        } finally {
            inFlight = false;
            if (button) button.disabled = false;
            paint();
        }
    }
    root.refreshChoiceRoom = refreshChoiceRoom;
    root.copyChoiceBridgeCode = copyChoiceBridgeCode;
    root.openChoiceOfficial = openChoiceOfficial;
    root.exportChoiceLocalHistory = exportChoiceLocalHistory;
    root.ChoiceD51V34 = api;
    const start = () => {
        if (!el('choice-section')) return;
        try {
            const cached = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || 'null');
            if (cached && validateBridgeCodes(cached.codes)) {
                bridgeRowsLatest = bridgeRows(cached.codes);
                bridgeLastSnapshotAt = Number(cached.savedAt) || 0;
                bridgeLastSignature = signature(bridgeRowsLatest);
                displayLastSaved(bridgeLastSnapshotAt);
            }
        } catch (_) {}
        paint();
        refreshChoiceRoom();
        setInterval(refreshChoiceRoom, POLL_MS);
        setInterval(paint, 5000);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
    else start();
})(typeof globalThis === 'object' ? globalThis : this);
