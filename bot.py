import time
import requests
import hashlib
import json
import random
import threading
import zlib
from collections import Counter
import websocket  # 请确保安装: pip install websocket-client

# ==================== WinGo 配置 ====================
WINGO_API_URL = "https://mzplayapi.com/api/webapi/GetNoaverageEmerdList"
WINGO_ORIGIN = "https://mzplay0.com"
WINGO_REFERER = "https://mzplay0.com/"
TYPE_ID = 30
LANGUAGE = 0
POLL_INTERVAL = 10      # 每 10 秒轮询一次
INIT_SCAN_PAGES = 5     # 初始化扫描页数

# ==================== Choice 百家乐 WebSocket 配置 ====================
BACCARAT_WS_URL = "wss://et165.mdvuz.com:5030/"  # 选择 Choice/AG 房间节点的 WebSocket 地址

# 全局内存数据仓库（打通前端 index.html 渲染）
global_data = {
    "updated_at": 0,
    "wingo": {
        "stats": {"streak_val": "-", "streak_cnt": 0, "big_cnt": 0, "small_cnt": 0},
        "draws": []
    },
    "baccarat": {
        "current_room": "D51",
        "shoe_no": "01",
        "game_no": "01",
        "latest_result": "庄",    # 庄 / 闲 / 和
        "predicted_result": "闲", # 预测推荐
        "stats": {"banker_cnt": 0, "player_cnt": 0, "tie_cnt": 0, "win_rate": 0},
        "rooms": {
            "D51": [],
            "D52": [],
            "D53": [],
            "D54": [],
            "D55": [],
            "D56": [],
            "D57": [],
            "D58": []
        }
    }
}

data_lock = threading.Lock()
session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Content-Type": "application/json;charset=UTF-8",
    "Origin": WINGO_ORIGIN,
    "Referer": WINGO_REFERER,
})

# ==================== 工具函数 ====================
def generate_random(length=32):
    return ''.join(random.choices("0123456789abcdef", k=length))

def generate_signature(data):
    sign_data = {k: v for k, v in sorted(data.items()) if k not in ("signature", "timestamp", "track", "xosoBettingData") and v is not None and v != ""}
    json_str = json.dumps(sign_data, separators=(",", ":"), ensure_ascii=False)
    return hashlib.md5(json_str.encode("utf-8")).hexdigest().upper()

def get_wingo_size(number):
    return "小" if 0 <= int(number) <= 4 else "大"

def save_data_json():
    """写出全局数据到 data.json，供前端 index.html 读取"""
    with data_lock:
        global_data["updated_at"] = int(time.time())
        with open("data.json", "w", encoding="utf-8") as f:
            json.dump(global_data, f, ensure_ascii=False, indent=2)

# ==================== WinGo 核心逻辑 ====================
def fetch_wingo_draw_page(page_no=1, page_size=10):
    payload = {
        "pageSize": page_size,
        "pageNo": page_no,
        "typeId": TYPE_ID,
        "language": LANGUAGE,
        "random": generate_random(),
    }
    payload["signature"] = generate_signature(payload)
    payload["timestamp"] = int(time.time())

    try:
        res = session.post(WINGO_API_URL, json=payload, timeout=15)
        data = res.json()
        if data.get("code") != 0:
            return []

        parsed_list = []
        for item in data.get("data", {}).get("list", []):
            num = int(item["number"])
            parsed_list.append({
                "issueNumber": str(item["issueNumber"]),
                "number": num,
                "colour": str(item["colour"]),
                "size": get_wingo_size(num)
            })
        return parsed_list
    except Exception as e:
        print(f"⚠️ WinGo API 请求错误: {e}")
        return []

def update_wingo_data(draws):
    if not draws:
        return

    streak_val = draws[0]["size"]
    streak_cnt = 0
    for d in draws:
        if d["size"] == streak_val:
            streak_cnt += 1
        else:
            break

    sizes = [d["size"] for d in draws]
    size_counts = Counter(sizes)

    with data_lock:
        global_data["wingo"] = {
            "stats": {
                "streak_val": streak_val,
                "streak_cnt": streak_cnt,
                "big_cnt": size_counts.get("大", 0),
                "small_cnt": size_counts.get("小", 0)
            },
            "draws": draws
        }
    
    save_data_json()
    print(f"✅ [WinGo] 同步 {len(draws)} 期数据 (长龙: {streak_val}x{streak_cnt})")

def wingo_loop():
    memory_draws = []
    seen_issues = set()

    print(f"🔍 [WinGo] 启动自动扫描前 {INIT_SCAN_PAGES} 页历史数据...")
    for p in range(1, INIT_SCAN_PAGES + 1):
        page_data = fetch_wingo_draw_page(page_no=p, page_size=10)
        for item in page_data:
            if item["issueNumber"] not in seen_issues:
                seen_issues.add(item["issueNumber"])
                memory_draws.append(item)
        time.sleep(0.3)

    memory_draws.sort(key=lambda x: int(x["issueNumber"]), reverse=True)
    update_wingo_data(memory_draws)

    while True:
        time.sleep(POLL_INTERVAL)
        latest_page = fetch_wingo_draw_page(page_no=1, page_size=10)
        new_items = []

        for item in latest_page:
            if item["issueNumber"] not in seen_issues:
                seen_issues.add(item["issueNumber"])
                new_items.append(item)

        if new_items:
            new_items.sort(key=lambda x: int(x["issueNumber"]), reverse=True)
            memory_draws = new_items + memory_draws
            update_wingo_data(memory_draws)

