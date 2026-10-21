/* V24 Baccarat next-round research workbench.
 * Browser-local, manual B/P/T history only. NO betting, RNG prediction claim,
 * casino scraping, or authentication. Multi-class chronological replay includes ties.
 * Reference: Wizard of Odds, 8-deck commission Punto Banco.
 */
(function (root, factory) {
    'use strict';
    const analysis = root && root.BaccaratAnalysis ||
        (typeof module === 'object' && module.exports ? require('./baccarat_analysis.js') : null);
    const api = factory(analysis);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.BaccaratPredictor = api;
})(typeof globalThis === 'object' ? globalThis : this, function (analysis) {
    'use strict';
    if (!analysis) throw new Error('BaccaratAnalysis must load before BaccaratPredictor');

    const BASE = Object.freeze({...analysis.BASE});
    const LABEL = Object.freeze({B:'庄', P:'闲', T:'和'});
    const CODES = Object.freeze(['B', 'P', 'T']);
    const MIN_PATTERN_DECISIVE = 20;
    const MIN_BACKTEST_DECISIVE = 40;
    const MAX_BACKTEST_ROUNDS = 240;
    const REPLAY_ROWS = 8;
    let selectedMode = 'pattern';
    let displayState = null;

    function validate(history) {
        if (!Array.isArray(history) || history.some(code => !CODES.includes(code))) {
            throw new TypeError('History must be an array of B, P, T codes');
        }
        return history;
    }
    function scoreForDecisive(decisive) {
        const pBanker = analysis.estimateDecisive(decisive).pBanker;
        return {B: pBanker * (1 - BASE.T), P: (1 - pBanker) * (1 - BASE.T), T: BASE.T};
    }
    function leading(score) {
        return score.B >= score.P ? 'B' : 'P';
    }
    function brier(score, actual) {
        return CODES.reduce((sum, code) => sum + (score[code] - Number(code === actual)) ** 2, 0);
    }
    function makeForecast(history, mode = 'pattern') {
        validate(history);
        if (!['pattern', 'baseline'].includes(mode)) throw new TypeError('Invalid mode');
        const decisive = history.filter(code => code !== 'T');
        const enough = decisive.length >= MIN_PATTERN_DECISIVE;
        const experimental = mode === 'pattern';
        const score = experimental && enough ? scoreForDecisive(decisive) : {...BASE};
        return {
            mode,
            recorded: history.length,
            decisive: decisive.length,
            ties: history.length - decisive.length,
            targetRound: history.length + 1,
            ready: !experimental || enough,
            missing: experimental ? Math.max(0, MIN_PATTERN_DECISIVE - decisive.length) : 0,
            pick: experimental && !enough ? null : leading(score),
            score,
            baseline: {...BASE},
            scoreType: experimental && enough ? '实验模型分数（非真实概率）' : '八副牌理论概率',
        };
    }

    /** Chronological *retrospective* replay: each round is predicted from the prefix only.
     * Truncating to the most recent 240 rounds saves render time and avoids implying that
     * old-model real-time predictions were actually locked or prospectively evaluated.
     * All results (including ties) are scored, with a 3-class Brier and direction hit.
     */
    function evaluate(history, opts = {}) {
        validate(history);
        const limit = opts.maxRounds ?? MAX_BACKTEST_ROUNDS;
        if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
            throw new RangeError('maxRounds must be 1..5000');
        }
        const start = Math.max(0, history.length - limit);
        const decisive = [];
        const rows = [];
        let baselineHits = 0, modelHits = 0, modelBrier = 0, baselineBrier = 0;
        const pairedImprovement = [];
        for (let i = 0; i < history.length; i++) {
            const actual = history[i];
            if (i >= start && decisive.length >= MIN_BACKTEST_DECISIVE) {
                const score = scoreForDecisive(decisive);
                const pick = leading(score);
                const modelLoss = brier(score, actual);
                const referenceLoss = brier(BASE, actual);
                rows.push({round: i + 1, pick, actual, hit: pick === actual,
                    baselinePick:'B', baselineHit:actual === 'B'});
                modelHits += Number(pick === actual);
                baselineHits += Number(actual === 'B');
                modelBrier += modelLoss;
                baselineBrier += referenceLoss;
                pairedImprovement.push(referenceLoss - modelLoss);
            }
            if (actual !== 'T') decisive.push(actual);
        }
        const n = rows.length;
        const delta = n ? (baselineBrier - modelBrier) / n : null;
        const sampleStdErr = n > 1 ? Math.sqrt(pairedImprovement.reduce((sum, value) =>
            sum + (value - delta) ** 2, 0) / (n * (n - 1))) : null;
        const lower95 = sampleStdErr === null ? null : delta - 1.96 * sampleStdErr;
        const mid = Math.floor(n / 2);
        const avg = arr => arr.reduce((sum, v) => sum + v, 0) / (arr.length || 1);
        const halvesImproved = n >= 2 && avg(pairedImprovement.slice(0, mid)) > 0 &&
            avg(pairedImprovement.slice(mid)) > 0;
        // Informational research flag only; NOT independent validation or advice.
        const tentativeImprovement = n >= 120 && halvesImproved && lower95 > 0;
        const status = n < 60 ? 'insufficient' :
            (tentativeImprovement ? 'retrospective_improvement' : 'no_supported_improvement');
        return {
            rounds: n,
            firstRound: n ? rows[0].round : null,
            lastRound: n ? rows[n-1].round : null,
            modelHits,
            baselineHits,
            modelAccuracy: n ? modelHits / n : null,
            baselineAccuracy: n ? baselineHits / n : null,
            modelBrier: n ? modelBrier / n : null,
            baselineBrier: n ? baselineBrier / n : null,
            deltaBrier: delta,
            lower95,  // Approximate, ignores dependence; exploratory only.
            status,
            recent: rows.slice(-REPLAY_ROWS).reverse(),
        };
    }

    function setText(id, value) {
        const node = document.getElementById(id);
        if (node) node.textContent = String(value);
    }
    const percent = value => value === null ? '--' : `${(100 * value).toFixed(1)}%`;
    const percentExact = value => `${(100 * value).toFixed(2)}%`;

    function render(history, table) {
        validate(history);
        // Only manual inputs from this table are used. History copy prevents later
        // in-place changes from silently altering a stored UI snapshot.
        displayState = {table, history:history.slice()};
        if (typeof document === 'undefined' || !document.getElementById('bc-predict-lab')) return;
        const result = makeForecast(history, selectedMode);
        const tested = evaluate(history);
        setText('bc-predict-table', table);
        setText('bc-predict-target', `${table} · 待记录第 ${result.targetRound} 局`);
        setText('bc-predict-mode-note', selectedMode === 'pattern' ?
            '实验模型：近期频率 + 一阶 / 二阶 Markov + 贝叶斯平滑。' :
            '基准模型：八副牌标准 Punto Banco 全组合数学概率。');
        setText('bc-predict-main', result.ready ? `${LABEL[result.pick]} ${result.pick === 'B' ? 'BANKER' : 'PLAYER'}` : '等待样本');
        const prediction = document.getElementById('bc-predict-main');
        if (prediction) prediction.className = 'bc-predict-main' + (result.pick ? ` is-${result.pick}` : '');
        setText('bc-predict-state', result.mode === 'baseline' ? '理论频率最高项 · 不是稳赢' :
            (result.ready ? '实验方向 · 未验证预测优势' : `还缺 ${result.missing} 局庄 / 闲`));
        setText('bc-predict-sub', result.mode === 'pattern' && !result.ready ?
            `已录 ${result.recorded} 局（含和 ${result.ties} 局）；收集满 ${MIN_PATTERN_DECISIVE} 个庄 / 闲才输出模型方向。` :
            `依据之前 ${result.recorded} 局手动记录生成。点击庄 / 闲 / 和录入下一局真实结果后自动更新。`);
        setText('bc-predict-score-type', result.scoreType);
        for (const code of CODES) {
            setText(`bc-predict-pct-${code}`, percent(result.score[code]));
            const bar = document.getElementById(`bc-predict-fill-${code}`);
            if (bar) bar.style.width = `${Math.min(100, Math.max(0, 100 * result.score[code]))}%`;
        }
        const ev = [BASE.B * 0.95 - BASE.P, BASE.P - BASE.B, BASE.T * 8 - BASE.B - BASE.P];
        setText('bc-predict-math', `基准：庄 ${percentExact(BASE.B)} · 闲 ${percentExact(BASE.P)} · 和 ${percentExact(BASE.T)}。标准抽佣下押庄 / 闲 / 和的平均净回报约 ${ev.map(v => percentExact(v)).join(' / ')}。`);
        document.querySelectorAll('[data-bc-predict-mode]').forEach(button => {
            const active = button.getAttribute('data-bc-predict-mode') === selectedMode;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        setText('bc-predict-tested', tested.rounds ? `${tested.rounds} 局` : '不足 40 局训练');
        setText('bc-predict-hit', percent(tested.modelAccuracy));
        setText('bc-predict-base-hit', percent(tested.baselineAccuracy));
        setText('bc-predict-brier', tested.modelBrier === null ? '--' :
            `${tested.modelBrier.toFixed(4)} / ${tested.baselineBrier.toFixed(4)}`);
        setText('bc-predict-evidence', tested.status === 'retrospective_improvement'
            ? '仅在本桌历史重放中出现初步改善；没有独立的未来验证证据。'
            : tested.status === 'insufficient'
                ? `回测资料不足：至少需要 ${MIN_BACKTEST_DECISIVE} 个庄 / 闲训练局，并积累足够的后续开奖结果。`
                : '尚未发现稳健优于固定数学基准的证据；不构成下注建议。');
        setText('bc-predict-range', tested.rounds ?
            `逐局重放第 ${tested.firstRound}–${tested.lastRound} 局；庄 / 闲 / 和都纳入命中率分母，和局不会被删掉。` :
            '仅使用当前牌桌的手动历史，无真实发牌数据，无赌场实时连接。');

        const replay = document.getElementById('bc-predict-replay');
        if (replay) {
            const fragment = document.createDocumentFragment();
            if (!tested.recent.length) {
                const placeholder = document.createElement('p');
                placeholder.className = 'bc-predict-empty';
                placeholder.textContent = '累积足够的已知历史后，将按时间顺序重算过去每一局的预测。';
                fragment.appendChild(placeholder);
            }
            for (const item of tested.recent) {
                const row = document.createElement('div');
                row.className = 'bc-predict-replay-row';
                const pieces = [
                    [`第 ${item.round} 局`, 'round'],
                    [`模型：${LABEL[item.pick]}`, `is-${item.pick}`],
                    [`实际：${LABEL[item.actual]}`, `is-${item.actual}`],
                    [item.hit ? '吻合' : '未吻合', item.hit ? 'is-hit' : 'is-miss']
                ];
                for (const [content, klass] of pieces) {
                    const cell = document.createElement('span');
                    cell.className = klass;
                    cell.textContent = content;
                    row.appendChild(cell);
                }
                fragment.appendChild(row);
            }
            replay.replaceChildren(fragment);
        }
    }

    function setMode(mode) {
        if (!['pattern', 'baseline'].includes(mode)) return;
        selectedMode = mode;
        if (displayState) render(displayState.history, displayState.table);
    }

    return Object.freeze({BASE, MIN_PATTERN_DECISIVE, MIN_BACKTEST_DECISIVE,
        MAX_BACKTEST_ROUNDS, makeForecast, evaluate, render, setMode});
});
