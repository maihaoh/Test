/* V36 Baccarat methods research lab. Historical hypotheses only; NOT a source
 * of next-hand winning probabilities. All methods read only prior B/P/T results.
 * Sources and limits: BACCARAT-RESEARCH-V36.md.
 */
(function(root,factory){
  'use strict';
  const api=factory(root?.BaccaratRoads || (typeof module==='object'&&module.exports?require('./baccarat_roads.js'):null));
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BaccaratMethods=api;
})(typeof globalThis==='object'?globalThis:this,function(Roads){
  'use strict';
  const VERSION='V36-methods-1', OTHER={B:'P',P:'B'}, VALID=new Set(['B','P','T']);
  const BASE=Object.freeze({B:.45859742,P:.44624661,T:.09515597});
  const MAX_ROUNDS=1200;
  function validate(history){
    if(!Array.isArray(history)||history.some(x=>!VALID.has(x)))throw new TypeError('history must contain only B/P/T');
    return history;
  }
  function dec(history){return history.filter(x=>x!=='T');}
  function runs(history){const out=[];for(const c of history){const p=out.at(-1);if(p&&p.code===c)p.length++;else out.push({code:c,length:1});}return out;}
  const last=h=>h.at(-1)||null;
  function streak(h,n,direction='follow'){
    if(h.length<n||runs(h).at(-1).length<n)return null;
    return direction==='follow'?last(h):OTHER[last(h)];
  }
  function alternating(h,n,follow=true){
    if(h.length<n)return null;
    for(let i=h.length-n+1;i<h.length;i++)if(h[i]===h[i-1])return null;
    return follow?OTHER[last(h)]:last(h);
  }
  function pairs(h,width,complete){
    const r=runs(h), current=r.at(-1);
    if(!current||!r.length||current.length>width)return null;
    let prior=0;
    for(let i=r.length-2;i>=0&&r[i].length===width;i--)prior++;
    if(prior<complete)return null;
    return current.length<width?current.code:OTHER[current.code];
  }
  function majority(h,size,minDelta=1,reverse=false){
    if(h.length<size)return null;
    const tail=h.slice(-size),b=tail.filter(x=>x==='B').length,p=tail.length-b;
    if(Math.abs(b-p)<minDelta)return null;
    const choice=b>p?'B':'P';return reverse?OTHER[choice]:choice;
  }
  function weighted(h,size,reverse=false){
    if(h.length<size)return null;
    const sub=h.slice(-size);let b=0,p=0;
    sub.forEach((c,i)=>{if(c==='B')b+=i+1;else p+=i+1;});
    if(Math.abs(b-p)<size/3)return null;
    const choice=b>p?'B':'P';return reverse?OTHER[choice]:choice;
  }
  function markov(h,order,minSupport){
    if(h.length<order+minSupport)return null;
    const target=h.slice(-order).join(''),cnt={B:0,P:0};
    for(let i=order;i<h.length;i++){
      if(h.slice(i-order,i).join('')===target)cnt[h[i]]++;
    }
    if(cnt.B+cnt.P<minSupport||Math.abs(cnt.B-cnt.P)<Math.max(2,(cnt.B+cnt.P)*.10))return null;
    return cnt.B>cnt.P?'B':'P';
  }
  function repeatBlock(h,size){
    if(h.length<size*2)return null;
    for(let i=0;i<size;i++)if(h[h.length-size+i]!==h[h.length-2*size+i])return null;
    return h[h.length-size];
  }
  function breaks(h,size,follow=true){
    const r=runs(h);if(r.length<2)return null;
    const before=r.at(-2),current=r.at(-1);
    if(before.length<size||current.length!==1)return null;
    return follow?current.code:OTHER[current.code];
  }
  function derived(h,roadName){
    if(!Roads||h.length<12)return null;
    const prev=Roads.build(h)[roadName],code=prev.at(-1)?.code;
    if(code!=='R'&&code!=='U')return null;
    const b=Roads.build([...h,'B'])[roadName],p=Roads.build([...h,'P'])[roadName];
    const markB=b.length>prev.length?b.at(-1)?.code:null;
    const markP=p.length>prev.length?p.at(-1)?.code:null;
    if(markB===markP||!markB||!markP)return null;
    return markB===code?'B':markP===code?'P':null;
  }
  const strategies=[];
  function add(id,name,group,description,fn){
    strategies.push(Object.freeze({id,name,group,description,predict:(history)=>{
      const d=dec(history),r=fn(d,history);
      return r==='B'||r==='P'||r==='T'?r:null;
    }}));
  }
  add('always_b','恒庄基准','数学基准','八副牌庄注；用于衡量其它看路法是否真正优于基准。',()=> 'B');
  add('always_p','恒闲基准','数学基准','一直看闲，用作对照而非优势策略。',()=> 'P');
  add('always_t','恒和基准','数学基准','和局独立边注，中奖率和净收益与庄闲不可混淆。',()=> 'T');
  add('follow_last','顺上局','跟路','上一局非和结果是什么，就假设下一次仍是什么。',h=>last(h));
  add('reverse_last','反上局','反路','上一局非和结果反向。',h=>OTHER[last(h)]||null);
  for(const n of [2,3,4,5,6])add(`dragon_${n}`,`长龙顺路 ≥${n}`,'长龙',`最近同边连续至少${n}次，观察延续假设。`,h=>streak(h,n));
  for(const n of [3,5,6])add(`dragon_fade_${n}`,`长龙反路 ≥${n}`,'长龙',`最近同边连续至少${n}次，观察反转假设。`,h=>streak(h,n,'reverse'));
  for(const n of [3,5,7])add(`chop_${n}`,`单跳顺路 ≥${n}`,'跳路',`最近${n}次庄闲交替，假设继续交替。`,h=>alternating(h,n));
  for(const n of [3,5])add(`chop_fade_${n}`,`单跳反路 ≥${n}`,'跳路',`最近${n}次庄闲交替，假设停止交替。`,h=>alternating(h,n,false));
  add('double_2','双跳（2对确认）','跳路','最近两对连续双跳，按当前段长度判断下次方向。',h=>pairs(h,2,2));
  add('double_3','双跳（3对确认）','跳路','要求三对双跳确认，避免过早认定形态。',h=>pairs(h,2,3));
  add('triple_2','三跳（2组三连）','跳路','要求两组连续三局同边，观察补足第三局或换边。',h=>pairs(h,3,2));
  add('triple_3','三跳（3组三连）','跳路','要求三组连续三局同边。',h=>pairs(h,3,3));
  add('break_follow_3','长龙断路后顺新边','断路','长龙中断后，观察新方向是否延续。',h=>breaks(h,3,true));
  add('break_follow_5','长长龙断路后顺新边','断路','更长的长龙首次换边后跟新边。',h=>breaks(h,5,true));
  add('break_fade_3','长龙断路后反向','断路','长龙中断后，观察回到原方向的假设。',h=>breaks(h,3,false));
  for(const n of [5,9,21,51])add(`majority_${n}`,`近期多数 ${n} 局`,'频率',`最近${n}次非和结果中较多的一边。`,h=>majority(h,n));
  for(const n of [9,21])add(`minority_${n}`,`近期少数 ${n} 局`,'频率',`最近${n}次非和结果中较少的一边；用于检测均值回归假设。`,h=>majority(h,n,1,true));
  for(const n of [12,30])add(`weighted_${n}`,`近因加权 ${n} 局`,'频率',`最近${n}局非和结果，越近权重越大。`,h=>weighted(h,n));
  for(const n of [12,30])add(`weighted_fade_${n}`,`近因反向 ${n} 局`,'频率',`最近${n}局加权方向的反向假设。`,h=>weighted(h,n,true));
  add('markov_1','转移统计 1 阶','转移','以最近1次非和结果匹配历史转移。',h=>markov(h,1,8));
  add('markov_2','转移统计 2 阶','转移','以最近2次非和结果匹配历史转移。',h=>markov(h,2,6));
  add('markov_3','转移统计 3 阶','转移','以最近3次非和结果匹配历史转移。',h=>markov(h,3,5));
  for(const n of [2,3,4,5])add(`echo_${n}`,`历史重复块 ${n} 步`,'重复','只有最近两个同样长度的块完全一致时才输出观察假设。'.replace('同样长度',`${n}步`),h=>repeatBlock(h,n));
  add('big_eye_consistency','大眼仔形态延续','衍生路','看红蓝的历史整齐度；不是红=庄或蓝=闲。',h=>derived(h,'bigEyeBoy'));
  add('small_road_consistency','小路形态延续','衍生路','按小路红蓝结构推演，无法分辨则观察。',h=>derived(h,'smallRoad'));
  add('cockroach_consistency','曱甴路形态延续','衍生路','按曱甴路历史形态推演，无法分辨则观察。',h=>derived(h,'cockroachRoad'));
  const STRATEGIES=Object.freeze(strategies);
  const FORMATS=Object.freeze([
    ['标准 Punto Banco','标准庄/闲/和、固定补牌规则、庄赢通常扣5%佣金。'],
    ['Mini Baccarat','小桌、加快发牌；通常仍是标准补牌规则。'],
    ['Big Table Baccarat','大桌形式，主注概率仍取决于同一补牌规则。'],
    ['Squeeze Baccarat','慢速揭牌互动，若牌规相同并不改变概率。'],
    ['Speed Baccarat','缩短下注和揭牌时间，不等于多出预测信息。'],
    ['Commission-Free / Super 6','常见规则：庄6赢付半额；需核对桌面具体派彩。'],
    ['EZ Baccarat','庄三张7赢时庄注走水，相关 Dragon 7 / Panda 8。'],
    ['Knockout Baccarat','标准主规则加 Natural、Winning Total 等边注，依具体桌规。'],
    ['Chemin de Fer','玩家参与筹码与补牌决策，与标准 Punto Banco 不完全同类。'],
    ['Baccarat Banque','传统银行家制版本，下注/玩家决策与 Punto Banco 不同。'],
    ['Three Card Baccarat','另一独立规则变体，不能套用标准补牌公式。'],
    ['Lightning / Multiplier Baccarat','额外随机赔率与特殊结算，须使用产品实际赔表。'],
    ['Other licensed variants','如 Gold、Power 98、7 Up、Double Fortune 等，需逐桌核对官方规则。']
  ].map(([name,description])=>Object.freeze({name,description})));
  const BETS=Object.freeze([
    ['庄 Banker','B/P/T 足以做基本输赢统计；赔付须配置。'],
    ['闲 Player','B/P/T 足以做基本输赢统计。'],
    ['和 Tie','B/P/T 足以做和注统计；8:1、9:1派彩不同。'],
    ['庄对 Banker Pair','需牌面点数/两张初始牌信息。'],
    ['闲对 Player Pair','需牌面点数/两张初始牌信息。'],
    ['任意对 Either Pair','需两边初始牌。'],
    ['完美对 Perfect Pair','需点数+花色等明细。'],
    ['大小 Big/Small','依据总发牌张数，不能从 B/P/T 单独推断。'],
    ['Dragon 7','需庄是否三张7获胜。'],
    ['Panda 8','需闲是否三张8获胜。'],
    ['Lucky / Super 6','需庄最终点数和具体赔表。'],
    ['Dragon Bonus','需天牌/点差等牌局明细和具体赔表。'],
    ['Natural 8 / Natural 9','需初始牌点数。'],
    ['Winning Total','需庄闲最终点数。'],
    ['Winning Side and Total','需胜方和最终点数。'],
    ['4-5-6 Cards','需本局实际发牌总数。'],
    ['Insurance','需发牌中间状态及特定桌规。'],
    ['Royal / Matching / Bonus Pair','需牌面花色和特定桌规。'],
    ['Perfect 9 / Lucky 99','需最终牌面及特定赔表。'],
    ['Banker Streak / Tie Max','专有边注；需产品规则与多局身份。'],
    ['Progressive / Jackpot','需额外随机/奖池/资格规则。']
  ].map(([name,needs])=>Object.freeze({name,needs})));
  const STAKING=Object.freeze([
    ['固定注 Flat','每次投注相同单位，便于衡量每单位成本。'],
    ['Martingale 倍投','输后翻倍；受资金和桌面上限限制，不能改变赔率。'],
    ['Reverse Martingale / Paroli','赢后加注，通常限定连胜轮数。'],
    ['Fibonacci 斐波那契','按亏损进级、获胜退级的筹码序列。'],
    ['D’Alembert 达朗贝尔','输加一单位、赢减一单位。'],
    ['Reverse D’Alembert','与达朗贝尔相反的筹码序列。'],
    ['Labouchère 拉布谢','划线首尾加和，获胜删数、亏损追加。'],
    ['Reverse Labouchère','反向拉布谢，需清楚说明上限。'],
    ['1-3-2-6','正向多段加码，常按连赢触发。'],
    ['1-2-3-5','另一加注阶梯，无法改变游戏优势。'],
    ['Oscar’s Grind','逐步尝试回补一个单位的加注法。'],
    ['Kelly / Fractional Kelly','必须有可验证的正期望胜率；无优势时理论下注为零。'],
    ['止损 / 止盈阈值','限制会话长度与亏损幅度，不改变下一手概率。'],
    ['选桌 / 限额 / 佣金比较','比较真实赔表、上限和成本，不是看路预测。']
  ].map(([name,description])=>Object.freeze({name,description})));
  const ROADS=Object.freeze([
    ['珠盘路 Bead Plate','逐局按时间顺序记录庄、闲、和。'],
    ['大路 Big Road','忽略和局的独立换边，和局覆盖上一个格子。'],
    ['大眼仔 Big Eye Boy','历史路柱结构的红/蓝规律性，而非庄/闲。'],
    ['小路 Small Road','与更早的大路结构比较；红/蓝不是庄/闲。'],
    ['曱甴路 Cockroach Pig','与更久之前路柱比较；红/蓝不是庄/闲。'],
    ['问路 Ask Road','对假设下局为庄/闲，观察衍生路会怎样变化；不是预测。']
  ].map(([name,description])=>Object.freeze({name,description})));
  function settle(pick,actual){
    if(pick===null)return {status:'PASS',net:0,hit:false,decisive:false};
    if(!VALID.has(actual)||!VALID.has(pick))throw new TypeError('invalid outcome');
    if(pick!=='T'&&actual==='T')return {status:'PUSH',net:0,hit:false,decisive:false};
    return actual===pick?{status:'HIT',net:pick==='B'?.95:pick==='P'?1:8,hit:true,decisive:true}:
      {status:'MISS',net:-1,hit:false,decisive:true};
  }
  function makeStats(){return {rounds:0,actions:0,hit:0,miss:0,push:0,pass:0,net:0,decisive:0,covered:0};}
  function observe(stats,pick,actual){
    stats.rounds++;
    if(pick===null){stats.pass++;return;}
    stats.actions++;
    const s=settle(pick,actual);
    if(s.status==='HIT')stats.hit++;
    if(s.status==='MISS')stats.miss++;
    if(s.status==='PUSH')stats.push++;
    if(s.decisive)stats.decisive++;
    stats.net+=s.net;
  }
  function wilson(hits,n){
    if(n<=0)return {low:null,high:null};
    const z=1.96,p=hits/n,d=1+z*z/n,
      m=(p+z*z/(2*n))/d,
      h=(z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n)))/d;
    return {low:Math.max(0,m-h),high:Math.min(1,m+h)};
  }
  function finalStats(s){
    const b=wilson(s.hit,s.decisive);
    return {...s,hitRate:s.decisive?s.hit/s.decisive:null,
      perHandHitRate:s.actions?s.hit/s.actions:null,
      coverage:s.rounds?s.actions/s.rounds:null,
      roi:s.actions?s.net/s.actions:null,
      ci95:b};
  }
  function run(history,opts={}){
    validate(history);
    const limit=opts.limit??MAX_ROUNDS;
    if(!Number.isInteger(limit)||limit<100||limit>5000)throw new RangeError('limit must be 100..5000');
    const h=history.slice(-limit);
    const n=h.length,trainEnd=Math.floor(n*.5),validationEnd=Math.floor(n*.75);
    const minPrefix=Math.max(20,opts.minPrefix??20);
    const results=STRATEGIES.map(s=>({id:s.id,name:s.name,group:s.group,
      validation:makeStats(),test:makeStats(),all:makeStats(),nextPick:s.predict(h)}));
    for(let i=minPrefix;i<n;i++){
      const prefix=h.slice(0,i),actual=h[i];
      for(const r of results){
        const method=STRATEGIES.find(s=>s.id===r.id);
        const pick=method.predict(prefix);
        observe(r.all,pick,actual);
        if(i>=trainEnd&&i<validationEnd)observe(r.validation,pick,actual);
        if(i>=validationEnd)observe(r.test,pick,actual);
      }
    }
    for(const r of results){r.all=finalStats(r.all);r.validation=finalStats(r.validation);r.test=finalStats(r.test);}
    // Freeze selection using only validation period. Never use held-out test for selecting.
    const eligible=results.filter(r=>r.id!=='always_t'&&r.validation.decisive>=25&&r.validation.coverage>=.15);
    eligible.sort((a,b)=>(b.validation.ci95.low??-1)-(a.validation.ci95.low??-1) || a.id.localeCompare(b.id));
    const selected=eligible[0]||null;
    const baseline=results.find(r=>r.id==='always_b');
    const chosenTest=selected?.test||null;
    const comparison=selected&&baseline&&chosenTest.decisive>=50&&baseline.test.decisive>=50?{
      selectedId:selected.id,
      deltaTestHitRate:chosenTest.hitRate-baseline.test.hitRate,
      baselineTestHitRate:baseline.test.hitRate,
      selectedTestHitRate:chosenTest.hitRate,
      status:chosenTest.hitRate>baseline.test.hitRate?'retrospectively_above_baseline':'not_above_baseline'
    }:null;
    return {version:VERSION,sourceRoundCount:history.length,analyzedRoundCount:n,
      skippedOldRounds:history.length-n,
      minPrefix,trainEnd,validationEnd,
      chosenByValidation:selected?.id||null,
      selectedTestComparison:comparison,
      assessment99:chosenTest&&chosenTest.decisive>=1000&&chosenTest.coverage>=.70&&chosenTest.hitRate>=.99?
        'threshold_observed_only_not_proven':'not_demonstrated',
      methodCount:results.length,methods:results,
      caveat:'按时间顺序逐局只看此前结果。验证期选方法，后25%只检验；无牌面不能验证边注。没有任何保证下一局命中率的方法。'};
  }
  return Object.freeze({VERSION,BASE,STRATEGIES,FORMATS,BETS,ROADS,MAX_ROUNDS,
    STAKING,validate,settle,run,wilson,finalStats});
});
