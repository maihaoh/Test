import os
import json
import time
import uuid
import hashlib
import threading
from datetime import datetime, timezone, timedelta
from collections import Counter, defaultdict

import requests

BASE_URL = "https://mzplayapi.com/api/webapi"
ORIGIN = "https://mzplay0.com"
LANGUAGE = 0
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mzplay_config.json")

MIN_REQUEST_INTERVAL = 1.35
LOGIN_RATE_LIMIT_BASE_SECONDS = 15 * 60
LOGIN_RATE_LIMIT_MAX_SECONDS = 60 * 60
LOGIN_FAILURE_RETRY_SECONDS = 60
GENERAL_RETRY_SECONDS = 12
AUTH_STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mzplay_auth_state.json")
MYT = timezone(timedelta(hours=8))
BUILD_VERSION = "v18-github-secrets"

GAME_DEFS = {
    "k3": {
        "type_id": 9,
        "history": "/GetK3NoaverageEmerdList",
        "issue": "/GetGameK3Issue",
        "page_size": 100,
    },
    "5d": {
        "type_id": 5,
        "history": "/GetNoaverage5DEmerdList",
        "issue": "/GetGame5DIssue",
        "page_size": 100,
    },
    "trx": {
        "type_id": 13,
        "history": "/GetTRXNoaverageEmerdList",
        "issue": "/GetTRXGameIssue",
        "page_size": 100,
    },
}

EXCLUDED_SIGN_KEYS = {"signature", "track", "xosoBettingData"}


