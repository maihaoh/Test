/* V29 single-session manual entry and pre-result prediction ledger.
 * Legacy tables are read ONCE for migration, never merged, deleted or rewritten.
 * Three buttons record actual results. No network requests or gambling actions.
 */
(() => {
    'use strict';
    const KEY = 'baccarat_session_v29';
    const LEGACY = 'choice_manual_history_v1';
    const OLD_SELECTED = 'choice_manual_selected_v1';
    const MAX = 5000;
    const NAMES = {B:'\u5e84',P:'\u95f2',T:'\u548c'};
    const STRATEGIES = ['waiting','dragon','single','double','break','baseline','model','mixed'];
    let state, lastRaw = null, damaged = false, lastCorruptRaw = '', busy = false;
    const el = id => document.getElementById(id);
    function msg(text, error = false) {
        const p = el('bc-manual-message');
        if (p) {p.textContent = text; p.classList.toggle('is-error', error);}
    }
    const historyOf = s => s.records.map(r => r.result);
    const fresh = () => ({version:29,records:[],pending:window.BaccaratPredictor.makeForecast([])});
    function forecast(f, target) {
        if (f === null || f === undefined) return null;
        if (typeof f !== 'object' || !['B','P',null].includes(f.pick) || f.targetRound !== target ||
            typeof f.version !== 'string' || !STRATEGIES.includes(f.strategy) || typeof f.reason !== 'string')
            throw new Error('invalid_forecast');
        const counts = {};
        if (Number.isInteger(f.decisive) && Number.isInteger(f.ties) && f.decisive >= 0 && f.ties >= 0 && f.decisive + f.ties === target - 1) {
            counts.decisive = f.decisive; counts.ties = f.ties;
        }
        return {version:f.version.slice(0,60), targetRound:target, pick:f.pick, strategy:f.strategy,
            reason:f.reason.slice(0,280), recorded:target-1, ready:f.pick !== null, ...counts};
    }
    function validate(value) {
        if (!value || value.version !== 29 || !Array.isArray(value.records) || value.records.length > MAX)
            throw new Error('invalid_backup');
        const records = value.records.map((r,i) => {
            if (!r || !Object.hasOwn(NAMES, r.result)) throw new Error('invalid_result');
            return {result:r.result,forecast:forecast(r.forecast,i+1),
                enteredAt:typeof r.enteredAt === 'number' && Number.isFinite(r.enteredAt) ? r.enteredAt : null};
        });
        let pending = forecast(value.pending,records.length+1);
        if (!pending || pending.version !== window.BaccaratPredictor.VERSION)
            pending = window.BaccaratPredictor.makeForecast(records.map(r=>r.result));
        return {version:29,records,pending};
    }
    function legacySession(value, selected) {
        if (!value || value.version !== 1 || !value.tables || typeof value.tables !== 'object') throw new Error('invalid_legacy');
        // Select one existing session, not the combined histories of eight rooms.
        const keys = Object.keys(value.tables).filter(k => /^D5[1-8]$/.test(k));
        const key = keys.includes(selected) ? selected : keys.includes('D51') ? 'D51' : keys[0];
        const codes = value.tables[key];
        if (!Array.isArray(codes) || codes.length > MAX) throw new Error('invalid_legacy');
        window.BaccaratPredictor.validate(codes);
        return {version:29,records:codes.map(result => ({result,forecast:null,enteredAt:null})),
            pending:window.BaccaratPredictor.makeForecast(codes)};
    }
    function load() {
        let raw = null;
        try {
            raw = localStorage.getItem(KEY);
            lastRaw = raw;
            damaged = false;
            if (raw) {state = validate(JSON.parse(raw)); return;}
            const legacy = localStorage.getItem(LEGACY);
            if (legacy) {
                lastCorruptRaw = legacy;
                state = legacySession(JSON.parse(legacy),localStorage.getItem(OLD_SELECTED));
                // Save the new key only. All legacy data remains untouched.
                const next = JSON.stringify(state);
                localStorage.setItem(KEY,next); lastRaw = next;
                msg('\u5df2\u7ee7\u627f\u4e0a\u6b21\u9009\u62e9\u7684\u8bb0\u5f55\uff1b\u65e7\u5907\u4efd\u4fdd\u7559\u4e0d\u53d8\u3002');
            } else state = fresh();
        } catch (_) {
            damaged = true; lastCorruptRaw = raw || lastCorruptRaw;
            state = fresh();
            msg('\u672c\u5730\u8bb0\u5f55\u65e0\u6cd5\u8bfb\u53d6\uff0c\u5df2\u7981\u6b62\u8986\u76d6\u3002\u53ef\u5148\u5bfc\u51fa\u539f\u59cb\u5907\u4efd\u518d\u5bfc\u5165\u6709\u6548\u8bb0\u5f55\u3002',true);
        }
    }
    function commit(next, replacing = false) {
        if (damaged && !replacing) return false;
        try {
            const current = localStorage.getItem(KEY);
            if (current !== lastRaw) {
                load(); render(); msg('\u5176\u4ed6\u6807\u7b7e\u9875\u5df2\u66f4\u65b0\uff0c\u5df2\u540c\u6b65\uff1b\u8bf7\u91cd\u65b0\u786e\u8ba4\u672c\u6b21\u64cd\u4f5c\u3002',true); return false;
            }
            const serialized = JSON.stringify(next);
            localStorage.setItem(KEY,serialized);
            lastRaw = serialized; state = next; damaged = false;
            return true;
        } catch (_) {msg('\u4fdd\u5b58\u5931\u8d25\uff0c\u672c\u6b21\u672a\u5199\u5165\uff0c\u539f\u8bb0\u5f55\u4e0d\u53d8\u3002',true);return false;}
    }
    async function mutate(action) {
        if (busy) return;
        busy = true;
        try {
            if (navigator.locks) await navigator.locks.request('baccarat-v29-write', action);
            else action();
        } catch (_) {msg('\u64cd\u4f5c\u5931\u8d25\uff0c\u539f\u8bb0\u5f55\u4fdd\u7559\u3002',true);}
        finally {busy = false;}
    }
    function mark(code, round, isPrediction = false) {
        const p = document.createElement('span');
        p.className = 'bc-ledger-token ' + (code ? `is-${code}` : 'is-empty');
        p.textContent = code ? NAMES[code] : '\u2014';
        p.title = `\u7b2c ${round} \u5c40${isPrediction?'\u9884\u6d4b':'\u5f00\u5956'}\uff1a${code?NAMES[code]:'\u672a\u8bb0\u5f55 / \u89c2\u5bdf'}`;
        return p;
    }
    function renderLedger() {
        const node = el('bc-ledger'); if (!node) return;
        const fragment = document.createDocumentFragment();
        for (const [i,label] of ['\u5c40\u6570','\u5f00\u5956','\u9884\u6d4b'].entries()) {
            const p=document.createElement('span');p.className='bc-ledger-label';p.style.gridRow=String(i+1);p.textContent=label;fragment.appendChild(p);
        }
        const start = Math.max(0,state.records.length-40);
        for (let i=start;i<state.records.length;i++) {
            const r=state.records[i], col=i-start+2;
            const num=document.createElement('span');num.className='bc-ledger-round';num.textContent=String(i+1);num.style.gridRow='1';num.style.gridColumn=String(col);fragment.appendChild(num);
            const actual=mark(r.result,i+1);actual.style.gridRow='2';actual.style.gridColumn=String(col);fragment.appendChild(actual);
            const pred=mark(r.forecast?.pick,i+1,true);pred.style.gridRow='3';pred.style.gridColumn=String(col);fragment.appendChild(pred);
        }
        node.replaceChildren(fragment);node.scrollLeft=node.scrollWidth;
    }
    function grid(id,cells) {
        const node=el(id);if (!node) return;
        const max=Math.max(0,...cells.map(c=>c.col)), first=Math.max(0,max-39), fragment=document.createDocumentFragment();
        node.style.gridTemplateColumns=`repeat(${Math.max(10,max-first+1)},24px)`;
        for (const c of cells) {
            if (c.col<first) continue;
            const p=document.createElement('span');p.className=`bc-road-mark bc-road-${c.code}`;
            p.style.gridColumn=String(c.col-first+1);p.style.gridRow=String(c.row+1);
            p.textContent=Object.hasOwn(NAMES,c.code)?NAMES[c.code]:'\u2022';
            if (c.ties) {const t=document.createElement('small');t.className='bc-road-ties';t.textContent=String(c.ties);p.appendChild(t);p.title=`\u548c ${c.ties} \u6b21`;}
            fragment.appendChild(p);
        }
        node.replaceChildren(fragment);
        const scroll=node.parentElement;if(scroll)scroll.scrollLeft=scroll.scrollWidth;
    }
    function render() {
        if (!state) return;
        const codes=historyOf(state), counts={B:0,P:0,T:0}; codes.forEach(c=>counts[c]++);
        window.BaccaratPredictor.render(codes,state.pending);
        const summary=el('bc-session-summary');if(summary)summary.textContent=`\u5df2\u5f55 ${codes.length} \u5c40 \u00b7 \u5e84 ${counts.B} / \u95f2 ${counts.P} / \u548c ${counts.T}`;
        document.querySelectorAll('[data-bc-result]').forEach(b=>b.disabled=damaged || codes.length>=MAX);
        const undo=el('bc-manual-undo'),clear=el('bc-manual-clear');
        if(undo)undo.disabled=damaged || !codes.length;if(clear)clear.disabled=damaged || !codes.length;
        const roads=window.BaccaratRoads?.build(codes);
        if(roads){grid('bc-road-big',roads.big);grid('bc-road-bead',roads.bead);grid('bc-road-eye',roads.bigEyeBoy);grid('bc-road-small',roads.smallRoad);grid('bc-road-cockroach',roads.cockroachRoad);}
        renderLedger();
        try {
            if (typeof window.CustomEvent === 'function')
                window.dispatchEvent(new window.CustomEvent('baccarat:history-updated'));
        } catch (_) {}
    }
    window.choiceManualAdd = code => mutate(() => {
        if(damaged || !Object.hasOwn(NAMES,code) || state.records.length>=MAX)return;
        const next=JSON.parse(JSON.stringify(state));
        next.records.push({result:code,forecast:{...state.pending},enteredAt:Date.now()});
        next.pending=window.BaccaratPredictor.makeForecast(historyOf(next));
        if(commit(next)){render();msg(`\u7b2c ${next.records.length} \u5c40 ${NAMES[code]} \u5df2\u4fdd\u5b58\uff0c\u4e0b\u5c40\u53c2\u8003\u5df2\u66f4\u65b0\u3002`);}
    });
    window.choiceManualUndo = () => mutate(() => {
        if(damaged || !state.records.length)return;
        const next=JSON.parse(JSON.stringify(state)); const removed=next.records.pop();
        next.pending=removed.forecast && removed.forecast.version===window.BaccaratPredictor.VERSION ? removed.forecast : window.BaccaratPredictor.makeForecast(historyOf(next));
        if(commit(next)){render();msg('\u5df2\u64a4\u9500\u4e0a\u5c40\uff0c\u6062\u590d\u5230\u8f93\u5165\u524d\u7684\u9884\u6d4b\u3002');}
    });
    window.choiceManualClear = () => mutate(() => {
        if(damaged || !state.records.length)return;
        if(!confirm('\u5f00\u59cb\u65b0\u724c\u9774\u4f1a\u6e05\u7a7a\u5f53\u524d\u8bb0\u5f55\u4e0e\u9884\u6d4b\u5bf9\u7167\u3002\u9700\u4fdd\u7559\u65f6\u8bf7\u5148\u5bfc\u51fa\u5907\u4efd\u3002\u786e\u5b9a\uff1f'))return;
        if(commit(fresh())){render();msg('\u65b0\u724c\u9774\u5df2\u5f00\u59cb\u3002');}
    });
    window.choiceManualExport = () => {
        const raw = damaged ? lastCorruptRaw : JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2);
        const url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));
        const a=document.createElement('a');a.href=url;a.download=damaged?'baccarat-recovery-raw.json':'baccarat-v29-backup.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    window.choiceManualImport = async event => {
        const input=event?.target, file=input?.files?.[0];if(!file)return;
        try {
            if(file.size>3*1024*1024)throw new Error('too_large');
            const data=JSON.parse(await file.text());
            const incoming=data.version===1?legacySession(data,localStorage.getItem(OLD_SELECTED)):validate(data);
            if(!confirm(`\u5bfc\u5165 ${incoming.records.length} \u5c40\u5e76\u66ff\u6362\u5f53\u524d\u8bb0\u5f55\uff1f`))return;
            await mutate(()=>{if(commit(incoming,true)){render();msg('\u5bfc\u5165\u6210\u529f\u3002');}});
        } catch(_){msg('\u5bfc\u5165\u5931\u8d25\uff1a\u8bf7\u4f7f\u7528\u6709\u6548 JSON \u5907\u4efd\uff08\u6700\u591a 5000 \u5c40\uff09\u3002\u539f\u8bb0\u5f55\u4e0d\u53d8\u3002',true);}
        finally{if(input)input.value='';}
    };
    function init(){
        if(!el('bc-predict-main'))return;
        load();render();
        window.addEventListener('storage', e=>{if(e.key===KEY){load();render();}});
    }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