# ==================== Choice 百家乐 核心解析逻辑 ====================
def predict_baccarat_next(history):
    """基于长龙与历史频率的智能预测（庄/闲）"""
    if not history:
        return "庄"
    recent = history[:10]
    banker_cnt = sum(1 for h in recent if h.get("result") == "庄")
    player_cnt = sum(1 for h in recent if h.get("result") == "闲")
    # 斩龙/跟龙反弹策略
    return "闲" if banker_cnt >= 6 else "庄"

def parse_choice_baccarat_packet(raw_msg):
    """解压并解析 Choice 百家乐的数据包"""
    # 针对 zlib 二进制推送的自动解压机制
    if isinstance(raw_msg, bytes):
        try:
            raw_msg = zlib.decompress(raw_msg, 16 + zlib.MAX_WBITS).decode('utf-8')
        except Exception:
            try:
                raw_msg = zlib.decompress(raw_msg).decode('utf-8')
            except Exception:
                return None

    try:
        data = json.loads(raw_msg)
        # 支持 Game ID 结构例: GD051269240S1
        game_id = str(data.get("gameId", data.get("game_id", "")))
        if not game_id or "GD" not in game_id:
            return None

        room_id = "D" + game_id[2:4] # 提取 D51 到 D58
        shoe_no = str(data.get("shoeNo", data.get("shoe_no", "01")))
        game_no = str(data.get("roundNo", data.get("game_no", "01")))
        
        # 提取胜负（庄 Banker / 闲 Player / 和 Tie）
        winner_raw = str(data.get("winner", data.get("result", "Banker"))).lower()
        if "banker" in winner_raw or "1" in winner_raw:
            winner = "庄"
        elif "player" in winner_raw or "2" in winner_raw:
            winner = "闲"
        else:
            winner = "和"

        return {
            "room": room_id if room_id in global_data["baccarat"]["rooms"] else "D51",
            "shoe": shoe_no,
            "game": game_no,
            "result": winner,
            "game_id": game_id
        }
    except Exception:
        return None

def on_baccarat_message(ws, message):
    parsed = parse_choice_baccarat_packet(message)
    if not parsed:
        return

    room = parsed["room"]
    with data_lock:
        bacc = global_data["baccarat"]
        room_history = bacc["rooms"][room]

        # 预测当前局（对账）
        prediction = predict_baccarat_next(room_history)
        parsed["predict"] = prediction

        # 查重后推入历史列表
        if not any(item.get("game_id") == parsed["game_id"] for item in room_history):
            room_history.insert(0, parsed)
            bacc["rooms"][room] = room_history[:50] # 保留最近 50 局

        # 如果是主房间 (D51) 则同步全局状态
        if room == "D51":
            bacc["shoe_no"] = parsed["shoe"]
            bacc["game_no"] = parsed["game"]
            bacc["latest_result"] = parsed["result"]
            bacc["predicted_result"] = predict_baccarat_next(room_history)

            results = [h["result"] for h in room_history]
            counts = Counter(results)
            bacc["stats"]["banker_cnt"] = counts.get("庄", 0)
            bacc["stats"]["player_cnt"] = counts.get("闲", 0)
            bacc["stats"]["tie_cnt"] = counts.get("和", 0)

    save_data_json()
    print(f"🃏 [Choice 百家乐 {room}] 靴:{parsed['shoe']}-局:{parsed['game']} | 结果: {parsed['result']} | 预测: {parsed['predict']}")

def on_baccarat_error(ws, error):
    print(f"⚠️ [百家乐 WS 错误]: {error}")

def on_baccarat_close(ws, close_status_code, close_msg):
    print("🔌 [Choice 百家乐 WS 断开]，5秒后自动重连...")
    time.sleep(5)
    start_baccarat_ws()

def start_baccarat_ws():
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://gc.ckrkg.com"
    }
    ws = websocket.WebSocketApp(
        BACCARAT_WS_URL,
        header=headers,
        on_message=on_baccarat_message,
        on_error=on_baccarat_error,
        on_close=on_baccarat_close
    )
    ws.run_forever()

# ==================== 主入口 ====================
def main():
    print("=" * 60)
    print("🚀 WinGo & Choice 百家乐 (D51-D58) 双模数据采集已成功对接！")
    print("=" * 60)

    # 启动 WinGo 轮询线程
    wingo_thread = threading.Thread(target=wingo_loop, daemon=True)
    wingo_thread.start()

    # 启动 Choice 百家乐 WebSocket 监听线程
    baccarat_thread = threading.Thread(target=start_baccarat_ws, daemon=True)
    baccarat_thread.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n👋 收到退出信号，程序已安全终止。")

if __name__ == "__main__":
    main()
