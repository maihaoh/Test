/* V35 baccarat roadmap interpreter. Deterministic, prior-results only.
 * Trends are descriptions, NOT changes to Banker/Player/Tie odds.
 * Ties never start/break a streak; every actual tie still advances the round.
 */
(function(root, factory) {
    'use strict';
    const analysis = root.BaccaratAnalysis ||
        (typeof module === 'object' && module.exports ? require('./baccarat_analysis.js') : null);
    const api = factory(analysis);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.BaccaratPredictor = api;
})(typeof globalThis === 'object' ? globalThis : this, function(analysis) {
    'use strict';
    const VERSION = 'V35-road-audit-1';
    const BASE = Object.freeze({...analysis.BASE});
    const NAME = Object.freeze({B:'庄', P:'闲', T:'和'});
    const RULES = Object.freeze({dragon:4, single:5, doublePairs:3,
        modelMinimum:40, modelMargin:0.02, minimumBacktest:120});
    function validate(history) {
        if (!Array.isArray(history) || history.some(x => x !== 'B' && x !== 'P' && x !== 'T'))
            throw new TypeError('Expected B/P/T history');
        return history;
    }
    const other = c => c === 'B' ? 'P' : 'B';
    function runsOf(codes) {
        const runs = [];
        for (const code of codes) {
            if (runs.length && runs[runs.length-1].code === code) runs[runs.length-1].length++;
            else runs.push({code, length:1});
        }
        return runs;
    }
    function inspectRoad(history) {
        validate(history);
        const codes = history.filter(c => c !== 'T');
        const runs = runsOf(codes);
        const last = runs[runs.length-1] || null;
        let alternating = 0;
        for (let i = codes.length-1; i >= 0; i--) {
            if (i < codes.length-1 && codes[i] === codes[i+1]) break;
            alternating++;
        }
        const completed = runs.slice(0,-1);
        let priorPairs = 0;
        for (let i = completed.length-1; i >= 0 && completed[i].length === 2; i--) priorPairs++;
        let recentSingles = 0;
        for (let i = completed.length-1; i >= 0 && completed[i].length === 1; i--) recentSingles++;
        return {
            runs, last, alternating, priorPairs, recentSingles,
            decisiveCount: codes.length,
            ties: history.length-codes.length,
            recentRuns: runs.slice(-6).map(r=>`${NAME[r.code]}${r.length}`).join(' / ')
        };
    }
    function makeForecast(history) {
        validate(history);
        const road = inspectRoad(history);
        const {last, runs, alternating, priorPairs, recentSingles} = road;
        const result = (pick, strategy, reason, extra={}) => ({
            version: VERSION,
            targetRound:history.length+1,
            recorded:history.length,
            decisive:road.decisiveCount,
            ties:road.ties,
            ready:pick !== null,
            pick, strategy, reason,
            roadState:road.recentRuns,
            ...extra
        });
        if (!last) return result(null, 'waiting', '请先录入庄／闲／和的实际开奖结果；只有「和」时大路尚未形成。');
        // At least one single result must be observed after a road breaks.
        if (last.length === 1 && runs.length > 1 && runs[runs.length-2].length >= RULES.dragon)
            return result(null, 'break', `长龙中断：此前连续 ${NAME[runs.at(-2).code]} ${runs.at(-2).length} 局，现出 ${NAME[last.code]}；先观察新路。`);
        if (last.length >= RULES.dragon)
            return result(last.code, 'dragon', `大路长龙：${NAME[last.code]}连续 ${last.length} 局；仅标注「顺路延续」，和局不打断。`);
        if (last.length === 2 && recentSingles >= RULES.single-1)
            return result(null, 'break', `单跳刚中断：此前 ${recentSingles+1} 段交替，现出现连续两局；等待新路。`);
        if (alternating >= RULES.single)
            return result(other(last.code), 'single', `大路单跳：最近 ${alternating} 次庄闲交替；假设继续交替，仅作路型参考。`);
        if (last.length >= 3 && priorPairs >= RULES.doublePairs-1)
            return result(null, 'break', '双跳刚中断：前面连续成对，现第三局同边；暂停按双跳推断。');
        if (last.length === 1 && priorPairs >= RULES.doublePairs)
            return result(last.code, 'double', `大路双跳：已完成 ${priorPairs} 对；当前 ${NAME[last.code]}首局，形态参考补第二局。`);
        if (last.length === 2 && priorPairs >= RULES.doublePairs-1)
            return result(other(last.code), 'double', `大路双跳：此前 ${priorPairs+1} 对；当前 ${NAME[last.code]}已成对，形态参考换边。`);
        // Without a pattern, do not invent a high-certainty Banker guess.
        if (road.decisiveCount < RULES.modelMinimum)
            return result(null, 'baseline', `最近路型：${road.recentRuns}。不足以形成明确长龙／单跳／双跳，先观察。`);
        // Out-of-sample retrospective diagnostics can guard the *display* of
        // an experimental direction; they cannot prove predictive advantage.
        const evidence = analysis.evaluateWalkForward(history.filter(c => c !== 'T'));
        if (evidence.observations >= RULES.minimumBacktest &&
            evidence.status === 'observed_improvement') {
            const q = analysis.estimateDecisive(history.filter(c => c !== 'T')).pBanker;
            if (Math.abs(q-0.5) >= RULES.modelMargin)
                return result(q >= 0.5 ? 'B' : 'P', 'model',
                    `无固定路型；历史逐期回测评分曾改善，当前仅显示实验性方向（非下一局胜率）。`,
                    {backtest:evidence.observations});
        }
        return result(null, 'mixed', `混合路型：${road.recentRuns}。未发现经过足够逐期回测支持的方向，建议观察。`);
    }
    function settle(pick, actual) {
        if (pick === null) return {status:'PASS',exact:false,net:0};
        if (!['B','P'].includes(pick) || !['B','P','T'].includes(actual)) throw new TypeError('Invalid result');
        if (actual === 'T') return {status:'TIE',exact:false,net:0};
        return {status:pick === actual ? 'HIT' : 'MISS',exact:pick === actual,
            net:pick === actual ? (pick === 'B' ? 0.95 : 1) : -1};
    }
    function evaluate(history, options={}) {
        validate(history);
        const start=options.start ?? 0;
        if (!Number.isInteger(start) || start<0 || start>history.length) throw new RangeError('Invalid replay start');
        const rows=[], summary={evaluated:0,actionable:0,pass:0,hits:0,misses:0,ties:0,net:0,matchedBankerNet:0};
        for(let i=start;i<history.length;i++) {
            const f=makeForecast(history.slice(0,i)), s=settle(f.pick, history[i]);
            summary.evaluated++;
            if(s.status==='PASS') summary.pass++;
            else {
                summary.actionable++;
                summary.hits += Number(s.status==='HIT');
                summary.misses += Number(s.status==='MISS');
                summary.ties += Number(s.status==='TIE');
                summary.net += s.net;
                summary.matchedBankerNet += settle('B', history[i]).net;
            }
            rows.push({round:i+1,pick:f.pick,actual:history[i],strategy:f.strategy,...s});
        }
        return {...summary,
            accuracyIncludingTies:summary.actionable ? summary.hits/summary.actionable : null,
            accuracyExcludingTies:summary.hits+summary.misses ? summary.hits/(summary.hits+summary.misses) : null,
            coverage:summary.evaluated ? summary.actionable/summary.evaluated : null,
            kind:'retrospective_prefix_only',rows};
    }
    function render(history,pending) {
        const f=pending && pending.version === VERSION ? pending : makeForecast(history);
        const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value;};
        set('bc-predict-main',f.pick ? NAME[f.pick]:'观察');
        const main=document.getElementById('bc-predict-main');
        if(main) main.className='bc-call'+(f.pick?` is-${f.pick}`:' is-wait');
        set('bc-predict-target',`第 ${f.targetRound} 局参考`);
        set('bc-predict-strategy',({dragon:'长龙（路型）',single:'单跳（路型）',double:'双跳（路型）',
            break:'断路观察',baseline:'路型不足',model:'实验性统计',mixed:'混合走势',waiting:'等待录入'})[f.strategy]||'观察');
        set('bc-predict-reason',f.reason);
        return f;
    }
    return Object.freeze({VERSION,BASE,RULES,makeForecast,settle,evaluate,render,validate,runsOf,inspectRoad});
});
