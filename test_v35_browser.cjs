'use strict';
const assert = require('node:assert/strict');
const BaccaratRoads=require('./baccarat_roads.js');
const Predictor=require('./baccarat_predictor.js');
const Wingo=require('./wingo_consistency.js');
const {runInNewContext}=require('node:vm');
const {readFileSync}=require('node:fs');
const seq=s=>[...s];
function roadExpect(input, strategy, pick) {
  const p=Predictor.makeForecast(seq(input));
  assert.equal(p.strategy,strategy,input);
  assert.equal(p.pick,pick,input);
  assert.equal(p.targetRound,input.length+1,input);
}
roadExpect('','waiting',null);
roadExpect('TTT','waiting',null);
roadExpect('BBBB','dragon','B');
roadExpect('BBBTTB','dragon','B');
roadExpect('BBBBP','break',null);
roadExpect('BPBPB','single','P');
roadExpect('BPBPBB','break',null);
roadExpect('BBPPBB','double','P');
roadExpect('BBPPBBP','double','P');
roadExpect('BBPPBBPPB','double','B');
roadExpect('BBPPBBPPP','break',null);
roadExpect('BPPB','baseline',null);
// Tie does not alter decisions while it does count as another actual hand.
const a=Predictor.makeForecast(seq('BPBPB'));
const t=Predictor.makeForecast(seq('BPBPTBTT'));
assert.equal(t.pick,a.pick);
assert.equal(t.strategy,a.strategy);
assert.equal(t.targetRound,9);
assert.equal(Predictor.settle('B','T').status,'TIE');
assert.equal(Predictor.settle(null,'B').status,'PASS');
// Exact road display: leading ties overlay the first decisive result; subsequent
// ties overlay the prior decisive result; every tie remains in the bead road.
const roads=BaccaratRoads.build(seq('TBTPPTT'));
assert.equal(roads.bead.length,7);
assert.deepEqual(roads.big.map(c=>c.code),['B','P','P']);
assert.deepEqual(roads.big.map(c=>c.ties),[2,0,2]);
for(let s=1;s<=60;s++) {
  let x=s; const hist=[];
  for(let k=0;k<130;k++) {
    x=(Math.imul(1664525,x)+1013904223)>>>0;
    hist.push(['B','P','T'][x%3]);
  }
  const r=BaccaratRoads.build(hist);
  const keyed=new Set(r.big.map(c=>c.col+','+c.row));
  assert.equal(keyed.size,r.big.length);
  assert.ok(r.big.every(c=>c.row>=0&&c.row<6));
  // Retrospective evaluation must be pure prefix-only.
  const ev=Predictor.evaluate(hist);
  assert.equal(ev.rows.length,hist.length);
  for(let i=0;i<hist.length;i++)
    assert.equal(ev.rows[i].pick,Predictor.makeForecast(hist.slice(0,i)).pick);
}
for(const size of ['小','大']) {
  for(let s=1;s<=60;s++) {
    let x=s, history=[];
    for(let i=0;i<70;i++) {x=(Math.imul(1664525,x)+1013904223)>>>0;history.push(x%10);}
    const num=Wingo.chooseNumber(history,size);
    assert.equal(Wingo.sizeOf(num),size);
  }
}
assert.equal(Wingo.chooseNumber([2,3],'PASS'),null);
assert.equal(Wingo.immediateNextIssue('2026102201002','2026102201001'),true);
assert.equal(Wingo.immediateNextIssue('2026102201004','2026102201001'),false);
const pair=[{issue:'2026102201002',number:7},{issue:'2026102201001',number:2}];
assert.equal(Wingo.legitimateReview({fromIssue:'2026102201001',forecast:{size:'大',num:7}},pair),true);
assert.equal(Wingo.legitimateReview({fromIssue:'2026102201001',forecast:{size:'小',num:7}},pair),false);
assert.equal(Wingo.legitimateReview({fromIssue:'2026102201000',forecast:{size:'大',num:7}},pair),false);
// Wingo integration test: parse the production script without starting IO;
// every live pick must have a number consistent with its size.
const localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const document={readyState:'loading',addEventListener(){},getElementById(){return null;},querySelectorAll(){return [];}};
const ctx={document,window:{WingoConsistency:Wingo},localStorage,console,Date,Math,Intl,
  setTimeout,clearTimeout,setInterval:()=>0,clearInterval:()=>{},structuredClone,Map,Set,Number};
runInNewContext(readFileSync('./script.js','utf8'),ctx);
for(let s=1;s<=50;s++) {
  let x=s; const draws=[];
  for(let i=0;i<65;i++) {
    x=(Math.imul(1664525,x)+1013904223)>>>0;
    const number=x%10;
    draws.push({number,size:number>=5?'大':'小',issue:String(2026102201100-i)});
  }
  const p=runInNewContext('getLearnedPrediction',ctx)(draws);
  if(p.size==='PASS') assert.equal(p.num,null);
  else assert.equal(Wingo.sizeOf(p.num),p.size);
}
console.log('V35 baccarat/WinGo algorithm + roadmap regression tests passed');
