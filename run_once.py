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
INIT_SCAN_PAGES = 5  # 抓取最近 5 页（50期）

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
        print(f"⚠️ 请求失败: {e}")
        return []

def main():
    memory_draws = []
    seen_issues = set()

    for p in range(1, INIT_SCAN_PAGES + 1):
        page_data = fetch_draw_page(page_no=p, page_size=10)
        for item in page_data:
            if item["issueNumber"] not in seen_issues:
                seen_issues.add(item["issueNumber"])
                memory_draws.append(item)
        time.sleep(0.2)

    memory_draws.sort(key=lambda x: int(x["issueNumber"]), reverse=True)

    if not memory_draws:
        print("未获取到数据，跳过更新")
        return

    # 计算统计数据
    streak_val = memory_draws[0]["size"]
    streak_cnt = 0
    for d in memory_draws:
        if d["size"] == streak_val:
            streak_cnt += 1
        else:
            break

    sizes = [d["size"] for d in memory_draws]
    size_counts = Counter(sizes)

    dashboard_payload = {
        "updated_at": int(time.time()),
        "stats": {
            "streak_val": streak_val,
            "streak_cnt": streak_cnt,
            "big_cnt": size_counts.get("大", 0),
            "small_cnt": size_counts.get("小", 0)
        },
        "draws": memory_draws
    }

    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(dashboard_payload, f, ensure_ascii=False, indent=2)

    print("✅ data.json 更新成功！")

if __name__ == "__main__":
    main()
