'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../baccarat_engine.js');
const roads = require('../baccarat_roads.js');
const analysis = require('../baccarat_analysis.js');

test('eight-deck published reference probabilities and commission expected values', () => {
    const p = engine.REFERENCE_8_DECK;
    assert.ok(Math.abs(p.B + p.P + p.T - 1) < 1e-9);
    const ev = engine.referenceEV();
    assert.ok(Math.abs(ev.B + 0.01058) < 0.00002);
    assert.ok(Math.abs(ev.P + 0.01235) < 0.00002);
    assert.ok(Math.abs(ev.T + 0.14360) < 0.00002);
    assert.equal(engine.referenceEV({decks: 6}), null);
    assert.ok(engine.referenceEV({bankerCommission: 0}).B > 0);
});
test('deck counts and validation', () => {
    const shoe = engine.makeShoe(8);
    assert.equal(shoe.remaining, 416);
    assert.deepEqual(shoe.counts, [128, ...Array(9).fill(32)]);
    assert.throws(() => engine.makeShoe(0), /Deck count/);
    assert.throws(() => engine.settleBet('Q', 'B'), /Bet/);
    assert.throws(() => engine.simulate({seed: 1.5}), /Seed/);
    assert.throws(() => engine.configuration({tiePayout: NaN}), /finite/);
});
test('naturals stop both drawing regardless of totals', () => {
    let called = false;
    const h = engine.resolveHand([4,4], [2,3], () => {called = true; return 0;});
    assert.equal(h.natural, true);
    assert.equal(called, false);
    assert.equal(h.winner, 'P');
    assert.deepEqual(h.playerCards, [4,4]);
    assert.deepEqual(h.bankerCards, [2,3]);
});
test('player stands on six or seven; banker then draws on five and stands on six', () => {
    let draws = 0;
    const h = engine.resolveHand([2,4], [2,3], () => {draws++; return 4;});
    assert.equal(draws, 1);
    assert.equal(h.playerCards.length, 2);
    assert.equal(h.bankerCards.length, 3);
    assert.equal(h.bankerTotal, 9);
    const noDraw = engine.resolveHand([2,4], [2,4], () => {throw Error('unexpected');});
    assert.equal(noDraw.bankerCards.length, 2);
});
test('banker third-card tableau for all totals and player third values', () => {
    const allowed = {
        0:[0,1,2,3,4,5,6,7,8,9],
        1:[0,1,2,3,4,5,6,7,8,9],
        2:[0,1,2,3,4,5,6,7,8,9],
        3:[0,1,2,3,4,5,6,7,9],
        4:[2,3,4,5,6,7],
        5:[4,5,6,7],
        6:[6,7],7:[],8:[],9:[]
    };
    for (let b=0;b<=9;b++) {
        for (let p=0;p<=9;p++) assert.equal(engine.bankerDraws(b,p), allowed[b].includes(p), `${b}/${p}`);
        assert.equal(engine.bankerDraws(b,null), b <= 5);
    }
    const h = engine.resolveHand([2,3], [1,2], (() => {let n=0; return () => [8,1][n++];})());
    assert.equal(h.playerCards.length,3);
    assert.equal(h.bankerCards.length,2); // Banker total 3 stands when Player third = 8.
});
test('correct commission, pushes and winning tie settlement', () => {
    assert.equal(engine.settleBet('B','B',100), 95);
    assert.equal(engine.settleBet('B','T',100), 0);
    assert.equal(engine.settleBet('P','T',100), 0);
    assert.equal(engine.settleBet('T','T',100), 800);
    assert.equal(engine.settleBet('T','B',100), -100);
    assert.equal(engine.settleBet('P','B',100), -100);
    assert.equal(engine.settleBet('B','B',100,{bankerCommission:.08}), 92);
});
test('seeded simulation is reproducible, records real P&L and never fabricates expected wins', () => {
    const opts = {seed: 42, rounds: 900, stake: 2, bankroll: 1000};
    const a = engine.simulate(opts), b = engine.simulate(opts);
    assert.deepEqual(a,b);
    assert.equal(a.roundsPlayed, a.wins+a.losses+a.pushes);
    assert.equal(a.totalWagered, a.roundsPlayed*2);
    assert.ok(a.maxDrawdown >= 0);
    assert.ok(Number.isFinite(a.roi));
    assert.notEqual(engine.simulate({...opts,seed:43}).netProfit, a.netProfit);
});
test('monte carlo eight-deck fresh-shoe hand frequencies agree with exact reference', () => {
    let shoe = engine.makeShoe(), random=engine.seededRandom(20261021);
    const counts={B:0,P:0,T:0}, n=100000;
    for(let i=0;i<n;i++) {
        if (shoe.remaining<6) shoe=engine.makeShoe();
        counts[engine.dealHand(shoe, random).winner]++;
    }
    for (const code of ['B','P','T']) assert.ok(Math.abs(counts[code]/n-engine.REFERENCE_8_DECK[code])<.008,`${code}: ${counts[code]/n}`);
});
test('bead plate preserves ties and big road places tie overlays', () => {
    const a=roads.build(['T','T','B','B','T','P','T']);
    assert.deepEqual(a.bead.map(c=>c.code), ['T','T','B','B','T','P','T']);
    assert.deepEqual(a.big.map(c=>[c.code,c.col,c.row,c.ties]),[
        ['B',0,0,2],['B',0,1,1],['P',1,0,1]
    ]);
    assert.equal(roads.build(['T','T']).unplacedLeadingTies, 2);
});
test('long banker dragon tail does not overwrite other cells; derived marks never claim B/P', () => {
    const a=roads.build([...'B'.repeat(12),...'P'.repeat(2),...'B'.repeat(10),...'P'.repeat(4), 'T']);
    const coords=a.big.map(c=>`${c.col}/${c.row}`);
    assert.equal(new Set(coords).size,coords.length);
    assert.ok(Math.max(...a.big.map(c=>c.col))>=6);
    for (const road of [a.bigEyeBoy,a.smallRoad,a.cockroachRoad])
        assert.ok(road.every(c=>c.code==='R'||c.code==='U'));
    assert.throws(() => roads.build(['X']),/B\/P\/T/);
});
test('walk-forward candidate uses no future result; metrics count only decisive rounds', () => {
    const hist = Array.from({length: 400},(_,i)=>i%9===0?'T': i%3===0?'P':'B');
    const result=analysis.analyze(hist);
    assert.equal(result.recorded,400);
    assert.equal(result.decisive+result.ties,400);
    assert.equal(result.backtest.observations, Math.min(result.decisive-40,240));
    assert.ok(Math.abs(Object.values(result.patternScore).reduce((a,b)=>a+b)-1)<1e-9);
    assert.equal(result.caveat.includes('不'),true);
});
