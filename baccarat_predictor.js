/* V29 pattern hypotheses, not guaranteed predictions or betting automation.
 * Rule thresholds below are design choices, NOT statistically proven edges.
 * No future result, internet feed, or randomness is used to generate a call.
 */
(function(root, factory) {
    const analysis = root.BaccaratAnalysis || (typeof module === 'object' && module.exports ? require('./baccarat_analysis.js') : null);
    const api = factory(analysis);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.BaccaratPredictor = api;
})(typeof globalThis === 'object' ? globalThis : this, function(analysis) {
    'use strict';
    const VERSION = 'V29-patterns-1';
    const BASE = Object.freeze({...analysis.BASE});
    const NAME = Object.freeze({B:'\u5e84', P:'\u95f2', T:'\u548c'});
    const RULES = Object.freeze({dragon:4, single:5, doublePairs:3, modelMinimum:20, scoreMargin:0.02});
    function validate(history) {
        if (!Array.isArray(history) || history.some(x => !['B','P','T'].includes(x))) throw new TypeError('Expected B/P/T history');
        return history;
    }
    const other = c => c === 'B' ? 'P' : 'B';
    function runsOf(codes) {
        const runs = [];
        for (const c of codes) {
            if (runs.length && runs[runs.length-1].code === c) runs[runs.length-1].length++;
            else runs.push({code:c, length:1});
        }
        return runs;
    }
    function makeForecast(history) {
        validate(history);
        const decisive = history.filter(c => c !== 'T');
        const codes = decisive.slice(-300);
        const n = codes.length, runs = runsOf(codes), last = runs.at(-1);
        const result = (pick, strategy, reason, extra = {}) => ({
            version: VERSION, targetRound: history.length+1, recorded:history.length,
            decisive:decisive.length, ties:history.length-decisive.length,
            ready:pick !== null, pick, strategy, reason, ...extra
        });
        if (!n) return result(null, 'waiting', '\u5148\u5f55\u5165\u5df2\u5f00\u51fa\u7684\u5e84\u3001\u95f2\u3001\u548c\u3002');
        // Ignore ties for shape matching, but retain every tie in history/scoring.
        if (last.length >= RULES.dragon)
            return result(last.code, 'dragon', `\u957f\u9f99\u8ddf\u968f\uff1a${NAME[last.code]} ${last.length} \u8fde\uff08\u548c\u4e0d\u6253\u65ad\uff09\uff0c\u672c\u6b21\u6309\u5ef6\u7eed\u65b9\u5411\u53c2\u8003\u3002`);
        if (last.length === 1 && runs.at(-2)?.length >= RULES.dragon)
            return result(null, 'break', '\u957f\u9f99\u521a\u65ad\uff0c\u5148\u89c2\u5bdf\u4e00\u4e2a\u5e84\u95f2\u7ed3\u679c\uff0c\u4e0d\u76f4\u63a5\u8ffd\u53cd\u5411\u3002');
        let alternating = 1;
        for (let i = n-1; i > 0 && codes[i] !== codes[i-1]; i--) alternating++;
        if (alternating >= RULES.single)
            return result(other(last.code), 'single', `\u5355\u8df3\u5ef6\u7eed\uff1a\u6700\u8fd1 ${alternating} \u4e2a\u5e84\u95f2\u4ea4\u66ff\uff0c\u53c2\u8003\u4e0e\u6700\u540e\u4e00\u5c40\u76f8\u53cd\u65b9\u5411\u3002`);
        if (last.length === 2 && runs.length >= 5 && runs.slice(-5,-1).every(r => r.length === 1))
            return result(null, 'break', '\u5355\u8df3\u521a\u65ad\uff0c\u7b49\u5f85\u65b0\u5f62\u6001\uff0c\u4e0d\u5f3a\u884c\u5224\u65ad\u3002');
        const completed = runs.slice(0,-1);
        if ((last.length === 2 && completed.length >= 2 && completed.slice(-2).every(r => r.length === 2)) ||
            (last.length === 1 && completed.length >= 3 && completed.slice(-3).every(r => r.length === 2))) {
            return result(last.length === 2 ? other(last.code) : last.code, 'double',
                last.length === 2 ? '\u53cc\u8df3\u5ef6\u7eed\uff1a\u5f53\u524d\u5df2\u51fa\u73b0\u4e00\u5bf9\uff0c\u53c2\u8003\u5207\u6362\u65b9\u5411\u3002' : '\u53cc\u8df3\u5ef6\u7eed\uff1a\u65b0\u4e00\u7ec4\u5df2\u51fa\u4e00\u5c40\uff0c\u53c2\u8003\u540c\u65b9\u5411\u8865\u7b2c\u4e8c\u5c40\u3002');
        }
        if (last.length === 3 && completed.length >= 2 && completed.slice(-2).every(r => r.length === 2))
            return result(null, 'break', '\u53cc\u8df3\u521a\u65ad\uff0c\u6682\u505c\u539f\u5f62\u6001\u53c2\u8003\u3002');
        if (decisive.length < RULES.modelMinimum)
            return result('B', 'baseline', '\u6682\u65e0\u7a33\u5b9a\u5f62\u6001\uff1b\u663e\u793a\u516b\u526f\u724c\u6570\u5b66\u57fa\u51c6\u53c2\u8003\uff0c\u4e0d\u662f\u5df2\u9a8c\u8bc1\u4f18\u52bf\u3002');
        const estimate = analysis.estimateDecisive(codes).pBanker;
        if (Math.abs(estimate - 0.5) < RULES.scoreMargin)
            return result(null, 'mixed', '\u65e0\u6e05\u6670\u957f\u9f99\u6216\u8df3\u8def\uff0c\u7edf\u8ba1\u6a21\u578b\u5206\u6b67\u5c0f\uff0c\u672c\u5c40\u89c2\u5bdf\u3002');
        return result(estimate >= 0.5 ? 'B' : 'P', 'model',
            '\u65e0\u56fa\u5b9a\u8def\u578b\uff1b\u4f7f\u7528\u5e73\u6ed1\u9891\u7387\u4e0e\u4e00\u3001\u4e8c\u9636\u8f6c\u79fb\u7684\u5b9e\u9a8c\u65b9\u5411\u3002');
    }
    function settle(pick, actual) {
        if (pick === null) return {status:'PASS', exact:false, net:0};
        if (!['B','P'].includes(pick) || !['B','P','T'].includes(actual)) throw new TypeError('Invalid result');
        if (actual === 'T') return {status:'TIE', exact:false, net:0};
        return {status:pick === actual ? 'HIT' : 'MISS', exact:pick === actual,
            net:pick === actual ? (pick === 'B' ? 0.95 : 1) : -1};
    }
    function evaluate(history, options = {}) {
        validate(history);
        const start = options.start ?? 0;
        if (!Number.isInteger(start) || start < 0 || start > history.length) throw new RangeError('Invalid replay start');
        const rows = [], summary = {evaluated:0, actionable:0, pass:0, hits:0, misses:0, ties:0, net:0, matchedBankerNet:0};
        for (let i = start; i < history.length; i++) {
            const f = makeForecast(history.slice(0,i)), s = settle(f.pick, history[i]);
            summary.evaluated++;
            if (s.status === 'PASS') summary.pass++;
            else {
                summary.actionable++;
                summary.hits += s.status === 'HIT'; summary.misses += s.status === 'MISS'; summary.ties += s.status === 'TIE';
                summary.net += s.net; summary.matchedBankerNet += settle('B', history[i]).net;
            }
            rows.push({round:i+1, pick:f.pick, actual:history[i], strategy:f.strategy, ...s});
        }
        return {...summary, accuracyIncludingTies:summary.actionable ? summary.hits/summary.actionable : null,
            accuracyExcludingTies:summary.hits+summary.misses ? summary.hits/(summary.hits+summary.misses) : null,
            coverage:summary.evaluated ? summary.actionable/summary.evaluated : null,
            kind:'retrospective_prefix_only', rows};
    }
    function render(history, pending) {
        const f = pending && pending.version === VERSION ? pending : makeForecast(history);
        const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
        set('bc-predict-main', f.pick ? NAME[f.pick] : '\u89c2\u5bdf');
        const main = document.getElementById('bc-predict-main');
        if (main) main.className = 'bc-call' + (f.pick ? ` is-${f.pick}` : ' is-wait');
        set('bc-predict-target', `\u7b2c ${f.targetRound} \u5c40\u53c2\u8003`);
        set('bc-predict-strategy', ({dragon:'\u957f\u9f99\u8ddf\u968f',single:'\u5355\u8df3\u5ef6\u7eed',double:'\u53cc\u8df3\u5ef6\u7eed',
            break:'\u65ad\u8def\u89c2\u5bdf',baseline:'\u6570\u5b66\u57fa\u51c6',model:'\u7edf\u8ba1\u6a21\u578b',mixed:'\u6df7\u5408\u8d70\u52bf',waiting:'\u7b49\u5f85\u5f55\u5165'})[f.strategy]);
        set('bc-predict-reason', f.reason);
        return f;
    }
    return Object.freeze({VERSION,BASE,RULES,makeForecast,settle,evaluate,render,validate,runsOf});
});
