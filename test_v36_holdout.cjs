'use strict';
/* Fixed seeded demonstration. Test set was never used to choose a method. */
const assert=require('node:assert/strict');
const Engine=require('./baccarat_engine.js'),Lab=require('./baccarat_methods.js');
const records=[];
for(const seed of [123,456,789,20261027]){
  const rng=Engine.seededRandom(seed);let shoe=Engine.makeShoe(8);
  const history=[];
  for(let i=0;i<600;i++){
    if(shoe.remaining<6)shoe=Engine.makeShoe(8);
    history.push(Engine.dealHand(shoe,rng).winner);
  }
  const report=Lab.run(history,{limit:600}),
    chosen=report.methods.find(x=>x.id===report.chosenByValidation),
    banker=report.methods.find(x=>x.id==='always_b');
  assert.ok(chosen&&banker);
  assert.ok(chosen.validation.decisive>=25);
  assert.equal(report.testStart, undefined); // no future target labels are persisted for live bets
  assert.equal(report.assessment99,'not_demonstrated');
  records.push({seed,selection:chosen.id,selectionLabel:chosen.name,
    validationRate:chosen.validation.hitRate,
    testRate:chosen.test.hitRate,
    baselineTestRate:banker.test.hitRate,
    testDecisive:chosen.test.decisive,
    coverage:chosen.test.coverage});
}
console.log(JSON.stringify({description:'four fixed, simulated 600-hand holdouts; not live data',records},null,2));
