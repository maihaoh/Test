"""Offline Chromium smoke test. Static HTML + exact bundled JS/CSS, no network.
Fixtures are synthetic and do not imply authenticated D51 acquisition.
"""
from __future__ import annotations
import json,re,random
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent
OUT=Path('/mnt/data')
HTML=re.sub(r'<script[^>]*src="[^"]+"[^>]*></script>','',(ROOT/'index.html').read_text(),flags=re.I)
HTML=re.sub(r'<link\s+href="style.css[^"]*"\s+rel="stylesheet"\s*/?>','',HTML,flags=re.I)
ASSETS=['baccarat_analysis.js','baccarat_engine.js','baccarat_roads.js','baccarat_variant_rules.js','baccarat_predictor.js',
        'choice_manual.js','choice_live.js','baccarat_methods.js','baccarat_lab_ui.js']
report=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    for device,width,height in [('desktop',1365,960),('mobile',390,844)]:
        page=browser.new_page(viewport={'width':width,'height':height}, device_scale_factor=1)
        errors=[]
        page.on('pageerror',lambda err:errors.append(str(err)[:170]))
        page.set_content(HTML,wait_until='domcontentloaded')
        page.add_style_tag(content=(ROOT/'style.css').read_text())
        randomizer=random.Random(20261027 if device=='desktop' else 20261028)
        def fixture(n):
            return ['B' if (x:=randomizer.random()) < .45859742 else 'P' if x < .90484403 else 'T' for _ in range(n)]
        page.evaluate('''({manual,choice}) => {
          const data=new Map();
          Object.defineProperty(window,'localStorage',{configurable:true,value:{
            getItem(key){return data.has(key)?data.get(key):null},
            setItem(key,value){data.set(String(key),String(value))},
            removeItem(key){data.delete(key)},
            key(index){return [...data.keys()][index]||null},
            clear(){data.clear()},
            get length(){return data.size}
          }});
          localStorage.setItem('baccarat_session_v29',JSON.stringify({version:29,records:manual.map(result=>({result})),pending:null}));
          localStorage.setItem('choice_d51_v34_history',JSON.stringify({codes:choice,savedAt:Date.now()}));
          window.fetch=async()=>({ok:true,json:async()=>({baccarat:{rooms:{}}})});
          window.switchMainTab=()=>{};
        }''',{ 'manual': fixture(200), 'choice': fixture(190) })
        for asset in ASSETS:page.add_script_tag(content=(ROOT/asset).read_text())
        page.wait_for_function('''() => document.querySelectorAll('[data-bc-lab-source=manual] .bc-lab-table tbody tr').length===45''',timeout=15000)
        page.wait_for_function('''() => document.querySelectorAll('[data-bc-lab-source=choice] .bc-lab-table tbody tr').length===45''',timeout=15000)
        assert page.locator('#build-version').inner_text()=='UI V37'
        assert page.evaluate('window.BaccaratMethods.STRATEGIES.length')==45
        assert page.evaluate('typeof window.BaccaratVariantRules.resolve')=='function'
        assert '样本：最近' in page.locator('[data-bc-lab-source=manual] .bc-lab-summary').inner_text()
        assert 'Choice D51' in page.locator('[data-bc-lab-source=choice] [data-bc-lab-note]').inner_text()
        assert page.locator('[data-bc-lab-source=manual] .bc-lab-catalog').count()==4
        page.evaluate('''() => {document.querySelectorAll('.main-section').forEach(x=>x.style.display='none');
          document.getElementById('baccarat-section').style.display='block';}''')
        page.locator('[data-bc-lab-source=manual]').scroll_into_view_if_needed()
        page.screenshot(path=str(OUT/f'V36-baccarat-{device}-preview.png'),full_page=True,animations='disabled')
        before=page.evaluate('JSON.parse(localStorage.getItem("baccarat_session_v29")).records.length')
        page.evaluate('window.choiceManualAdd("P")')
        page.wait_for_function('''() => JSON.parse(localStorage.getItem('baccarat_session_v29')).records.length===201''',timeout=8000)
        page.wait_for_function('''() => document.querySelector('[data-bc-lab-source=manual] [data-bc-lab-note]').textContent.includes('201 局')''')
        assert page.locator('[data-bc-lab-source=manual] .bc-lab-table tbody tr').count()==45
        report.append({'viewport':device,'status':'passed','manualBefore':before,'manualAfter':201,'choiceRows':45,'pageErrors':errors})
        page.close()
    browser.close()
print(json.dumps(report,ensure_ascii=False,indent=2))