def _compact_json(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def generate_random():
    return uuid.uuid4().hex


def generate_signature(payload):
    clean = {}
    for key in sorted(payload.keys()):
        value = payload[key]
        if key in EXCLUDED_SIGN_KEYS or key == "timestamp":
            continue
        if value is None or value == "":
            continue
        clean[key] = value
    return hashlib.md5(_compact_json(clean).encode("utf-8")).hexdigest().upper()


def trx_colour(number):
    number = int(number)
    if number == 0:
        return "红+紫"
    if number == 5:
        return "绿+紫"
    return "红" if number % 2 == 0 else "绿"


def size_0_9(number):
    return "小" if int(number) <= 4 else "大"


def odd_even(number):
    return "双" if int(number) % 2 == 0 else "单"


def k3_size(total):
    return "小" if int(total) <= 10 else "大"


def k3_sum_range(total):
    total = int(total)
    if total <= 7:
        return "3-7"
    if total <= 13:
        return "8-13"
    return "14-18"


def confidence_from_votes(votes, sample_size):
    if sample_size <= 0 or not votes:
        return 50
    total = sum(votes.values()) or 1
    top = max(votes.values())
    concentration = top / total
    sample_bonus = min(sample_size, 80) / 80 * 10
    return int(max(50, min(92, round(48 + concentration * 34 + sample_bonus))))


def weighted_mode(values, max_items=80):
    scores = defaultdict(float)
    for idx, value in enumerate(values[:max_items]):
        weight = 1.0 + (max_items - idx) / max_items * 1.7
        scores[value] += weight
    if not scores:
        return None, {}
    best = max(scores.items(), key=lambda kv: (kv[1], str(kv[0])))[0]
    return best, dict(scores)


def transition_pick(values, current, max_items=120):
    scores = defaultdict(float)
    seq = list(reversed(values[:max_items]))  # oldest -> newest
    for i in range(len(seq) - 1):
        if seq[i] == current:
            scores[seq[i + 1]] += 1 + i / max(1, len(seq))
    if not scores:
        return None, {}
    return max(scores.items(), key=lambda kv: kv[1])[0], dict(scores)


def combine_pick(values, domain):
    if not values:
        return domain[0], 50
    recent, recent_scores = weighted_mode(values)
    trans, trans_scores = transition_pick(values, values[0])
    scores = {v: 0.0 for v in domain}
    for k, v in recent_scores.items():
        if k in scores:
            scores[k] += v
    for k, v in trans_scores.items():
        if k in scores:
            scores[k] += v * 2.1
    if trans is not None and trans in scores:
        scores[trans] += 1.0
    if recent is not None and recent in scores:
        scores[recent] += 0.5
    best = max(scores.items(), key=lambda kv: (kv[1], str(kv[0])))[0]
    return best, confidence_from_votes(scores, len(values))


def normalize_k3(items):
    out = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        issue = str(item.get("issueNumber", "")).strip()
        premium = str(item.get("premium", "")).replace(",", "").replace(" ", "")
        if not issue or len(premium) < 3 or not premium[:3].isdigit():
            continue
        dice = [int(ch) for ch in premium[:3]]
        if any(n < 1 or n > 6 for n in dice):
            continue
        total = int(item.get("sumCount") or sum(dice))
        out.append({
            "issueNumber": issue,
            "dice": dice,
            "premium": "".join(map(str, dice)),
            "sum": total,
            "size": k3_size(total),
            "oddEven": odd_even(total),
            "sumRange": k3_sum_range(total),
        })
    return sorted(out, key=lambda x: x["issueNumber"], reverse=True)


def normalize_5d(items):
    out = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        issue = str(item.get("issueNumber", "")).strip()
        premium = str(item.get("premium", "")).replace(",", "").replace(" ", "")
        if not issue or len(premium) < 5 or not premium[:5].isdigit():
            continue
        digits = [int(ch) for ch in premium[:5]]
        total = int(item.get("sumCount") or sum(digits))
        out.append({
            "issueNumber": issue,
            "digits": digits,
            "premium": "".join(map(str, digits)),
            "sum": total,
            "sizeByPosition": [size_0_9(n) for n in digits],
            "oddEvenByPosition": [odd_even(n) for n in digits],
        })
    return sorted(out, key=lambda x: x["issueNumber"], reverse=True)


def normalize_trx(items):
    out = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        issue = str(item.get("issueNumber", "")).strip()
        try:
            number = int(item.get("number"))
        except Exception:
            premium = str(item.get("premium", ""))
            if not premium or not premium[-1:].isdigit():
                continue
            number = int(premium[-1])
        if not issue or not 0 <= number <= 9:
            continue
        colour = trx_colour(number)
        out.append({
            "issueNumber": issue,
            "number": number,
            "premium": str(item.get("premium", "")),
            "size": size_0_9(number),
            "colour": colour,
            "blockID": str(item.get("blockID", "")),
            "blockNumber": item.get("blockNumber", ""),
            "blockTime": item.get("blockTime", ""),
        })
    return sorted(out, key=lambda x: x["issueNumber"], reverse=True)


def predict_k3(draws):
    if not draws:
        return {}
    dice_prediction = []
    dice_conf = []
    for pos in range(3):
        values = [d["dice"][pos] for d in draws if len(d.get("dice", [])) == 3]
        pred, conf = combine_pick(values, list(range(1, 7)))
        dice_prediction.append(int(pred))
        dice_conf.append(conf)
    sizes = [d["size"] for d in draws]
    oe = [d["oddEven"] for d in draws]
    ranges = [d["sumRange"] for d in draws]
    size_pred, size_conf = combine_pick(sizes, ["小", "大"])
    oe_pred, oe_conf = combine_pick(oe, ["单", "双"])
    range_pred, range_conf = combine_pick(ranges, ["3-7", "8-13", "14-18"])
    sums = [d["sum"] for d in draws[:60]]
    weighted_sum = round(sum(v * (len(sums) - i) for i, v in enumerate(sums)) / max(1, sum(len(sums) - i for i in range(len(sums))))) if sums else sum(dice_prediction)
    weighted_sum = max(3, min(18, weighted_sum))
    return {
        "dice": dice_prediction,
        "sum": weighted_sum,
        "size": size_pred,
        "oddEven": oe_pred,
        "sumRange": range_pred,
        "confidence": round(sum(dice_conf + [size_conf, oe_conf, range_conf]) / 6),
        "detailConfidence": {"dice": dice_conf, "size": size_conf, "oddEven": oe_conf, "sumRange": range_conf},
        "method": "近期加权频率 + 状态转移",
    }


def predict_5d(draws):
    if not draws:
        return {}
    digits = []
    digit_conf = []
    for pos in range(5):
        values = [d["digits"][pos] for d in draws if len(d.get("digits", [])) == 5]
        pred, conf = combine_pick(values, list(range(10)))
        digits.append(int(pred))
        digit_conf.append(conf)
    return {
        "digits": digits,
        "premium": "".join(map(str, digits)),
        "sizeByPosition": [size_0_9(n) for n in digits],
        "oddEvenByPosition": [odd_even(n) for n in digits],
        "sum": sum(digits),
        "confidence": round(sum(digit_conf) / len(digit_conf)),
        "detailConfidence": digit_conf,
        "method": "每位近期加权频率 + 状态转移",
    }


def predict_trx(draws):
    if not draws:
        return {}
    numbers = [d["number"] for d in draws]
    number, nconf = combine_pick(numbers, list(range(10)))
    sizes = [d["size"] for d in draws]
    size, sconf = combine_pick(sizes, ["小", "大"])
    colours = [d["colour"] for d in draws]
    colour, cconf = combine_pick(colours, ["红", "绿", "红+紫", "绿+紫"])
    return {
        "number": int(number),
        "size": size,
        "colour": colour,
        "confidence": round((nconf + sconf + cconf) / 3),
        "detailConfidence": {"number": nconf, "size": sconf, "colour": cconf},
        "method": "近期加权频率 + 状态转移",
    }


def review_prediction(game, prediction, draw):
    if not prediction or not draw:
        return None
    if game == "k3":
        exact = sum(1 for a, b in zip(prediction.get("dice", []), draw.get("dice", [])) if a == b)
        return {
            "issueNumber": draw["issueNumber"],
            "prediction": f"{''.join(map(str, prediction.get('dice', [])))} / {prediction.get('size','-')} / {prediction.get('oddEven','-')} / {prediction.get('sumRange','-')}",
            "actual": f"{draw.get('premium','')} / {draw.get('size','-')} / {draw.get('oddEven','-')} / {draw.get('sumRange','-')}",
            "score": f"骰子 {exact}/3 · 大小 {'WIN' if prediction.get('size') == draw.get('size') else 'LOSS'} · 单双 {'WIN' if prediction.get('oddEven') == draw.get('oddEven') else 'LOSS'} · 区间 {'WIN' if prediction.get('sumRange') == draw.get('sumRange') else 'LOSS'}",
            "win": prediction.get("size") == draw.get("size"),
        }
    if game == "5d":
        pd = prediction.get("digits", [])
        ad = draw.get("digits", [])
        exact = sum(1 for a, b in zip(pd, ad) if a == b)
        size_hits = sum(1 for a, b in zip(prediction.get("sizeByPosition", []), draw.get("sizeByPosition", [])) if a == b)
        oe_hits = sum(1 for a, b in zip(prediction.get("oddEvenByPosition", []), draw.get("oddEvenByPosition", [])) if a == b)
        return {
            "issueNumber": draw["issueNumber"],
            "prediction": prediction.get("premium", ""),
            "actual": draw.get("premium", ""),
            "score": f"数字 {exact}/5 · 大小 {size_hits}/5 · 单双 {oe_hits}/5",
            "win": size_hits >= 3,
        }
    if game == "trx":
        return {
            "issueNumber": draw["issueNumber"],
            "prediction": f"{prediction.get('number','-')} / {prediction.get('size','-')} / {prediction.get('colour','-')}",
            "actual": f"{draw.get('number','-')} / {draw.get('size','-')} / {draw.get('colour','-')}",
            "score": f"号码 {'WIN' if prediction.get('number') == draw.get('number') else 'LOSS'} · 大小 {'WIN' if prediction.get('size') == draw.get('size') else 'LOSS'} · 颜色 {'WIN' if prediction.get('colour') == draw.get('colour') else 'LOSS'}",
            "win": prediction.get("size") == draw.get("size"),
        }
    return None


class MZPlayRateLimit(RuntimeError):
    pass


class MZPlayClient:
    def __init__(self, config):
        self.config = config or {}
        self.username = str(os.getenv("MZPLAY_USERNAME") or self.config.get("username") or "").strip()
        self.password = str(os.getenv("MZPLAY_PASSWORD") or self.config.get("password") or "").strip()
        self.device_id = str(os.getenv("MZPLAY_DEVICE_ID") or self.config.get("deviceId") or uuid.uuid4().hex)
        self.session = requests.Session()
        # Mirror the successful Chrome Login request headers as closely as possible.
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Content-Type": "application/json;charset=UTF-8",
            "Origin": ORIGIN,
            "Referer": ORIGIN + "/",
            "Ar-Origin": ORIGIN,
            "Ar-Real-Ip": "",
            "Authorization": "",
            "Sec-CH-UA": '"Chromium";v="154", "Google Chrome";v="154", "Not A(Brand";v="99"',
            "Sec-CH-UA-Mobile": "?0",
            "Sec-CH-UA-Platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "cross-site",
            "Priority": "u=1, i",
        })
        self.token_header = ""
        self.token = ""
        self.refresh_token = ""
        self.lock = threading.Lock()
        self.rate_lock = threading.Lock()
        self.last_request_at = 0.0
        self.next_login_at = 0.0
        self.last_login_error = ""
        self.rate_limit_hits = 0
        self._load_auth_state()

    def _load_auth_state(self):
        try:
            if not os.path.exists(AUTH_STATE_FILE):
                return
            with open(AUTH_STATE_FILE, "r", encoding="utf-8") as f:
                state = json.load(f)
            if not isinstance(state, dict):
                return
            self.next_login_at = float(state.get("nextLoginAtEpoch") or 0)
            self.rate_limit_hits = int(state.get("rateLimitHits") or 0)
            self.last_login_error = str(state.get("lastLoginError") or "")
        except Exception:
            self.next_login_at = 0.0
            self.rate_limit_hits = 0
            self.last_login_error = ""

    def _save_auth_state(self):
        state = {
            "nextLoginAtEpoch": float(self.next_login_at or 0),
            "rateLimitHits": int(self.rate_limit_hits or 0),
            "lastLoginError": self.last_login_error or "",
            "updatedAtEpoch": time.time(),
        }
        tmp = AUTH_STATE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, AUTH_STATE_FILE)

    def _clear_auth_state(self):
        self.next_login_at = 0.0
        self.rate_limit_hits = 0
        self.last_login_error = ""
        try:
            if os.path.exists(AUTH_STATE_FILE):
                os.remove(AUTH_STATE_FILE)
        except Exception:
            pass

    @property
    def configured(self):
        return bool(self.username and self.password)

    def _signed(self, data):
        payload = dict(data or {})
        payload.pop("signature", None)
        payload.pop("timestamp", None)
        payload["language"] = LANGUAGE
        payload["random"] = generate_random()
        payload["signature"] = generate_signature(payload)
        payload["timestamp"] = int(time.time())
        return payload

    def _auth_header(self, refresh=False):
        token = self.refresh_token if refresh else self.token
        return f"{self.token_header}{token}" if token else ""

    def _throttle(self):
        with self.rate_lock:
            now = time.monotonic()
            wait_for = MIN_REQUEST_INTERVAL - (now - self.last_request_at)
            if wait_for > 0:
                time.sleep(wait_for)
            self.last_request_at = time.monotonic()

    def _post_json(self, path, payload, headers=None, timeout=20):
        self._throttle()
        return self.session.post(BASE_URL + path, json=payload, headers=headers or {}, timeout=timeout)

    def _login_cooldown_message(self):
        remaining = int(max(0, self.next_login_at - time.time()))
        retry_dt = datetime.fromtimestamp(self.next_login_at, MYT).strftime("%H:%M:%S") if self.next_login_at else "--:--:--"
        minutes = max(1, (remaining + 59) // 60) if remaining else 0
        return f"登录限频冷却中，约 {minutes} 分钟后自动重试（MYT {retry_dt}）"

    def login(self):
        if not self.configured:
            raise RuntimeError("未配置 MZPLAY username/password")
        payload = {
            "username": self.username,
            "pwd": self.password,
            "phonetype": 0,
            "logintype": "mobile",
            "packId": "",
            "deviceId": self.device_id,
            "pixelId": "",
            "fbcId": "",
            "fbc": "",
            "fbp": "",
            "adId": "",
        }
        if time.time() < self.next_login_at:
            raise MZPlayRateLimit(self._login_cooldown_message())
        response = self._post_json("/Login", self._signed(payload), timeout=20)
        response.raise_for_status()
        body = response.json()
        data = body.get("data") if isinstance(body, dict) else None
        if isinstance(data, dict) and isinstance(data.get("data"), dict):
            data = data["data"]
        if not isinstance(data, dict):
            data = body if isinstance(body, dict) else {}
        token = data.get("token")
        if not token:
            code = body.get("code") if isinstance(body, dict) else "?"
            msg = ""
            msg_code = ""
            if isinstance(body, dict):
                msg = str(body.get("msg") or body.get("message") or "").strip()
                msg_code = str(body.get("msgCode") or "").strip()
            detail = f"code={code}"
            if msg_code:
                detail += f", msgCode={msg_code}"
            if msg:
                detail += f", msg={msg}"
            if str(msg_code) == "13" or str(code) == "13" or "frequent" in msg.lower():
                self.rate_limit_hits = max(0, self.rate_limit_hits) + 1
                cooldown = min(
                    LOGIN_RATE_LIMIT_MAX_SECONDS,
                    LOGIN_RATE_LIMIT_BASE_SECONDS * (2 ** min(self.rate_limit_hits - 1, 2)),
                )
                self.next_login_at = time.time() + cooldown
                self.last_login_error = detail
                self._save_auth_state()
                mins = max(1, cooldown // 60)
                retry_dt = datetime.fromtimestamp(self.next_login_at, MYT).strftime("%H:%M:%S")
                raise MZPlayRateLimit(f"服务器限制登录频率；本程序不会继续撞接口，{mins} 分钟后再试（MYT {retry_dt}，{detail}）")
            self.next_login_at = time.time() + LOGIN_FAILURE_RETRY_SECONDS
            self.last_login_error = detail
            raise RuntimeError(f"Login 未返回 token ({detail})")
        self._clear_auth_state()
        self.rate_limit_hits = 0
        self._load_auth_state()
        self.token_header = str(data.get("tokenHeader") or "")
        self.token = str(token)
        self.refresh_token = str(data.get("refreshToken") or "")
        return True

    def refresh(self):
        if not self.refresh_token:
            return self.login()
        headers = {"Authorization": self._auth_header(refresh=True)}
        response = self._post_json("/RefreshToken", self._signed({}), headers=headers, timeout=20)
        response.raise_for_status()
        body = response.json()
        data = body.get("data") if isinstance(body, dict) else None
        if isinstance(data, dict) and isinstance(data.get("data"), dict):
            data = data["data"]
        if not isinstance(data, dict) or not data.get("token"):
            return self.login()
        self.token_header = str(data.get("tokenHeader") or self.token_header)
        self.token = str(data.get("token") or "")
        self.refresh_token = str(data.get("refreshToken") or self.refresh_token)
        return True

    def ensure_login(self):
        """Ensure one authenticated MZPlay session without duplicate concurrent logins."""
        with self.lock:
            if not self.token:
                self.login()
        return True

    def get_choice_launch_url(self):
        """Get a fresh authorized Choice/AG Video launch URL from MZPlay.

        The returned URL contains short-lived authorization material and must not be
        logged or persisted.  This follows the same GetGameUrl call used by the web UI.
        """
        body = self.post(
            "/GetGameUrl",
            {
                "vendorCode": "AG_Video",
                "returnUrl": ORIGIN,
                "deviceType": 0,
            },
        )
        data = body.get("data") if isinstance(body, dict) else None
        if isinstance(data, dict) and isinstance(data.get("data"), dict):
            data = data["data"]
        url = str(data.get("url") or "").strip() if isinstance(data, dict) else ""
        if not url.startswith("https://gci.arvideo.video/forwardGame.do?"):
            raise RuntimeError("GetGameUrl 未返回有效的 Choice launch URL")
        return url

    def post(self, path, data=None):
        with self.lock:
            if not self.token:
                self.login()
            headers = {"Authorization": self._auth_header()}
            response = self._post_json(path, self._signed(data or {}), headers=headers, timeout=20)
            if response.status_code == 401:
                self.refresh()
                headers["Authorization"] = self._auth_header()
                response = self._post_json(path, self._signed(data or {}), headers=headers, timeout=20)
            response.raise_for_status()
            body = response.json()
            if isinstance(body, dict) and body.get("code") not in (None, 0):
                code = body.get("code")
                msg_code = body.get("msgCode")
                msg = body.get("msg") or body.get("message") or ""
                if str(code) == "13" or str(msg_code) == "13" or "frequent" in str(msg).lower():
                    raise MZPlayRateLimit("API 访问过快，已暂停本轮请求")
                raise RuntimeError(f"API code={code} msgCode={msg_code or ''} msg={msg}")
            return body


def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
        except Exception:
            pass
    return {}


def extract_list(game, body):
    data = body.get("data", {}) if isinstance(body, dict) else {}
    if game == "trx":
        if isinstance(data, dict) and isinstance(data.get("data"), dict):
            return data["data"].get("gameslist", []) or []
        if isinstance(data, dict):
            return data.get("gameslist", []) or data.get("list", []) or []
        return []
    return data.get("list", []) if isinstance(data, dict) else []


def extract_issue(game, body):
    data = body.get("data", {}) if isinstance(body, dict) else {}
    if game == "trx" and isinstance(data, dict):
        predraw = data.get("predraw") or {}
        return {
            "issueNumber": str(predraw.get("issueNumber") or ""),
            "startTime": predraw.get("startTime") or "",
            "endTime": predraw.get("endTime") or "",
            "serviceTime": predraw.get("serviceTime") or "",
            "intervalM": predraw.get("intervalM") or 1,
        }
    if isinstance(data, dict):
        return {
            "issueNumber": str(data.get("issueNumber") or ""),
            "startTime": data.get("startTime") or "",
            "endTime": data.get("endTime") or "",
            "serviceTime": data.get("serviceTime") or "",
            "intervalM": data.get("intervalM") or 1,
        }
    return {"issueNumber": ""}


class MultiGameCollector:
    def __init__(self, on_update, poll_interval=8, client=None):
        self.on_update = on_update
        self.poll_interval = poll_interval
        self.client = client or MZPlayClient(load_config())
        self.states = {
            key: {"reviews": [], "prediction": {}, "draws": [], "current_issue": {}, "status": f"{BUILD_VERSION} | 等待连接", "build_version": BUILD_VERSION}
            for key in GAME_DEFS
        }
        self.stop_event = threading.Event()

    def _normalize(self, game, items):
        if game == "k3":
            return normalize_k3(items)
        if game == "5d":
            return normalize_5d(items)
        return normalize_trx(items)

    def _predict(self, game, draws):
        if game == "k3":
            return predict_k3(draws)
        if game == "5d":
            return predict_5d(draws)
        return predict_trx(draws)

    def poll_game(self, game):
        definition = GAME_DEFS[game]
        state = self.states[game]
        history_body = self.client.post(definition["history"], {
            "pageSize": definition["page_size"],
            "pageNo": 1,
            "typeId": definition["type_id"],
        })
        issue_body = self.client.post(definition["issue"], {"typeId": definition["type_id"]})
        draws = self._normalize(game, extract_list(game, history_body))[:300]
        current_issue = extract_issue(game, issue_body)

        previous_prediction = state.get("prediction") or {}
        target = str(previous_prediction.get("issueNumber") or "")
        if target:
            actual = next((d for d in draws if d.get("issueNumber") == target), None)
            if actual and not any(r.get("issueNumber") == target for r in state.get("reviews", [])):
                review = review_prediction(game, previous_prediction, actual)
                if review:
                    state.setdefault("reviews", []).insert(0, review)
                    state["reviews"] = state["reviews"][:60]

        prediction = self._predict(game, draws)
        prediction["issueNumber"] = current_issue.get("issueNumber") or (draws[0]["issueNumber"] if draws else "")
        prediction["generatedAt"] = int(time.time())

        state.update({
            "typeId": definition["type_id"],
            "draws": draws,
            "current_issue": current_issue,
            "prediction": prediction,
            "status": f"{BUILD_VERSION} | " + ("实时 API 已连接" if draws else "API 已连接，等待开奖记录"),
            "build_version": BUILD_VERSION,
            "updated_at": int(time.time()),
        })
        return state

    def run(self):
        if not self.client.configured:
            for game in self.states:
                self.states[game]["status"] = "未配置 MZPLAY 登录资料：GitHub 请检查 Actions Secrets，本机请检查 mzplay_config.json"
            self.on_update(self.states)
            return

        while not self.stop_event.is_set():
            # One Login attempt serves all three games. Never let K3/5D/TRX each hammer /Login.
            if not self.client.token:
                try:
                    self.client.ensure_login()
                except MZPlayRateLimit as exc:
                    status = f"{BUILD_VERSION} | 服务器限频：{exc}"
                    for game in self.states:
                        self.states[game]["status"] = status
                        self.states[game]["updated_at"] = int(time.time())
                    self.on_update(self.states)
                    wait_for = max(5, int(self.client.next_login_at - time.time()))
                    self.stop_event.wait(wait_for)
                    continue
                except Exception as exc:
                    status = f"{BUILD_VERSION} | 连接失败：{type(exc).__name__}: {exc}"
                    for game in self.states:
                        self.states[game]["status"] = status
                        self.states[game]["updated_at"] = int(time.time())
                    self.on_update(self.states)
                    self.stop_event.wait(LOGIN_FAILURE_RETRY_SECONDS)
                    continue

            rate_limited = False
            for game in GAME_DEFS:
                try:
                    self.poll_game(game)
                except MZPlayRateLimit as exc:
                    rate_limited = True
                    self.states[game]["status"] = f"{BUILD_VERSION} | 服务器限频：{exc}"
                    self.states[game]["updated_at"] = int(time.time())
                    break
                except Exception as exc:
                    self.states[game]["status"] = f"{BUILD_VERSION} | 连接失败：{type(exc).__name__}: {exc}"
                    self.states[game]["updated_at"] = int(time.time())
            self.on_update(self.states)
            self.stop_event.wait(GENERAL_RETRY_SECONDS if rate_limited else self.poll_interval)
