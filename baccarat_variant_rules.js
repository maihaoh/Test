/* V36 variant settlement reference. This is NOT wagering software.
 * Only outcomes with complete card-point details can settle side bets here.
 * Pair/perfect-pair require rank and suit; never infer from point totals.
 * Official references: https://wizardofodds.com/games/ez-baccarat/
 * https://wizardofodds.com/games/baccarat/appendix/6/
 */
(function(root,factory){
  'use strict';const a=factory();
  if(typeof module==='object'&&module.exports)module.exports=a;
  if(root)root.BaccaratVariantRules=a;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const PAYOUTS=Object.freeze({dragon7:40,panda8:25,super6:12});
  function check(outcome){
    if(!outcome||!['B','P','T'].includes(outcome.winner)||
      !Array.isArray(outcome.playerCards)||!Array.isArray(outcome.bankerCards)||
      ![2,3].includes(outcome.playerCards.length)||![2,3].includes(outcome.bankerCards.length)||
      !Number.isInteger(outcome.playerTotal)||!Number.isInteger(outcome.bankerTotal)||
      outcome.playerTotal<0||outcome.playerTotal>9||outcome.bankerTotal<0||outcome.bankerTotal>9)
      throw new TypeError('Full resolved Baccarat hand with player/banker card points required');
    if(outcome.playerCards.some(x=>!Number.isInteger(x)||x<0||x>9)||
      outcome.bankerCards.some(x=>!Number.isInteger(x)||x<0||x>9)||
      outcome.playerCards.reduce((a,b)=>a+b,0)%10!==outcome.playerTotal||
      outcome.bankerCards.reduce((a,b)=>a+b,0)%10!==outcome.bankerTotal||
      (outcome.bankerTotal>outcome.playerTotal?'B':outcome.playerTotal>outcome.bankerTotal?'P':'T')!==outcome.winner)
      throw new TypeError('Inconsistent card points and winner');
    return outcome;
  }
  function validateBet(bet){
    if(!['B','P','T','dragon7','panda8','super6'].includes(bet))throw new TypeError('Unsupported bet type');
  }
  function resolve(bet,outcome,config={}){
    validateBet(bet);check(outcome);
    const variant=config.variant||'standard';
    if(!['standard','super6','ez'].includes(variant))throw new TypeError('Unsupported variant');
    const tiePayout=config.tiePayout??8;
    if(!Number.isFinite(tiePayout)||tiePayout<0||tiePayout>100)throw new RangeError('tiePayout must be 0..100');
    const bankerCommission=config.bankerCommission??.05;
    if(!Number.isFinite(bankerCommission)||bankerCommission<0||bankerCommission>1)throw new RangeError('bankerCommission must be 0..1');
    if(bet==='dragon7')return outcome.winner==='B'&&outcome.bankerCards.length===3&&outcome.bankerTotal===7?PAYOUTS.dragon7:-1;
    if(bet==='panda8')return outcome.winner==='P'&&outcome.playerCards.length===3&&outcome.playerTotal===8?PAYOUTS.panda8:-1;
    if(bet==='super6')return outcome.winner==='B'&&outcome.bankerTotal===6?PAYOUTS.super6:-1;
    if(bet==='T')return outcome.winner==='T'?tiePayout:-1;
    if(outcome.winner==='T')return 0;
    if(bet!==outcome.winner)return -1;
    if(bet==='P')return 1;
    // Banker win settlement depends on the chosen table variant.
    if(variant==='super6')return outcome.bankerTotal===6?.5:1;
    if(variant==='ez')return outcome.bankerCards.length===3&&outcome.bankerTotal===7?0:1;
    return 1-bankerCommission;
  }
  return Object.freeze({PAYOUTS,check,resolve});
});
