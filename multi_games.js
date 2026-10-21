/* K3 / 5D / TRX official-results dashboard (UI v25).
 * Browser GETs the application's public read-only Render API; it never receives
 * MZPlay credentials and never sends gambling actions.
 * Stale results never masquerade as live predictions.
 */
(() => {
    'use strict';

    const ENDPOINT = 'https://test-4bvi.onrender.com/api/data';
    const GAMES = ['k3', '5d', 'trx'];
    const REFRESH_MS = 12000;
    const LIVE_MAX_AGE = 180;
    let busy = false;
    let previous = null;
    let previousSource = 'offline';

    function el(id) { return document.getElementById(id); }
    function write(id, value) {
        const node = el(id);
        if (node) node.textContent = String(value == null ? '--' : value);
    }
    function html(id, value) {
        const node = el(id);
        if (node) node.innerHTML = String(value == null ? '' : value);
    }
    function dateMYT(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) return '未知';
        return new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        }).format(new Date(seconds * 1000));
    }
    function stamp(value) {
        const num = Number(value);
        return Number.isFinite(num) && num > 0 ? num : 0;
    }
    function issueDateIsRecent(draw) {
        const issue = String(draw?.issueNumber || '');
        const matched = /^(20\d{2})(\d{2})(\d{2})/.exec(issue);
        if (!matched) return true;
        const year = Number(matched[1]), month = Number(matched[2]), day = Number(matched[3]);
        const ms = Date.UTC(year, month - 1, day);
        const date = new Date(ms);
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
        const diff = Date.now() - ms;
        return diff >= -24 * 3600 * 1000 && diff < 36 * 3600 * 1000;
    }
    function secondsOld(updated) {
        const ts = stamp(updated);
        if (!ts) return Infinity;
        const delta = Date.now() / 1000 - ts;
        return delta < -60 ? Infinity : Math.max(0, Math.floor(delta));
    }
    function append(parent, tag, cls, content) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        node.textContent = String(content == null ? '--' : content).slice(0, 220);
        parent.appendChild(node);
        return node;
    }
    function empty(target, message) {
        if (!target) return;
        target.replaceChildren();
        append(target, 'div', 'multi-empty', message);
    }
    function esc(value) {
        return String(value == null ? '--' : value).replace(/[&<>"']/g, c => ({
            '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
        })[c]);
    }
    function chip(text, kind = 'neutral', tone = '') {
        return `<span class="compact-chip is-${kind}${tone ? ` tone-${tone}` : ''}">${esc(text)}</span>`;
    }
    function colourTone(value) {
        const v = String(value || '').toLowerCase();
        if (v.includes('purple') || v.includes('violet') || v.includes('紫')) return 'violet';
        if (v.includes('green') || v.includes('绿')) return 'green';
        if (v.includes('red') || v.includes('红')) return 'red';
        return 'neutral';
    }
    function line(label, chips) {
        return `<div class="compact-line">${label ? `<span class="compact-line-label">${label}</span>` : ''}${chips.join('')}</div>`;
    }
    function k3Obj(source) {
        if (!source) return null;
        const dice = Array.isArray(source.dice) ? source.dice.slice(0, 3) : [];
        return {
            headline: dice.length ? dice.join(' ') : '--',
            chips: [
                chip(dice.length ? dice.join('-') : '--', 'number'),
                chip(`和值 ${source.sum ?? source.sumRange ?? '--'}`, 'metric'),
                chip(source.size || '--', source.size === '大' ? 'size-big' : source.size === '小' ? 'size-small' : 'status'),
                chip(source.oddEven || '--', 'metric')
            ]
        };
    }
    function fiveDObj(source) {
        if (!source) return null;
        const digits = Array.isArray(source.digits) ? source.digits.slice(0, 5) : [];
        return {
            headline: digits.length ? digits.join('') : '--',
            chips: [
                chip(digits.length ? digits.join('') : '--', 'number'),
                chip(`和值 ${source.sum ?? '--'}`, 'metric')
            ]
        };
    }
    function trxObj(source) {
        if (!source) return null;
        return {
            headline: source.number === undefined ? '--' : String(source.number),
            chips: [
                chip(source.number ?? '--', 'number'),
                chip(source.size || '--', source.size === '大' ? 'size-big' : source.size === '小' ? 'size-small' : 'status'),
                chip(source.colour || '--', 'colour', colourTone(source.colour))
            ]
        };
    }
    function modelFor(game, source) {
        if (game === 'k3') return k3Obj(source);
        if (game === '5d') return fiveDObj(source);
        return trxObj(source);
    }
    function resultLine(game, source, label) {
        const model = modelFor(game, source);
        if (!model) return line(label, [chip('等待', 'status')]);
        return line(label, model.chips);
    }
    function predictionInfo(game, pred) {
        if (game === 'k3') {
            const dice = Array.isArray(pred.dice) && pred.dice.length === 3 ? pred.dice : [];
            return {
                headline: dice.length ? dice.join('-') : '--',
                sub: `${pred.size || '--'} / ${pred.oddEven || '--'} / 和值范围 ${pred.sumRange || '--'}`,
                cells: dice.map((value, i) => ({name: `骰子 ${i + 1}`, value, meta: '历史模型候选值'}))
                    .concat([{name: '和值范围', value: pred.sumRange || '--', meta: `${pred.size || '--'} · ${pred.oddEven || '--'}`}])
            };
        }
        if (game === '5d') {
            const digits = Array.isArray(pred.digits) && pred.digits.length === 5 ? pred.digits : [];
            return {
                headline: digits.length ? digits.join('') : '--',
                sub: 'A/B/C/D/E 五位候选值',
                cells: digits.map((value, i) => ({
                    name: ['A', 'B', 'C', 'D', 'E'][i], value,
                    meta: `${(pred.sizeByPosition || [])[i] || '--'} · ${(pred.oddEvenByPosition || [])[i] || '--'}`
                }))
            };
        }
        return {
            headline: Number.isInteger(Number(pred.number)) && pred.number !== undefined ? String(pred.number) : '--',
            sub: `${pred.size || '--'} / ${pred.colour || '--'}`,
            cells: [
                {name: '候选号码', value: pred.number ?? '--', meta: '0–9'},
                {name: '大小', value: pred.size || '--', meta: '历史模型参考'},
                {name: '颜色', value: pred.colour || '--', meta: '历史模型参考'}
            ]
        };
    }
    function drawDetails(game, draw) {
        if (game === 'k3') return `和值 ${draw.sum ?? '--'} / ${draw.size || '--'} / ${draw.oddEven || '--'}`;
        if (game === '5d') return `和值 ${draw.sum ?? '--'}`;
        return `${draw.size || '--'} / ${draw.colour || '--'}`;
    }
    function parseReview(game, text) {
        const raw = String(text || '').trim();
        if (!raw) return null;
        const parts = raw.split('/').map(v => v.trim()).filter(Boolean);
        if (game === 'k3') {
            return {
                dice: (parts[0] || '').split('').map(v => Number(v)).filter(Number.isFinite).slice(0, 3),
                size: parts[1] || '--',
                oddEven: parts[2] || '--',
                sumRange: parts[3] || '--'
            };
        }
        if (game === '5d') {
            return {
                digits: (parts[0] || '').split('').map(v => Number(v)).filter(Number.isFinite).slice(0, 5),
                sum: '--'
            };
        }
        return {
            number: /^\d$/.test(parts[0] || '') ? Number(parts[0]) : '--',
            size: parts[1] || '--',
            colour: parts[2] || '--'
        };
    }
    function renderHistory(game, state) {
        const target = el(game + '-history');
        if (!target) return;
        const draws = Array.isArray(state.draws) ? state.draws : [];
        const reviews = Array.isArray(state.reviews) ? state.reviews : [];
        if (!draws.length) return empty(target, '暂无开奖记录。');
        const reviewMap = new Map(reviews.map(item => [String(item.issueNumber || ''), item]));
        const block = document.createDocumentFragment();
        for (const draw of draws.slice(0, 10)) {
            const issue = String(draw.issueNumber || '--');
            const wrapper = document.createElement('div');
            wrapper.className = 'compact-history-card';
            wrapper.innerHTML = `
                <div class="compact-history-head">
                    <strong>${esc(issue)}</strong>
                    <span>${esc(drawDetails(game, draw))}</span>
                </div>
                ${resultLine(game, draw, '开奖')}
            `;
            const review = reviewMap.get(issue);
            if (review) {
                const parsed = parseReview(game, review.prediction);
                const predictionRow = document.createElement('div');
                predictionRow.innerHTML = resultLine(game, parsed, '预测');
                wrapper.appendChild(predictionRow.firstElementChild);
                const foot = document.createElement('div');
                foot.className = 'compact-history-foot';
                foot.textContent = String(review.score || '--');
                wrapper.appendChild(foot);
            } else {
                const predictionRow = document.createElement('div');
                predictionRow.innerHTML = line('预测', [chip('等待复盘', 'status')]);
                wrapper.appendChild(predictionRow.firstElementChild);
            }
            block.appendChild(wrapper);
        }
        target.replaceChildren(block);
    }
    function renderReview(game, state) {
        const target = el(game + '-review');
        if (!target) return;
        const items = Array.isArray(state.reviews) ? state.reviews : [];
        if (!items.length) return empty(target, '等待有期号匹配的历史复盘。');
        const fragment = document.createDocumentFragment();
        for (const item of items.slice(0, 8)) {
            const node = document.createElement('div');
            node.className = 'compact-review-card';
            const verdict = /WIN/.test(String(item.score || '')) ? 'WIN' : /LOSS/.test(String(item.score || '')) ? 'LOSS' : '记录';
            node.innerHTML = `
                <div class="compact-history-head">
                    <strong>${esc(item.issueNumber || '--')}</strong>
                    <span>${verdict}</span>
                </div>
                <div class="compact-history-foot">预测：${esc(item.prediction || '--')}</div>
                <div class="compact-history-foot">实际：${esc(item.actual || '--')}</div>
                <div class="compact-history-foot">${esc(item.score || '--')}</div>
            `;
            fragment.appendChild(node);
        }
        target.replaceChildren(fragment);
    }
    function renderGame(game, data, source, networkNote = '') {
        const state = data?.[game] && typeof data[game] === 'object' ? data[game] : {};
        const draws = Array.isArray(state.draws) ? state.draws : [];
        const latest = draws[0] || null;
        const successAt = stamp(state.last_success_at || state.updated_at);
        const drawAt = stamp(state.last_new_draw_at !== undefined ? state.last_new_draw_at : successAt);
        const age = secondsOld(drawAt);
        const hasFailure = /失败|限频|不可用|没有新的|错误|没有可用/.test(String(state.status || ''));
        const fresh = source === 'render' && !!latest && age <= LIVE_MAX_AGE && issueDateIsRecent(latest) && !hasFailure;
        const status = el(game + '-data-status');
        let health;
        if (fresh) health = `● 数据更新正常 | 新开奖 ${dateMYT(drawAt)} (MYT) | ${age} 秒前`;
        else if (draws.length) health = `⚠ 历史数据 / 未验证实时连接 | 最近读取 ${dateMYT(successAt)} (MYT) | ${source === 'file' ? '本地备份' : 'Render API'}`;
        else health = '● 尚未取得有效开奖记录 | 未连接';
        const diagnosis = String(state.status || '').slice(0, 160);
        const diagnosisLabel = fresh ? '后台' : draws.length ? '历史备注（不代表已连接）' : '后台';
        if (status) {
            status.textContent = `${health}${networkNote ? ' | ' + networkNote : ''}${diagnosis ? ' | ' + diagnosisLabel + '：' + diagnosis : ''}`;
            status.classList.toggle('is-live', fresh);
            status.classList.toggle('is-stale', !!draws.length && !fresh);
            status.classList.toggle('is-offline', !draws.length);
            status.dataset.live = String(fresh);
            status.dataset.source = source;
        }
        if (!latest) {
            for (const part of ['latest-meta', 'confidence', 'target']) write(game + '-' + part, '--');
            html(game + '-latest', line('开奖', [chip('等待数据', 'status')]));
            html(game + '-prediction', line('预测', [chip('等待数据', 'status')]));
            empty(el(game + '-prediction-grid'), '未取得有效数据，暂不提供预测。');
            empty(el(game + '-history'), '暂无开奖记录。');
            empty(el(game + '-review'), '暂无可用复盘。');
            return;
        }

        html(game + '-latest', resultLine(game, latest, '开奖'));
        write(game + '-latest-meta', `第 ${latest.issueNumber || '--'} 期 | ${drawDetails(game, latest)} | 共 ${draws.length} 条`);
        const pred = state.prediction && typeof state.prediction === 'object' ? state.prediction : {};
        const issue = String(state.current_issue?.issueNumber || '');
        const validTarget = !!issue && String(pred.issueNumber || '') === issue;
        const hasPred = game === 'k3' ? Array.isArray(pred.dice) && pred.dice.length === 3
            : game === '5d' ? Array.isArray(pred.digits) && pred.digits.length === 5
                : pred.number !== undefined && pred.number !== null;
        const canShow = fresh && validTarget && hasPred;
        const matrix = el(game + '-prediction-grid');
        if (canShow) {
            const details = predictionInfo(game, pred);
            html(game + '-prediction', resultLine(game, pred, '预测'));
            write(game + '-confidence', `${details.sub} | 历史模型分数 ${pred.confidence ?? '--'}（非命中率）`);
            write(game + '-target', issue);
            if (matrix) {
                matrix.replaceChildren();
                const note = document.createElement('div');
                note.className = 'multi-note compact-matrix-note';
                note.textContent = `预测格式已与开奖格式统一显示；仅在最新期号与模型目标期号一致时展示。`;
                matrix.appendChild(note);
            }
        } else {
            html(game + '-prediction', line('预测', [chip(fresh ? '等待下期模型数据' : '过期数据暂停预测', 'status')]));
            write(game + '-confidence', fresh ? '模型目标期号尚未匹配' : '请先恢复实时开奖，不能用旧预测当作下一期结果');
            write(game + '-target', '--');
            empty(matrix, '只有后台最新期号及模型数据都有效时才显示参考。');
        }
        renderHistory(game, state);
        renderReview(game, state);
    }
    async function jsonGet(url, timeoutMs) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {cache: 'no-store', signal: controller.signal});
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (!data || typeof data !== 'object' || !GAMES.some(g => data[g]))
                throw new Error('API 没有 K3/5D/TRX 数据');
            return data;
        } finally { clearTimeout(timeout); }
    }
    async function refresh() {
        if (busy) return;
        busy = true;
        try {
            let data;
            let source;
            let note = '';
            try {
                data = await jsonGet(ENDPOINT + '?t=' + Date.now(), 9000);
                source = 'render';
            } catch (_) {
                note = 'Render API 不可达';
                // No bundled static data.json: it contained an obsolete historical
                // snapshot and could be mistaken for a real feed.
                data = previous || {};
                source = 'offline';
            }
            previous = data;
            previousSource = source;
            for (const g of GAMES) renderGame(g, data, source, note);
        } catch (error) {
            console.warn('[Multi] Rendering error:', error?.name || 'error');
            for (const g of GAMES) renderGame(g, previous || {}, 'offline', '页面读取失败');
        } finally {
            busy = false;
        }
    }
    window.multiGamesRefresh = refresh;
    window.multiGamesState = () => ({source: previousSource, refreshed: !!previous});
    function init() {
        if (!el('k3-section')) return;
        refresh();
        setInterval(refresh, REFRESH_MS);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) refresh();
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
    else init();
})();
