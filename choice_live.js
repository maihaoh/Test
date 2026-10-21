/* V30 single-room Choice scoreboard, READ ONLY.
 * This frontend only displays authenticated results already returned by Render.
 * It neither requests a user's token nor opens a gambling session or places bets.
 * A successful fetch of historical data is NOT proof of a live feed.
 */
(function (root) {
    'use strict';
    const ENDPOINT = 'https://test-4bvi.onrender.com/api/data';
    const ROOM = 'D51';
    const POLL_MS = 12000;
    const CHANGE_STALE_MS = 15 * 60 * 1000;
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
        // The collector's data.json format is most recent first.
        return room.slice(0, 300).flatMap(item => {
            const code = resultCode(typeof item === 'string' ? item : item?.result);
            if (!code) return [];
            const issue = typeof item === 'object' && item !== null ?
                String(item.game_id ?? item.game ?? item.round ?? item.game_no ?? '') : '';
            return [{code, issue: issue.slice(0, 100)}];
        });
    }
    function signature(room) {
        if (!Array.isArray(room) || room.length === 0) return '';
        // Include a sequence of outcomes in case upstream records lack game IDs.
        return room.slice(0, 12).map(row => `${row.issue}:${row.code}`).join('|') + ':' + room.length;
    }
    const api = Object.freeze({ROOM, resultCode, normalizeRoom, signature});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof document === 'undefined') return;

    const el = id => document.getElementById(id);
    let inFlight = false;
    let lastSignature = null;
    let observedChangeAt = 0;
    let haveHistory = false;

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
    function renderRoom(rows) {
        const chronological = rows.map(row => row.code).reverse();
        const latest = rows[0];
        txt('choice-room-latest', latest ? NAMES[latest.code] : '—');
        txt('choice-room-issue', latest?.issue || '未提供局号');
        txt('choice-room-count', String(rows.length));
        renderHistory(chronological);
        const roadmap = root.BaccaratRoads?.build(chronological) || {big: [], bead: []};
        renderRoad('choice-room-big-road', roadmap.big);
        renderRoad('choice-room-bead-road', roadmap.bead);
        const fresh = observedChangeAt > 0 && Date.now() - observedChangeAt <= CHANGE_STALE_MS;
        if (!fresh) {
            txt('choice-room-forecast', '观察');
            txt('choice-room-reason', '已有记录不代表实时。等待本页面观察到新局变化后再显示统计参考。');
            el('choice-room-forecast')?.removeAttribute('class');
            return;
        }
        const next = root.BaccaratPredictor?.makeForecast(chronological);
        const pick = next?.pick;
        txt('choice-room-forecast', NAMES[pick] || '观察');
        txt('choice-room-reason', next?.reason || '未找到可用的统计参考。');
        const forecast = el('choice-room-forecast');
        if (forecast) forecast.className = pick ? `is-${pick}` : '';
    }
    async function refreshChoiceRoom() {
        if (inFlight) return;
        inFlight = true;
        const button = el('choice-room-refresh');
        if (button) button.disabled = true;
        try {
            const response = await fetch(ENDPOINT + '?_=' + Date.now(), {
                method: 'GET', mode: 'cors', cache: 'no-store'
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const rows = normalizeRoom(data?.baccarat?.rooms?.[ROOM]);
            if (!rows.length) {
                haveHistory = false;
                setStatus('服务器可访问，但暂未取得 Choice D51 的真实开奖。请检查 Choice 数据源。', 'offline');
                renderRoom([]);
                return;
            }
            const current = signature(rows);
            if (lastSignature !== null && current !== lastSignature) observedChangeAt = Date.now();
            lastSignature = current;
            haveHistory = true;
            if (!observedChangeAt) {
                setStatus('已取得历史开奖，但尚未观察到新的 D51 结果；实时状态未验证。', 'stale');
            } else if (Date.now() - observedChangeAt > CHANGE_STALE_MS) {
                setStatus('历史读取正常，但最近 15 分钟没有观察到新局变化。', 'stale');
            } else {
                setStatus('本页面已观察到 D51 新局结果变化；继续自动检查。', 'live');
            }
            renderRoom(rows);
        } catch (err) {
            setStatus(`Choice 数据检查失败（${err?.message || '网络异常'}）；${haveHistory ? '先前历史并非当前实时状态。' : '尚未连接。'}`, 'offline');
            txt('choice-room-forecast', '观察');
            txt('choice-room-reason', '无法验证当前实时来源，已暂停下局统计参考。');
            const forecast = el('choice-room-forecast');
            if (forecast) forecast.className = '';
        } finally {
            inFlight = false;
            if (button) button.disabled = false;
        }
    }
    root.refreshChoiceRoom = refreshChoiceRoom;
    const start = () => { if (!el('choice-section')) return; refreshChoiceRoom(); setInterval(refreshChoiceRoom, POLL_MS); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
    else start();
})(typeof globalThis === 'object' ? globalThis : this);
