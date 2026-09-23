import time
import requests
import hashlib
import json
import random
from collections import Counter

API_URL = "https://mzplayapi.com/api/webapi/GetNoaverageEmerdList"
ORIGIN = "https://mzplay0.com"
REFERER = "https://mzplay0.com/"

TYPE_ID = 30
LANGUAGE = 0
POLL_INTERVAL = 10     # 每 10 秒轮询一次
INIT_SCAN_PAGES = 5    # 刚启动时自动扫描的页数

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Content-Type": "application/json;charset=UTF-8",
    "Origin": ORIGIN,
    "Referer": REFERER,
})

def generate_random(length=32):
    return ''.join(random.choices("0123456789abcdef", k=length))

def generate_signature(data):
    sign_data = {k: v for k, v in sorted(data.items()) if k not in ("signature", "timestamp", "track", "xosoBettingData") and v is not None and v != ""}
    json_str = json.dumps(sign_data, separators=(",", ":"), ensure_ascii=False)
    return hashlib.md5(json_str.encode("utf-8")).hexdigest().upper()

def get_size(number):
    return "小" if 0 <= int(number) <= 4 else "大"

def fetch_draw_page(page_no=1, page_size=10):
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
        res = session.post(API_URL, json=payload, timeout=15)
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
                "size": get_size(num)
            })
        return parsed_list
    except Exception as e:
        print(f"⚠️ API 请求错误: {e}")
        return []

def update_data_json(draws):
    """计算统计指标并写出到 data.json，供 Dashboard 展示"""
    if not draws:
        return

    # 1. 计算长龙
    streak_val = draws[0]["size"]
    streak_cnt = 0
    for d in draws:
        if d["size"] == streak_val:
            streak_cnt += 1
        else:
            break

    # 2. 统计大小分布
    sizes = [d["size"] for d in draws]
    size_counts = Counter(sizes)

    # 封装输出 payload
    dashboard_payload = {
        "updated_at": int(time.time()),
        "stats": {
            "streak_val": streak_val,
            "streak_cnt": streak_cnt,
            "big_cnt": size_counts.get("大", 0),
            "small_cnt": size_counts.get("小", 0)
        },
        "draws": draws
    }

    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(dashboard_payload, f, ensure_ascii=False, indent=2)

    print(f"✅ 已成功同步 {len(draws)} 期数据至 data.json (长龙: {streak_val}x{streak_cnt})")

def main():
    print("=" * 60)
    print("🎯 WinGo GitHub Dashboard 服务端脚本启动")
    print("=" * 60)

    memory_draws = []
    seen_issues = set()

    # 初始化扫描
    print(f"🔍 刚打开程序，自动扫描前 {INIT_SCAN_PAGES} 页历史数据...")
    for p in range(1, INIT_SCAN_PAGES + 1):
        page_data = fetch_draw_page(page_no=p, page_size=10)
        for item in page_data:
            if item["issueNumber"] not in seen_issues:
                seen_issues.add(item["issueNumber"])
                memory_draws.append(item)
        time.sleep(0.3)

    memory_draws.sort(key=lambda x: int(x["issueNumber"]), reverse=True)
    update_data_json(memory_draws)

    # 持续轮询更新
    try:
        while True:
            time.sleep(POLL_INTERVAL)
            latest_page = fetch_draw_page(page_no=1, page_size=10)
            new_items = []

            for item in latest_page:
                if item["issueNumber"] not in seen_issues:
                    seen_issues.add(item["issueNumber"])
                    new_items.append(item)

            if new_items:
                new_items.sort(key=lambda x: int(x["issueNumber"]), reverse=True)
                memory_draws = new_items + memory_draws
                update_data_json(memory_draws)

    except KeyboardInterrupt:
        print("\n退出程序")

if __name__ == "__main__":
    main()