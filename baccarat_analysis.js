/* Baccarat V21 analysis: transparent, research-oriented probability benchmarks.
 * Public statistical ideas, no copied proprietary algorithm, no wagering/actions.
 * B/P/T results alone cannot identify the remaining-shoe composition. Therefore
 * the 8-deck base rates are the primary defensible probabilities. The dynamic
 * pattern score is an experimental association estimator, not a win probability.
 */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.BaccaratAnalysis = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';
    // Wizard of Odds: 8-deck Punto Banco outcome probabilities, full enumeration.
    const BASE = Object.freeze({
        B: 0.45859742,
        P: 0.44624661,
        T: 0.09515597
    });
    const BASE_DECISIVE_B = BASE.B / (BASE.B + BASE.P);
    const MAX_EVAL = 240;
    const MIN_TRAIN = 40;

    function validHistory(history) {
        if (!Array.isArray(history)) throw new TypeError('History must be an array');
        if (history.some(v => v !== 'B' && v !== 'P' && v !== 'T')) {
            throw new TypeError('History may only contain B, P or T');
        }
        return history;
    }

    function rateWithPrior(b, total, strength) {
        return (b + strength * BASE_DECISIVE_B) / (total + strength);
    }

    // Model for the next decisive hand, not for the next real round (tie possible).
    // Uses only previous observations: no future data, no tuning from next result.
    // Small groups shrink toward the theoretical baseline, not 0%/100%.
    function estimateDecisive(decisive) {
        const n = decisive.length;
        if (!n) return {pBanker: BASE_DECISIVE_B, counts: [0, 0, 0]};
        const freq = decisive.slice(-80);
        let countB = 0;
        for (const code of freq) if (code === 'B') countB++;
        const globalRate = rateWithPrior(countB, freq.length, 60);

        const last = decisive[n - 1];
        let firstB = 0, firstN = 0;
        for (let i = Math.max(1, n - 240); i < n; i++) {
            if (decisive[i - 1] === last) {
                firstN++;
                if (decisive[i] === 'B') firstB++;
            }
        }
        const firstRate = rateWithPrior(firstB, firstN, 100);

        let secondB = 0, secondN = 0;
        if (n > 1) {
            const prev = decisive[n - 2];
            for (let i = Math.max(2, n - 300); i < n; i++) {
                if (decisive[i - 2] === prev && decisive[i - 1] === last) {
                    secondN++;
                    if (decisive[i] === 'B') secondB++;
                }
            }
        }
        const secondRate = rateWithPrior(secondB, secondN, 120);

        // Conservative Bayesian ensemble. Variations do not establish true odds.
        const pBanker = 0.35 * BASE_DECISIVE_B + 0.30 * globalRate +
            0.23 * firstRate + 0.12 * secondRate;
        return {pBanker, counts: [freq.length, firstN, secondN]};
    }

    function evaluateWalkForward(decisive) {
        const n = decisive.length;
        if (n <= MIN_TRAIN) return {
            observations: 0, baselineBrier: null, candidateBrier: null,
            baselineHitRate: null, candidateHitRate: null, deltaBrier: null,
            status: 'insufficient'
        };
        const start = Math.max(MIN_TRAIN, n - MAX_EVAL);
        let modelBrier = 0, baseBrier = 0, modelHits = 0, baseHits = 0;
        const results = [];
        for (let i = start; i < n; i++) {
            const p = estimateDecisive(decisive.slice(0, i)).pBanker;
            const b = decisive[i] === 'B' ? 1 : 0;
            const modelLoss = (p - b) ** 2;
            const baseLoss = (BASE_DECISIVE_B - b) ** 2;
            modelBrier += modelLoss;
            baseBrier += baseLoss;
            modelHits += Number((p >= 0.5) === Boolean(b));
            baseHits += b;
            results.push(baseLoss - modelLoss);
        }
        const observed = n - start;
        const delta = (baseBrier - modelBrier) / observed; // positive = improved
        const firstHalf = results.slice(0, Math.floor(observed / 2));
        const secondHalf = results.slice(Math.floor(observed / 2));
        const mean = arr => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
        const halvesPositive = mean(firstHalf) > 0 && mean(secondHalf) > 0;
        // This is only a descriptive test on observed hands: no guarantee of
        // future advantage and no status is a recommendation to bet.
        const status = observed < 120 ? 'insufficient'
            : (delta > 0.0005 && halvesPositive ? 'observed_improvement' : 'not_better');
        return {
            observations: observed,
            baselineBrier: baseBrier / observed,
            candidateBrier: modelBrier / observed,
            baselineHitRate: baseHits / observed,
            candidateHitRate: modelHits / observed,
            deltaBrier: delta,
            status
        };
    }

    function analyze(history) {
        validHistory(history);
        const decisive = history.filter(code => code !== 'T');
        const result = estimateDecisive(decisive);
        const backtest = evaluateWalkForward(decisive);
        const q = result.pBanker;
        const direction = q >= 0.5 ? 'B' : 'P';
        // Convert *conditional-on-non-tie pattern score* for display only.
        // It is NOT a measured or physically calculated next-hand likelihood.
        const score = {
            B: q * (1 - BASE.T),
            P: (1 - q) * (1 - BASE.T),
            T: BASE.T
        };
        const distinct = Math.abs(q - 0.5) >= 0.01;
        return {
            baseline: {...BASE},
            baselineDecisiveBanker: BASE_DECISIVE_B,
            patternScore: score,
            patternDecisiveBanker: q,
            patternDirection: direction,
            hasDistinctPattern: distinct,
            recorded: history.length,
            decisive: decisive.length,
            ties: history.length - decisive.length,
            samples: result.counts,
            backtest,
            caveat: '仅有庄闲和结果，无法推断剩余牌张；模式分数不是下一局真实概率。'
        };
    }

    return Object.freeze({BASE, BASE_DECISIVE_B, analyze, estimateDecisive, evaluateWalkForward});
});
