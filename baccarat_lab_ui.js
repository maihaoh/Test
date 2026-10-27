/* V36 read-only Baccarat research dashboards for manual and Choice D51 history.
 * No token access, no endpoint calls, no betting or WebSocket functions.
 */
(function(root){
  'use strict';
  if(typeof document==='undefined'||!root.BaccaratMethods)return;
  const methods=root.BaccaratMethods;
  const LABEL={B:'庄',P:'闲',T:'和'};
  const minSamples=100;
  let lastManSignature='',lastChoiceSignature='';
  const one=(tag,klass,value)=>{
    const el=document.createElement(tag);
    if(klass)el.className=klass;
    if(value!==undefined)el.textContent=String(value);
    return el;
  };
  const fmtRate=x=>x===null||x===undefined?'—':`${(x*100).toFixed(2)}%`;
  const fmtNet=n=>`${n>=0?'+':''}${n.toFixed(2)}`;
  function safeCodes(list){return Array.isArray(list)&&list.every(c=>c==='B'||c==='P'||c==='T')?list.slice(0,5000):[];}
  function manual(){
    try {
      const state=JSON.parse(localStorage.getItem('baccarat_session_v29')||'null');
      return safeCodes(state?.records?.map(r=>r?.result));
    }catch{return [];}
  }
  function choice(){
    try {
      const current=root.getChoiceD51History?.();
      if(current?.codes?.length)return {codes:safeCodes(current.codes),source:current.source||'Choice D51'};
    }catch{}
    try {
      const state=JSON.parse(localStorage.getItem('choice_d51_v34_history')||'null');
      return {codes:safeCodes(state?.codes),source:'D51 本机历史缓存（非实时）'};
    }catch{return {codes:[],source:'等待 Choice D51 的真实开奖结果'};}
  }
  function catalog(container,kind,items){
    const details=one('details','bc-lab-catalog');
    details.appendChild(one('summary','',`${kind}（${items.length} 类）`));
    const list=one('div','bc-lab-catalog-items');
    for(const item of items){
      const row=one('div','bc-lab-catalog-item');
      row.appendChild(one('strong','',item.name));
      row.appendChild(one('p','',item.description||item.needs));
      list.appendChild(row);
    }
    details.appendChild(list);
    container.appendChild(details);
  }
  function draw(panel,force=false){
    const src=panel.dataset.bcLabSource;
    const data=src==='choice'?choice():{codes:manual(),source:'手动百家乐录入历史'};
    const codes=data.codes;
    // Signatures use only result codes; no user credentials are ever collected.
    const signature=`${codes.length}:${codes.slice(-180).join('')}:${codes.slice(0,40).join('')}`;
    if(!force&&panel.dataset.lastSignature===signature)return;
    panel.dataset.lastSignature=signature;
    const note=panel.querySelector('[data-bc-lab-note]');
    const output=panel.querySelector('[data-bc-lab-output]');
    if(!note||!output)return;
    note.textContent=`数据源：${data.source} · 共 ${codes.length} 局 · 只使用已有开奖结果（无真实牌面）`;
    output.replaceChildren();
    if(codes.length<100){
      output.appendChild(one('p','bc-lab-empty',`目前只有 ${codes.length} 局。建议先有至少 100 局才开始查看有限的历史对比；当前不输出可信命中率。`));
      return;
    }
    let audit;
    try{audit=methods.run(codes,{limit:600});}
    catch(error){output.appendChild(one('p','bc-lab-empty',`历史数据分析失败：${error.message}`));return;}
    const head=one('div','bc-lab-summary');
    const baseline=audit.methods.find(x=>x.id==='always_b');
    head.appendChild(one('div','',`已逐局检验 ${audit.methodCount} 种路法`));
    head.appendChild(one('div','',`样本：最近 ${audit.analyzedRoundCount} 局`));
    head.appendChild(one('div','',`恒庄基准（后25%）：${fmtRate(baseline?.test.hitRate)}`));
    head.appendChild(one('div','',`99% 实际预测：${audit.assessment99==='not_demonstrated'?'未验证达到':'仅出现样本内现象'}`));
    output.appendChild(head);
    const voting=audit.methods.filter(x=>!['always_b','always_p','always_t'].includes(x.id));
    const votes={B:voting.filter(x=>x.nextPick==='B').length,
      P:voting.filter(x=>x.nextPick==='P').length,
      PASS:voting.filter(x=>x.nextPick===null).length};
    output.appendChild(one('p','bc-lab-interpret',
      `本局路型意见：庄 ${votes.B} 种 / 闲 ${votes.P} 种 / 观察 ${votes.PASS} 种。多个方法高度相关，票数不是胜率、也不是下注建议。`));
    const chosen=audit.methods.find(x=>x.id===audit.chosenByValidation);
    const msg=one('p','bc-lab-interpret',chosen?
      `按验证区间预先选择：${chosen.name}。独立后25%：${fmtRate(chosen.test.hitRate)}（有效 ${chosen.test.decisive} 局），覆盖率 ${fmtRate(chosen.test.coverage)}。这不是下局胜率。`:
      '验证期样本不足，暂不选择任何路法。仅列出各方法的历史统计，不输出保证命中率。');
    output.appendChild(msg);
    const wrapper=one('div','bc-lab-table-scroll');
    const table=one('table','bc-lab-table');
    const header=one('thead');const tr=one('tr');
    for(const title of ['路法 / 理论假设','验证期命中¹','后25%命中¹','检验局数','覆盖率','单位净结果²','下局观察'])tr.appendChild(one('th','',title));
    header.appendChild(tr);table.appendChild(header);
    const body=one('tbody');
    const rows=audit.methods.slice().sort((a,b)=>{
      const l=(b.validation.ci95.low??-1)-(a.validation.ci95.low??-1);
      return l||a.id.localeCompare(b.id);
    });
    for(const item of rows){
      const line=one('tr',item.id===audit.chosenByValidation?'bc-lab-selected':'');
      const cells=[item.name, item.validation.decisive>=20?fmtRate(item.validation.hitRate):'样本不足',
        item.test.decisive>=20?fmtRate(item.test.hitRate):'样本不足',
        String(item.test.decisive),fmtRate(item.test.coverage),fmtNet(item.test.net),LABEL[item.nextPick]||'观察'];
      cells.forEach((cell,i)=>{
        const td=one('td','',cell);
        if(i===0)td.title=item.description;
        line.appendChild(td);
      });
      body.appendChild(line);
    }
    table.appendChild(body);wrapper.appendChild(table);output.appendChild(wrapper);
    output.appendChild(one('p','bc-lab-footnote','¹ 庄／闲：只在非和局计算方向命中；和局算走水。和注另行计算。只使用每局之前的数据，验证期选法，末25%检验。² 假定标准庄赢扣5%、闲赢1倍、和赢8倍，实际桌面规则不同需另测。'));
    output.appendChild(one('p','bc-lab-footnote','请勿把多个回测结果里最高的百分比当作下一局概率。只有庄／闲／和，无法验证对子、龙7、熊猫8、天牌或赔率变种。'));
  }
  function setup(panel){
    const holder=panel.querySelector('[data-bc-lab-library]');
    if(holder&&!holder.childElementCount){
      catalog(holder,'百家乐规则版本',methods.FORMATS);
      catalog(holder,'主注与边注',methods.BETS);
      catalog(holder,'标准路单与问路',methods.ROADS);
      catalog(holder,'投注金额系统（不改变牌局概率）',methods.STAKING);
      holder.appendChild(one('p','bc-lab-footnote',`另有 ${methods.STRATEGIES.length} 种可执行历史看路法。列表仅记录已研究的常见做法，不宣称覆盖全球全部商业品牌玩法。`));
    }
    panel.querySelector('[data-bc-lab-refresh]')?.addEventListener('click',()=>draw(panel,true));
    draw(panel,true);
  }
  function refreshAll(force){
    document.querySelectorAll('[data-bc-lab-source]').forEach(p=>draw(p,force));
  }
  function initialize(){
    document.querySelectorAll('[data-bc-lab-source]').forEach(setup);
    root.addEventListener('baccarat:history-updated',()=>refreshAll(false));
    root.addEventListener('storage',e=>{
      if(['baccarat_session_v29','choice_d51_v34_history'].includes(e.key))refreshAll(true);
    });
    root.refreshBaccaratMethodsLab=()=>refreshAll(true);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize);
  else initialize();
})(typeof globalThis==='object'?globalThis:this);
