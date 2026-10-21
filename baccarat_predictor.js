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
        displayState = {table, history: history.slice()};
        if (typeof document === 'undefined' || !document.getElementById('bc-predict-lab')) return;

        const patternResult = makeForecast(history, 'pattern');
        const result = patternResult.ready
            ? patternResult
            : {
                ...patternResult,
                ready: true,
                pick: leading(BASE),
                score: {...BASE}
            };

        const pickText = result.pick ? `${LABEL[result.pick]} ${result.pick === 'B' ? 'BANKER' : result.pick === 'P' ? 'PLAYER' : 'TIE'}` : '等待样本';
        setText('bc-top-next-pick', pickText);
        setText('bc-predict-main-hero', pickText);
        const topPick = document.getElementById('bc-top-next-pick');
        if (topPick) topPick.className = 'card-value bc-next-pick' + (result.pick ? ` is-${result.pick}` : '');
        const hero = document.getElementById('bc-predict-main-hero');
        if (hero) hero.className = 'bc-predict-main' + (result.pick ? ` is-${result.pick}` : '');

        setText('bc-predict-state', patternResult.ready ? '已根据当前历史自动刷新下一局参考' : '样本不足时先用标准基准显示参考');
        setText('bc-predict-sub', patternResult.ready
            ? `依据当前已录的 ${patternResult.recorded} 局历史，输出简化版下一局参考方向。`
            : `目前已录 ${patternResult.recorded} 局（含和 ${patternResult.ties} 局），样本不足时先显示标准基准参考。`);

        for (const code of CODES) {
            setText(`bc-predict-pct-${code}`, percent(result.score[code]));
            const bar = document.getElementById(`bc-predict-fill-${code}`);
            if (bar) bar.style.width = `${Math.min(100, Math.max(0, 100 * result.score[code]))}%`;
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
