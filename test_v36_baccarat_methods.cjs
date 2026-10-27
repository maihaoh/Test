'use strict';
const assert=require('node:assert/strict');
const Engine=require('./baccarat_engine.js');
const Methods=require('./baccarat_methods.js');
const Roads=require('./baccarat_roads.js');
const Variants=require('./baccarat_variant_rules.js');
const {performance}=require('node:perf_hooks');
let checks=0;
function check(ok,msg){assert.ok(ok,msg);checks++;}
function equal(a,b,msg){assert.deepEqual(a,b,msg);checks++;}

check(Methods.STRATEGIES.length>=40,'at least 40 comparable road methods');
check(Methods.FORMATS.length>=10,'rules catalog');
check(Methods.BETS.length>=20,'main/side bet catalog');
check(Methods.ROADS.length>=5,'roads catalog');
check(Methods.STAKING.length>=10,'staking catalog');
equal(new Set(Methods.STRATEGIES.map(x=>x.id)).size,Methods.STRATEGIES.length,'unique ids');
for(const h of [[],['T','T','T'],['B','B','B'],['P','B','P','B'],['B','B','P','P','B','B'],['T','P','B','T','T','B']]){
  for(const method of Methods.STRATEGIES){
    const prior=h.slice();const got=method.predict(prior);
    check(got===null||got==='B'||got==='P'||got==='T',method.id+' invalid pick');
    equal(prior,h,'strategy must not mutate history');
  }
}
const get=id=>Methods.STRATEGIES.find(s=>s.id===id).predict;
equal(get('dragon_4')(['B','B','B','T','B']),'B','ties do not break banker streak');
equal(get('chop_5')(['B','P','B','T','P','B']),'P','ties do not break single-jump');
equal(get('double_2')(['B','B','P','P','B','B']),'P','double jumps alternation');
equal(get('triple_2')(['B','B','B','P','P','P','B']),'B','triple group fill');
equal(get('always_t')([]),'T');
equal(Methods.settle('B','T'),{status:'PUSH',net:0,hit:false,decisive:false});
equal(Methods.settle('B','B').net,.95);
equal(Methods.settle('T','T').net,8);
equal(Methods.settle('T','B').net,-1);
for(const invalid of [null,'BBB',[1],['X']]){
  assert.throws(()=>Methods.run(invalid));checks++;
}
for(const seed of [1,2,3,20,100,2026]){
  const rng=Engine.seededRandom(seed),shoes=[],history=[];
  let shoe=Engine.makeShoe(8);
  for(let i=0;i<350;i++){
    if(shoe.remaining<6)shoe=Engine.makeShoe(8);
    const o=Engine.dealHand(shoe,rng);history.push(o.winner);
    check(['B','P','T'].includes(o.winner),'valid outcome');
    check(o.playerTotal>=0&&o.playerTotal<=9,'player points');
    check(o.bankerTotal>=0&&o.bankerTotal<=9,'banker points');
  }
  const r=Roads.build(history);
  check(r.bead.length===350,'bead preserves ties');
  check(r.big.length===history.filter(x=>x!=='T').length,'big road decisive count');
  const audit=Methods.run(history,{limit:600});
  check(audit.methodCount===Methods.STRATEGIES.length,'audit every method');
  equal(audit.assessment99,'not_demonstrated');
  for(const row of audit.methods){
    const all=row.all;
    check(all.actions+all.pass===all.rounds,'pass coverage');
    check(all.hit+all.miss+all.push===all.actions,'settled accounting');
    check(all.hitRate===null||(all.hitRate>=0&&all.hitRate<=1),'hit rate range');
    check(row.validation.rounds+row.test.rounds<=all.rounds,'time split');
    check(row.test.actions>=0,'action count');
    if(row.test.decisive>0)check(row.test.ci95.low<=row.test.hitRate+1e-9&&row.test.ci95.high>=row.test.hitRate-1e-9,'Wilson bounds');
  }
  // Strict no-lookahead: change the outcome at i, all predictions up to i
  // must be exactly identical when previous history is unchanged.
  for(let i=20;i<110;i+=7){
    const prev=history.slice(0,i),changed=history.slice();
    changed[i]=changed[i]==='B'?'P':'B';
    for(const method of Methods.STRATEGIES){
      equal(method.predict(prev),method.predict(changed.slice(0,i)),method.id+' future leak');
    }
  }
}
// Paytable and side bet variants require complete resolved card-point hands.
const bankerSix={playerCards:[2,2,0],bankerCards:[2,1,3],playerTotal:4,bankerTotal:6,winner:'B'};
const dragon7={playerCards:[2,2,6],bankerCards:[3,2,2],playerTotal:0,bankerTotal:7,winner:'B'};
const panda8={playerCards:[2,1,5],bankerCards:[2,1,2],playerTotal:8,bankerTotal:5,winner:'P'};
equal(Variants.resolve('B',bankerSix,{variant:'standard'}),.95);
equal(Variants.resolve('B',bankerSix,{variant:'super6'}),.5);
equal(Variants.resolve('B',dragon7,{variant:'ez'}),0);
equal(Variants.resolve('dragon7',dragon7),40);
equal(Variants.resolve('panda8',panda8),25);
equal(Variants.resolve('super6',bankerSix),12);
equal(Variants.resolve('T',panda8),-1);
equal(Variants.resolve('P',panda8),1);
equal(Variants.resolve('B',panda8),-1);
assert.throws(()=>Variants.resolve('perfectPair',dragon7));checks++;
assert.throws(()=>Variants.resolve('B',{...bankerSix,bankerTotal:8}));checks++;
// Reference 8-deck outcome distribution via fixed seeded genuine card draws
// (not synthetic B/P labels). Accuracy of the baseline is nowhere near 99%.
const start=performance.now();let counts={B:0,P:0,T:0};
const nets={bankerStandard:0,bankerSuper6:0,bankerEZ:0,dragon7:0,panda8:0};
const seeds=[1,2,3,20261027,1000],trialsPerSeed=200000;
for(const seed of seeds){
 const random=Engine.seededRandom(seed);let shoe=Engine.makeShoe(8);
 for(let i=0;i<trialsPerSeed;i++){
   if(shoe.remaining<6)shoe=Engine.makeShoe(8);
   const deal=Engine.dealHand(shoe,random);
   counts[deal.winner]++;
   nets.bankerStandard+=Variants.resolve('B',deal,{variant:'standard'});
   nets.bankerSuper6+=Variants.resolve('B',deal,{variant:'super6'});
   nets.bankerEZ+=Variants.resolve('B',deal,{variant:'ez'});
   nets.dragon7+=Variants.resolve('dragon7',deal);
   nets.panda8+=Variants.resolve('panda8',deal);
 }
}
const trials=seeds.length*trialsPerSeed;
const prob=Object.fromEntries(Object.entries(counts).map(([key,n])=>[key,n/trials]));
for(const k of ['B','P','T'])check(Math.abs(prob[k]-Engine.REFERENCE_8_DECK[k])<.003,`8-deck rate ${k}`);
check(counts.B/(counts.B+counts.P)<.55,'Always Banker should not be close to 99%');
const simulatedEV=Object.fromEntries(Object.entries(nets).map(([k,v])=>[k,v/trials]));
const expectedEV={bankerStandard:-.010579,bankerSuper6:-.014581,bankerEZ:-.010183,dragon7:-.076113,panda8:-.101876};
for(const k of Object.keys(simulatedEV))check(Math.abs(simulatedEV[k]-expectedEV[k])<.025,`variant EV ${k}`);
console.log(JSON.stringify({version:'V36',assertions:checks,status:'passed',strategies:Methods.STRATEGIES.length,
  formats:Methods.FORMATS.length,bets:Methods.BETS.length,roads:Methods.ROADS.length,staking:Methods.STAKING.length,
  simulatedHands:trials,frequencies:prob,bankerDecisiveRate:counts.B/(counts.B+counts.P),simulatedEV,
  simulationTimeMs:Math.round(performance.now()-start)},null,2));
