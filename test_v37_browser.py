"""V37 browser smoke test with synthetic API responses, never provider requests."""
from __future__ import annotations
import json, re
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
HTML = re.sub(r'<script[^>]*src="[^"]+"[^>]*></script>', '', (ROOT/'index.html').read_text(), flags=re.I)
HTML = re.sub(r'<link\s+href="style.css[^"]*"\s+rel="stylesheet"\s*/?>','',HTML,flags=re.I)
ASSETS = ['baccarat_analysis.js','baccarat_engine.js','baccarat_roads.js','baccarat_predictor.js','baccarat_methods.js','choice_live.js']
OUT = Path('/mnt/data')

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
    results=[]
    for device, w, h in [('desktop',1365,900),('mobile',390,844)]:
        page=browser.new_page(viewport={'width':w,'height':h}, device_scale_factor=1)
        errors=[]
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.set_content(HTML, wait_until='domcontentloaded')
        page.add_style_tag(content=(ROOT/'style.css').read_text())
        page.evaluate('''() => {
          window.__choiceTestMode = 'blocked';
          window.__choiceTestRows = [];
          window.fetch = async (url) => {
            if (String(url).includes('/api/choice-status')) {
              return {ok:true, json: async () => window.__choiceTestMode === 'blocked'
                ? {release:'V37',room:'D51',stage:'retry_wait',lastError:'provider_access_blocked',records:0,archiveSnapshots:0,retryInSeconds:300}
                : {release:'V37',room:'D51',stage:'d51_snapshot_received',lastError:'',records:window.__choiceTestRows.length,archiveSnapshots:2,retryInSeconds:null}};
            }
            return {ok:true,json:async()=>({baccarat:{rooms:{D51:window.__choiceTestRows}}})};
          };
        }''')
        for asset in ASSETS: page.add_script_tag(content=(ROOT/asset).read_text())
        page.wait_for_function('''() => document.querySelector('#choice-room-server-detail')?.textContent.includes('服务器访问被 Choice 提供方拒绝')''', timeout=8000)
        assert page.locator('#build-version').inner_text()=='UI V37'
        assert page.locator('#choice-room-count').inner_text()=='0'
        assert not page.locator('#choice-room-copy').count(), 'Console instructions should be gone'
        page.evaluate('''() => {
           window.__choiceTestMode = 'connected';
           window.__choiceTestRows = Array.from({length:30}, (_,i) => ({room:'D51',result: i%3===0 ? '和':i%2===0 ? '庄':'闲', game:i+1})).reverse();
        }''')
        page.evaluate('window.refreshChoiceRoom()')
        page.wait_for_function("() => document.querySelector('#choice-room-count')?.textContent==='30'", timeout=8000)
        assert '已取得 D51 有效历史' in page.locator('#choice-room-server-detail').inner_text()
        page.evaluate('''() => {document.querySelectorAll('.main-section').forEach(x=>x.style.display='none');
            document.querySelector('#choice-section').style.display='block';}''')
        page.locator('#choice-section').screenshot(path=str(OUT/f'V37-choice-{device}-preview.png'),animations='disabled', timeout=15000)
        page.evaluate('''() => window.__choiceTestRows.unshift({room:'D51',result:'庄',game:31})''')
        page.evaluate('window.refreshChoiceRoom()')
        page.wait_for_function("() => document.querySelector('#choice-room-count')?.textContent==='31'", timeout=8000)
        assert not errors, errors
        results.append({'device':device, 'blockedStatusShown':True,'historyRows':31,'jsErrors':errors})
        page.close()
    browser.close()
print(json.dumps(results,ensure_ascii=False,indent=2))
