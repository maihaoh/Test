/* WinGo V35 numerical consistency and pre-result audit helpers.
 * No network, betting, or external randomness. Input history newest first.
 */
(function(root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WingoConsistency = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
    'use strict';
    const validNumber = n => Number.isInteger(n) && n >= 0 && n <= 9;
    const sizeOf = n => validNumber(n) ? n <= 4 ? '小' : '大' : null;
    function chooseNumber(numbers, desiredSize) {
        if (desiredSize !== '大' && desiredSize !== '小') return null;
        const domain = desiredSize === '大' ? [5,6,7,8,9] : [0,1,2,3,4];
        const values = Array.isArray(numbers) ? numbers.filter(validNumber).slice(0,100) : [];
        if (!values.length) return desiredSize === '大' ? 7 : 2;
        const scores = Object.fromEntries(domain.map(v => [v,1])); // Laplace prior
        for (let i=0;i<values.length;i++) {
            const v=values[i];
            if (domain.includes(v)) scores[v] += 1 + (values.length-i)/values.length;
        }
        // Next result following a prior occurrence of the current number.
        for (let i=1;i<values.length;i++) {
            if (values[i] === values[0] && domain.includes(values[i-1]))
                scores[values[i-1]] += 1.25;
        }
        return domain.reduce((best,v) => scores[v] > scores[best] ? v : best, domain[0]);
    }
    function immediateNextIssue(current, previous) {
        const next=String(current||''), prior=String(previous||'');
        if (!/^\d{8,28}$/.test(next) || !/^\d{8,28}$/.test(prior) || next.length !== prior.length) return false;
        return BigInt(next) === BigInt(prior)+1n;
    }
    function legitimateReview(pending, newestTwo) {
        if (!pending || !Array.isArray(newestTwo) || newestTwo.length < 2) return false;
        if (!pending.forecast || !['大','小','PASS'].includes(pending.forecast.size)) return false;
        if (typeof pending.fromIssue !== 'string') return false;
        if (String(newestTwo[1]?.issue) !== pending.fromIssue) return false;
        if (!immediateNextIssue(newestTwo[0]?.issue, pending.fromIssue)) return false;
        const guess=pending.forecast;
        if (guess.size !== 'PASS' && sizeOf(guess.num) !== guess.size) return false;
        return validNumber(Number(newestTwo[0]?.number));
    }
    return Object.freeze({sizeOf,chooseNumber,immediateNextIssue,legitimateReview});
});
