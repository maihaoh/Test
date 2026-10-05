from __future__ import annotations
import base64, json, os, sys, tempfile, time
from pathlib import Path
from urllib.parse import urlparse
import requests

ROOT=Path(__file__).resolve().parent
rows=[]
def add(name,status,detail=''):
    status=status.upper(); rows.append((name,status,str(detail)[:180])); print(f"[DIAG] {name}: {status}"+(f" - {detail}" if detail else ''))
def yn(x): return 'yes' if x else 'no'
def safe_body(r):
    try:
        b=r.json()
        if isinstance(b,dict): return f"code={b.get('code')} msgCode={b.get('msgCode')} msg={b.get('msg') or b.get('message') or ''}"[:180]
    except Exception: pass
    return (r.text or '')[:120].replace('\n',' ')

def main():
    print('================ CHOICE FULL DIAGNOSTIC ================')
    # 1 secrets + decode
    required=['MZPLAY_AUTH_STATE_B64','MZPLAY_STATE_KEY','MZPLAY_DEVICE_ID','INGEST_SECRET']
    missing=[k for k in required if not os.getenv(k)]
    add('Secrets','PASS' if not missing else 'FAIL', 'missing='+','.join(missing) if missing else 'all required present')
    state={}
    raw=os.getenv('MZPLAY_AUTH_STATE_B64','').strip()
    if raw:
        try:
            state=json.loads(base64.b64decode(raw,validate=True).decode('utf-8'))
            add('Decode session','PASS','JSON object' if isinstance(state,dict) else 'not object')
        except Exception as e: add('Decode session','FAIL',type(e).__name__)
    else: add('Decode session','FAIL','secret missing')
    if not isinstance(state,dict): state={}
    token=state.get('token') or state.get('accessToken') or state.get('access_token') or state.get('ar_token') or ''
    refresh=state.get('refreshToken') or state.get('refresh_token') or ''
    device=state.get('deviceId') or state.get('arvId') or os.getenv('MZPLAY_DEVICE_ID','')
    add('Session fields','PASS' if token else 'FAIL',f"token={yn(token)} refresh={yn(refresh)} device={yn(device)} tokenHeader={yn(state.get('tokenHeader'))}")

    # imports/offline decoder/data
    try:
        from choice_result_decoder import build_subscribe_packet, DEFAULT_VIDS, decode_wininfo
        pkt=build_subscribe_packet(DEFAULT_VIDS)
        vals=[decode_wininfo(x) for x in (1,2,4)]
        add('D051-D058 decoder','PASS',f"subscribe_bytes={len(pkt)} offline_wininfo={len(vals)}")
    except Exception as e: add('D051-D058 decoder','FAIL',f'{type(e).__name__}: {e}')
    try:
        p=ROOT/'data.json'; obj=json.loads(p.read_text(encoding='utf-8'))
        with tempfile.NamedTemporaryFile('w',delete=True,encoding='utf-8') as f: json.dump(obj,f); f.flush()
        add('data.json writer','PASS',f"json_object={isinstance(obj,dict)}")
    except Exception as e: add('data.json writer','FAIL',type(e).__name__)

    # API contract - direct, one request each, no login/refresh fallback
    try:
        from mzplay_multi import MZPlayClient, load_config
        c=MZPlayClient(load_config())
        if token: c.token=str(token)
        if refresh: c.refresh_token=str(refresh)
        if device: c.device_id=str(device)
        auth={'Authorization':c._auth_header()} if c.token else {}
        tests=[('GetK3 history','/GetK3NoaverageEmerdList',{'pageSize':10,'pageNo':1,'typeId':9}),('GetGameUrl','/GetGameUrl',{'vendorCode':'AG_Video','returnUrl':'https://mzplay0.com','deviceType':3})]
        for name,path,payload in tests:
            try:
                r=c._post_json(path,c._signed(payload),headers=auth,timeout=20)
                ok=r.status_code==200
                detail=f"HTTP={r.status_code} {safe_body(r)}"
                if ok:
                    try:
                        b=r.json(); ok=isinstance(b,dict) and b.get('code') in (None,0)
                    except Exception: pass
                add(name,'PASS' if ok else 'FAIL',detail)
            except Exception as e: add(name,'FAIL',f'{type(e).__name__}: {e}')
        if refresh:
            try:
                h={'Authorization':c._auth_header(refresh=True)}
                r=c._post_json('/RefreshToken',c._signed({}),headers=h,timeout=20)
                ok=r.status_code==200
                try:
                    b=r.json(); ok=ok and isinstance(b,dict) and b.get('code') in (None,0)
                except Exception: pass
                add('RefreshToken','PASS' if ok else 'FAIL',f"HTTP={r.status_code} {safe_body(r)}")
            except Exception as e: add('RefreshToken','FAIL',f'{type(e).__name__}: {e}')
        else: add('RefreshToken','SKIP','refresh token missing')
    except Exception as e:
        add('MZPlay API client','FAIL',f'{type(e).__name__}: {e}')

    # website + browser + Choice UI + observed WS. Never perform UI login.
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser=p.chromium.launch(headless=True,args=['--disable-dev-shm-usage','--no-sandbox'])
            ctx=browser.new_context(user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36')
            tok=json.dumps(str(token)); th=json.dumps(str(state.get('tokenHeader') or 'Bearer')); ref=json.dumps(str(refresh)); dev=json.dumps(str(device))
            ctx.add_init_script(script=f"try{{localStorage.setItem('ar_token',{tok});localStorage.setItem('tokenHeader',{th});localStorage.setItem('refreshToken',{ref});localStorage.setItem('arvId',{dev});}}catch(e){{}}")
            ws=[]
            def ap(pg): pg.on('websocket',lambda w: ws.append(str(w.url or '')))
            ctx.on('page',ap); page=ctx.new_page(); ap(page)
            try: page.goto('https://mzplay0.com/',wait_until='domcontentloaded',timeout=45000)
            except Exception: pass
            page.wait_for_timeout(1500)
            title=page.title() or ''; body=(page.locator('body').inner_text(timeout=4000) or '')[:800]; path=page.evaluate('() => location.pathname') or ''
            blocked='Attention Required' in title or 'Sorry, you have been blocked' in body
            if blocked: add('MZPlay website','FAIL','CLOUDFLARE_BLOCKED')
            elif str(path).lower().startswith('/login'): add('MZPlay website','FAIL','SESSION_NOT_ACCEPTED /login')
            else: add('MZPlay website','PASS',f'path={path}')
            choice=None
            if not blocked and not str(path).lower().startswith('/login'):
                for sel in ["text=CHOICE","text=Choice","img[src*='choice' i]","a:has-text('CHOICE')","button:has-text('CHOICE')"]:
                    try:
                        loc=page.locator(sel)
                        for i in range(min(loc.count(),10)):
                            if loc.nth(i).is_visible(): choice=loc.nth(i); break
                    except Exception: pass
                    if choice is not None: break
            if choice is None: add('Choice launch','SKIP' if blocked else 'FAIL','tile not reachable')
            else:
                try:
                    choice.click(timeout=10000); deadline=time.time()+25
                    while time.time()<deadline and not ws:
                        for pg in ctx.pages:
                            try: pg.wait_for_timeout(150)
                            except Exception: pass
                        time.sleep(.1)
                    add('Choice launch','PASS' if ws else 'FAIL','official UI clicked; websocket='+yn(ws))
                except Exception as e: add('Choice launch','FAIL',type(e).__name__)
            gamews=[u for u in ws if 'mdvuz.com' in u or 'e9p1.com' in u]
            ports={urlparse(u).port for u in gamews if urlparse(u).port}
            add('WS :7101','PASS' if 7101 in ports else 'NOT REACHED',f'observed_ports={sorted(ports)}')
            add('WS :5000','PASS' if 5000 in ports else 'NOT REACHED',f'observed_ports={sorted(ports)}')
            add('BAC 135176 live','NOT REACHED','live packet capture requires reachable Choice websocket' if not gamews else 'socket reached; collector performs packet decode during normal run')
            browser.close()
    except Exception as e:
        add('MZPlay website','FAIL',f'browser {type(e).__name__}')
        add('Choice launch','NOT REACHED','browser unavailable'); add('WS :7101','NOT REACHED'); add('WS :5000','NOT REACHED'); add('BAC 135176 live','NOT REACHED')

    # Relay test using current snapshot; does not expose secret.
    try:
        url=os.getenv('PUSH_URL','https://test-4bvi.onrender.com/api/ingest'); sec=os.getenv('INGEST_SECRET','')
        data=(ROOT/'data.json').read_bytes()
        if not sec: add('Render relay','FAIL','INGEST_SECRET missing')
        else:
            r=requests.post(url,data=data,headers={'Authorization':f'Bearer {sec}','Content-Type':'application/json','User-Agent':'ChoiceDiagnostic/1'},timeout=30)
            add('Render relay','PASS' if r.status_code in (200,409) else 'FAIL',f'HTTP={r.status_code}')
    except Exception as e: add('Render relay','FAIL',type(e).__name__)

    print('\n================ DIAGNOSTIC SUMMARY ====================')
    for n,s,d in rows: print(f'{n:24} {s:12} {d}')
    fails=[n for n,s,d in rows if s=='FAIL']
    root=fails[0] if fails else 'No hard failure detected'
    print('========================================================')
    print('FIRST HARD FAILURE:',root)
    print('No passwords, tokens, cookies, or secret values were printed.')
    return 0
if __name__=='__main__': raise SystemExit(main())
