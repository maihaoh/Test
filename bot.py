import time
import requests
import hashlib
import json
import random
import threading
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

# ==================== 百家乐 配置 ====================
BACCARAT_WS_URL = "wss://et165.mdvuz.com:5030/"

# 全局内存数据仓库
global_data = {
    "updated_at": 0,
    "wingo": {
        "stats": {"streak_val": "-", "streak_cnt": 0, "big_cnt": 0, "small_cnt": 0},
        "draws": []
    },
    "baccarat": {
        "shoe_no": "--",
        "game_no": "--",
        "latest_result": "--",    # 庄 / 闲 / 和
        "predicted_result": "闲", # 预测推荐
        "stats": {"banker_cnt": 0, "player_cnt": 0, "tie_cnt": 0, "win_rate": 0},
        "history": []
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
    """写出全局数据到 data.json"""
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

# ==================== 百家乐 核心逻辑 ====================
def parse_baccarat_result(raw_msg):
    """解析 WebSocket 传回的百家乐开奖包"""
    try:
        data = json.loads(raw_msg)
        shoe_no = data.get("shoeNo", "01")
        game_no = data.get("gameNo", "01")
        
        # 结果映射示例：1-庄, 2-闲, 3-和
        res_code = data.get("result", 1)
        result_map = {1: "庄", 2: "闲", 3: "和"}
        winner = result_map.get(res_code, "庄")

        return {
            "shoe_no": str(shoe_no),
            "game_no": str(game_no),
            "result": winner
        }
    except Exception:
        return None

def on_baccarat_message(ws, message):
    parsed = parse_baccarat_result(message)
    if not parsed:
        return

    with data_lock:
        bacc = global_data["baccarat"]
        bacc["shoe_no"] = parsed["shoe_no"]
        bacc["game_no"] = parsed["game_no"]
        bacc["latest_result"] = parsed["result"]
        
        # 更新历史列表与统计
        bacc["history"].insert(0, parsed)
        bacc["history"] = bacc["history"][:50]  # 保留最近 50 局

        results = [h["result"] for h in bacc["history"]]
        counts = Counter(results)
        
        bacc["stats"]["banker_cnt"] = counts.get("庄", 0)
        bacc["stats"]["player_cnt"] = counts.get("闲", 0)
        bacc["stats"]["tie_cnt"] = counts.get("和", 0)

        # 动态智能推荐逻辑 (示例: 顺势跟庄闲)
        bacc["predicted_result"] = "庄" if counts.get("庄", 0) >= counts.get("闲", 0) else "闲"

    save_data_json()
    print(f"🃏 [百家乐] 开奖: 靴号{parsed['shoe_no']}-局号{parsed['game_no']} -> 结果: {parsed['result']}")

def on_baccarat_error(ws, error):
    print(f"⚠️ [百家乐 WS 错误]: {error}")

def on_baccarat_close(ws, close_status_code, close_msg):
    print("🔌 [百家乐 WS 断开连接]，准备重连...")
    time.sleep(5)
    start_baccarat_ws()

def start_baccarat_ws():
    ws = websocket.WebSocketApp(
        BACCARAT_WS_URL,
        on_message=on_baccarat_message,
        on_error=on_baccarat_error,
        on_close=on_baccarat_close
    )
    ws.run_forever()

# ==================== 主入口 ====================
def main():
    print("=" * 60)
    print("🚀 WinGo & 百家乐 双模数据采集与 Dashboard 同步服务已启动")
    print("=" * 60)

    # 启动 WinGo 轮询线程
    wingo_thread = threading.Thread(target=wingo_loop, daemon=True)
    wingo_thread.start()

    # 启动 百家乐 WebSocket 线程
    baccarat_thread = threading.Thread(target=start_baccarat_ws, daemon=True)
    baccarat_thread.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n👋 收到退出信号，服务已安全终止。")

if __name__ == "__main__":
    main()
