"""Offline Chromium UI smoke tests with real page DOM and injected script files.

The test environment blocks HTTP navigation. This harness injects the original
HTML/CSS/JS via Playwright's set_content/add_script_tag and stubs localStorage
and fetch; it is not a real HTTP end-to-end test or an authenticated API test.
"""
import json
import re
import shutil
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None


@unittest.skipUnless(sync_playwright and shutil.which('chromium'), 'Local Chromium / Playwright unavailable')
class BrowserUITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path=shutil.which('chromium'),
            headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
        html = (ROOT/'index.html').read_text()
        html = re.sub(r'<script\b[^>]*\bsrc="[^"]+"[^>]*>\s*</script>', '', html, flags=re.I)
        html = re.sub(r'<link\b[^>]*\bhref="style\.css[^"]*"[^>]*>', '', html, flags=re.I)
        cls.html = html.replace('</head>', f'<style>{(ROOT/"style.css").read_text()}</style></head>')
        cls.scripts = [(ROOT/name).read_text() for name in
            ['script.js','baccarat_analysis.js','baccarat_engine.js','baccarat_roads.js','choice_manual.js','multi_games.js']]

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def open_page(self, *, viewport=390, multi_payload=None, storage=None):
        context = self.browser.new_context(viewport={'width': viewport, 'height': 850}, accept_downloads=True)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda err: errors.append(str(err)))
        page.set_content(self.html, wait_until='domcontentloaded')
        page.evaluate('''({multi, initial}) => {
            const store = new Map(Object.entries(initial || {}));
            Object.defineProperty(window, 'localStorage', {configurable:true, value:{
                getItem:key => store.has(key) ? store.get(key) : null,
                setItem:(key,value) => store.set(String(key),String(value)),
                removeItem:key => store.delete(key), clear:() => store.clear()
            }});
            window.fetch = async (url) => {
                if (multi && String(url).includes('/api/data')) {
                    return {ok:true, json: async () => multi};
                }
                throw new Error('External API unavailable in offline smoke test');
            };
        }''', {'multi':multi_payload, 'initial':storage or {}})
        for script in self.scripts: page.add_script_tag(content=script)
        page.wait_for_timeout(100)
        self.addCleanup(context.close)
        return page, errors

    def test_manual_input_roadmaps_and_mobile_layout(self):
        for width in [320,390,1280]:
            with self.subTest(width=width):
                page, errors = self.open_page(viewport=width)
                page.locator('[data-baccarat-tab]').click()
                page.locator('button[onclick="choiceManualAdd(\'B\')"]').click()
                page.locator('button[onclick="choiceManualAdd(\'T\')"]').click()
                page.locator('button[onclick="choiceManualAdd(\'P\')"]').click()
                self.assertEqual(page.locator('#bc-manual-round-count').inner_text(), '3')
                self.assertEqual(page.locator('#bc-manual-tie-count').inner_text(), '1')
                self.assertEqual(page.locator('#bc-road-bead .bc-road-mark').count(), 3)
                self.assertEqual(page.locator('#bc-road-big .bc-road-mark').count(), 2)
                self.assertEqual(page.locator('#bc-road-eye .bc-road-mark').count(), 0)
                self.assertIn('押庄 -1.06%', page.locator('#bc-ai-ev').inner_text())
                page.locator('[data-manual-table="D52"]').click()
                self.assertEqual(page.locator('#bc-manual-round-count').inner_text(), '0')
                page.locator('[data-manual-table="D51"]').click()
                page.locator('#bc-manual-undo').click()
                self.assertEqual(page.locator('#bc-manual-round-count').inner_text(), '2')
                overflow = page.evaluate('document.documentElement.scrollWidth > innerWidth + 2')
                self.assertFalse(overflow, f'Horizontal overflow at {width}px')
                self.assertFalse(errors, f'JS exceptions: {errors}')

    def test_corrupted_storage_not_silently_overwritten(self):
        page, errors = self.open_page(storage={'choice_manual_history_v1':'{broken'})
        page.locator('[data-baccarat-tab]').click()
        page.locator('button[onclick="choiceManualAdd(\'B\')"]').click()
        self.assertEqual(page.evaluate('localStorage.getItem("choice_manual_history_v1")'), '{broken')
        self.assertIn('本地备份', page.locator('#bc-manual-message').inner_text())
        self.assertFalse(errors, f'JS exceptions: {errors}')

    def test_wingo_draw_table_html_is_escaped(self):
        page, errors = self.open_page()
        page.evaluate('''() => {
            window.__xss = false;
            renderDrawTable([{issue: '<img src=x onerror="window.__xss=true">', number: 4,
                              size: '<svg onload="window.__xss=true">', colour:'red'}]);
        }''')
        self.assertFalse(page.evaluate('window.__xss'))
        self.assertEqual(page.locator('#draw-table img').count(),0)
        self.assertEqual(page.locator('#draw-table svg').count(),0)
        self.assertIn('<img', page.locator('#draw-table').inner_text())
        self.assertFalse(errors, f'JS exceptions: {errors}')

    def test_multi_stays_stale_when_history_not_updated(self):
        now=int(time.time())
        # Explicitly current-day issue; last-new-draw must still decide freshness.
        payload={g:{'draws':[{'issueNumber':'2026102100001','dice':[1,2,3],'sum':6}],
            'last_success_at':now, 'last_new_draw_at':now-720,
            'current_issue':{'issueNumber':'2026102100002'},
            'prediction':{'issueNumber':'2026102100002','dice':[3,4,5]}} for g in ['k3','5d','trx']}
        page, errors=self.open_page(multi_payload=payload)
        self.assertEqual(page.locator('#k3-data-status').get_attribute('data-live'), 'false')
        self.assertIn('历史数据',page.locator('#k3-data-status').inner_text())
        self.assertFalse(errors, f'JS exceptions: {errors}')

    def test_future_clock_does_not_claim_live_data(self):
        now=int(time.time())
        payload={g:{'draws':[{'issueNumber':'2026102100001','dice':[1,2,3],'sum':6}],
            'last_success_at':now+7200, 'last_new_draw_at':now+7200,
            'current_issue':{'issueNumber':'2026102100002'},
            'prediction':{'issueNumber':'2026102100002','dice':[3,4,5]}} for g in ['k3','5d','trx']}
        page, errors=self.open_page(multi_payload=payload)
        self.assertEqual(page.locator('#k3-data-status').get_attribute('data-live'),'false')
        self.assertFalse(errors, f'JS exceptions: {errors}')


    def test_wingo_walkforward_cannot_see_current_saved_learning(self):
        page, errors = self.open_page()
        result = page.evaluate('''() => {
            // Newest first with deliberately varying outcomes; test that a
            // pre-trained live browser profile cannot affect historical scores.
            const draws = Array.from({length:90}, (_,i) => {
                const number = (i * 7 + Math.floor(i*i/11)) % 10;
                return {issue: String(2026102100100000-i), number,
                    size: number>=5 ? "大" : "小", colour: "red"};
            });
            const original = JSON.stringify(aiLearning);
            const before = runBacktest(draws);
            aiLearning.patterns.recent.push({pattern: getCurrentPattern(draws),
                prediction:'大',outcome:'WIN'});
            for (const factor of Object.values(aiLearning.factors)) factor.weight=2;
            aiLearning.confidenceBias=8;
            aiLearning.passThreshold=0.45;
            const trained = JSON.stringify(aiLearning);
            const after = runBacktest(draws);
            return {before, after, profileUnchanged: JSON.stringify(aiLearning)===trained,
                oldProfileUnchanged: original!==trained};
        }''')
        self.assertEqual(result['before'],result['after'])
        self.assertTrue(result['profileUnchanged'])
        self.assertTrue(result['oldProfileUnchanged'])
        self.assertEqual(result['before']['evaluated'], 50)
        self.assertEqual(result['before']['evaluated'], sum(result['before'][k] for k in ('win','loss','pass')))
        self.assertFalse(errors, f'JS exceptions: {errors}')

    def test_wingo_first_snapshot_is_baseline_then_new_issue_then_stale(self):
        page, errors = self.open_page()
        observed = page.evaluate('''async () => {
            const local = new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Kuala_Lumpur',
                year:'numeric', month:'2-digit',day:'2-digit'}).formatToParts(new Date());
            const date = Object.fromEntries(local.map(p=>[p.type,p.value]));
            const prefix = `${date.year}${date.month}${date.day}`;
            let draws = Array.from({length:22},(_,i) => {
                const number = (i*3 + 1)%10;
                return {issue: prefix+String(1000-i).padStart(4, '0'), number,
                    size:number>=5?'大':'小', colour:'red'};
            });
            fetchDraws = async () => draws;
            await refreshDashboard();
            const first = document.querySelector('#wingo-data-status').dataset.live;
            const firstPred = document.querySelector('#predicted-result').innerText;
            draws = [{issue:prefix+'1001',number:8,size:'大',colour:'red'}, ...draws];
            await refreshDashboard();
            const second = document.querySelector('#wingo-data-status').dataset.live;
            const secondStatus = document.querySelector('#wingo-data-status').innerText;
            const secondSeen = wingoLastObservedIssue;
            const secondNew = wingoLastNewDrawAt;
            const today = prefix;
            wingoLastNewDrawAt = Date.now() - 181000;
            await refreshDashboard();
            return {first, firstPred, second, secondStatus, secondSeen, secondNew, today,
                stale: document.querySelector('#wingo-data-status').dataset.live,
                market: document.querySelector('#analysis-streak').innerText,
                predicted: document.querySelector('#predicted-result').innerText};
        }''')
        self.assertEqual(observed['first'],'false')
        self.assertIn('等待数据',observed['firstPred'])
        self.assertEqual(observed['second'],'true')
        self.assertEqual(observed['stale'],'false')
        self.assertNotEqual(observed['market'],'--')
        self.assertIn('等待数据',observed['predicted'])
        self.assertFalse(errors, f'JS exceptions: {errors}')


    def test_v23_wingo_first_response_shows_history_not_fake_live(self):
        page, errors = self.open_page()
        found = page.evaluate('''async () => {
            const nowMYT = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
                timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'
            }).formatToParts(new Date()).map(p => [p.type,p.value]));
            const prefix = `${nowMYT.year}${nowMYT.month}${nowMYT.day}`;
            const draws = Array.from({length:55},(_,i) => ({issueNumber:prefix+String(60000-i),number:(i*7+1)%10}));
            let calls = [];
            window.CryptoJS = {MD5: () => ({toString: () => 'TESTSIGN'})};
            window.fetch = async (url,options) => {
                const body=JSON.parse(options.body); calls.push(body);
                return {ok:true,text:async()=>JSON.stringify({code:0,data:{list:draws.slice(0,body.pageSize)}})};
            };
            await safeRefreshDashboard();
            const first = {
                live:document.querySelector('#wingo-data-status').dataset.live,
                worker:document.querySelector('#wingo-diag-worker').textContent,
                history:document.querySelector('#wingo-diag-history').textContent,
                market:document.querySelector('#analysis-streak').textContent,
                summary:document.querySelector('#review-summary').textContent,
                winrate:document.querySelector('#win-rate').textContent,
                review:document.querySelector('#review-status').textContent,
                row:document.querySelector('#draw-table').textContent,
                prediction:document.querySelector('#predicted-result').textContent,
                firstPageSize:calls[0]?.pageSize,
            };
            draws.unshift({issueNumber:prefix+'60001',number:8});
            await safeRefreshDashboard();
            const second = document.querySelector('#wingo-data-status').dataset.live;
            wingoLastNewDrawAt = Date.now() - 181000;
            await safeRefreshDashboard();
            const third = {live:document.querySelector('#wingo-data-status').dataset.live,
                market:document.querySelector('#analysis-streak').textContent};
            return {first,second,third};
        }''')
        self.assertEqual(found['first']['firstPageSize'],50)
        self.assertEqual(found['first']['live'],'false')
        self.assertIn('50 条',found['first']['worker'])
        self.assertIn('50 条',found['first']['history'])
        self.assertNotEqual(found['first']['market'],'--')
        self.assertIn('可用历史 50 笔',found['first']['summary'])
        self.assertIn('滚动回测 40 局',found['first']['winrate'])
        self.assertIn('历史',found['first']['review'])
        self.assertIn('WIN',found['first']['row']) if 'WIN' in found['first']['row'] else self.assertIn('PASS',found['first']['row'])
        self.assertIn('等待数据',found['first']['prediction'])
        self.assertEqual(found['second'],'true')
        self.assertEqual(found['third']['live'],'false')
        self.assertNotEqual(found['third']['market'],'--')
        self.assertFalse(errors, f'JS exceptions: {errors}')

    def test_v23_wingo_page_size_fallback_and_history_pagination(self):
        page, errors=self.open_page()
        state=page.evaluate('''async () => {
            window.CryptoJS={MD5:()=>({toString:()=> 'MOCK'})};
            const prefix='20261021';
            const draws=Array.from({length:32},(_,i)=>({issueNumber:prefix+String(60000-i),number:i%10}));
            const calls=[];
            window.fetch=async(url,opts)=>{
                const body=JSON.parse(opts.body);calls.push([body.pageNo,body.pageSize]);
                if(body.pageSize===50) return {ok:true,text:async()=>JSON.stringify({code:400,msg:'page size unsupported'})};
                return {ok:true,text:async()=>JSON.stringify({code:0,data:{list:draws.slice((body.pageNo-1)*10,body.pageNo*10)}})};
            };
            await safeRefreshDashboard();
            return {calls,history:document.querySelector('#wingo-diag-history').textContent,
                rate:document.querySelector('#win-rate').textContent,
                market:document.querySelector('#analysis-number').textContent,
                reported:document.querySelector('#wingo-diag-worker').textContent};
        }''')
        self.assertIn([1,50],state['calls'])
        self.assertIn([1,10],state['calls'])
        self.assertIn([2,10],state['calls'])
        self.assertIn('32 条',state['history'])
        self.assertIn('滚动回测 22 局',state['rate'])
        self.assertEqual(state['market'],'0')
        self.assertIn('10 条',state['reported'])
        self.assertFalse(errors, f'JS exceptions: {errors}')

    def test_v23_wingo_offline_keeps_only_historical_analysis(self):
        page, errors=self.open_page()
        state=page.evaluate('''async () => {
            window.CryptoJS={MD5:()=>({toString:()=> 'MOCK'})};
            let online=true;
            window.fetch=async(url,opts)=>{
                if(!online) throw new Error('network unavailable');
                const list = Array.from({length:28},(_,i)=>({issueNumber:'202610216'+String(1000-i),number:i%10}));
                return {ok:true,text:async()=>JSON.stringify({code:0,data:{list}})};
            };
            await safeRefreshDashboard();
            online=false;await safeRefreshDashboard();
            return {live:document.querySelector('#wingo-data-status').dataset.live,
                worker:document.querySelector('#wingo-diag-worker').textContent,
                history:document.querySelector('#wingo-diag-history').textContent,
                market:document.querySelector('#analysis-streak').textContent,
                prediction:document.querySelector('#predicted-result').textContent};
        }''')
        self.assertEqual(state['live'],'false')
        self.assertIn('network unavailable',state['worker'])
        self.assertIn('浏览器历史',state['history'])
        self.assertNotEqual(state['market'],'--')
        self.assertIn('等待数据',state['prediction'])
        self.assertFalse(errors, f'JS exceptions: {errors}')

    def test_v23_corrupt_wingo_cache_preserved(self):
        original='{broken-history'
        page, errors=self.open_page(storage={'wingo_validated_history_v23':original})
        state=page.evaluate('''async () => {
            window.CryptoJS={MD5:()=>({toString:()=> 'MOCK'})};
            window.fetch=async()=>({ok:true,text:async()=>JSON.stringify({code:0,data:{list:[
                {issueNumber:'2026102160009',number:8},{issueNumber:'2026102160008',number:3}
            ]}})});
            await safeRefreshDashboard();
            return {value:localStorage.getItem('wingo_validated_history_v23'),
                samples:document.querySelector('#wingo-diag-history').textContent};
        }''')
        self.assertEqual(state['value'],original)
        self.assertIn('2 条',state['samples'])
        self.assertFalse(errors, f'JS exceptions: {errors}')

    def test_wingo_invalid_numbers_are_not_fabricated_as_zero(self):
        page, errors = self.open_page()
        observations = page.evaluate('''async () => {
            // Worker return types are untrusted: missing/invalid numbers must
            // never become zero, and an incorrect size label must be ignored.
            window.CryptoJS = {MD5: () => ({toString: () => 'MOCKSIGN'})};
            window.fetch = async () => ({ok:true, text: async () => JSON.stringify({
                code:0, data:{list:[
                    {issueNumber:'202610210001', number:null},
                    {issueNumber:'202610210002', number:'not-a-number'},
                    {issueNumber:'202610210003', number:3,size:'大'},
                    {issueNumber:'202610210004', number:8,size:'小'}
                ]}
            })});
            const draws = await fetchDraws();
            return draws.map(({issue, number, size})=>({issue, number, size}));
        }''')
        self.assertEqual(observations, [
            {'issue':'202610210003','number':3,'size':'小'},
            {'issue':'202610210004','number':8,'size':'大'}
        ])
        self.assertFalse(errors, f'JS exceptions: {errors}')

if __name__ == '__main__':
    unittest.main()
