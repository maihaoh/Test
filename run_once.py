import time
import requests
import hashlib
import json
import random
import os
from collections import Counter

# ============================================================
# 配置
# ============================================================

API_URL = (
    "https://mzplayapi.com/"
    "api/webapi/GetNoaverageEmerdList"
)

ORIGIN = "https://mzplay0.com"
REFERER = "https://mzplay0.com/"

TYPE_ID = 30
LANGUAGE = 0

INIT_SCAN_PAGES = 5


# ============================================================
# Session
# ============================================================

session = requests.Session()

session.headers.update({

    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 "
        "(KHTML, like Gecko) "
        "Chrome/153.0.0.0 Safari/537.36",

    "Content-Type":
        "application/json;charset=UTF-8",

    "Origin":
        ORIGIN,

    "Referer":
        REFERER
})


# ============================================================
# 工具
# ============================================================

def generate_random(length=32):

    return ''.join(
        random.choices(
            "0123456789abcdef",
            k=length
        )
    )


def generate_signature(data):

    sign_data = {

        k: v

        for k, v in sorted(
            data.items()
        )

        if k not in (
            "signature",
            "timestamp",
            "track",
            "xosoBettingData"
        )

        and v is not None

        and v != ""
    }

    json_str = json.dumps(
        sign_data,
        separators=(",", ":"),
        ensure_ascii=False
    )

    return hashlib.md5(
        json_str.encode("utf-8")
    ).hexdigest().upper()


def get_size(number):

    number = int(number)

    return (
        "小"
        if 0 <= number <= 4
        else "大"
    )


# ============================================================
# 4指标 WinGo预测
# ============================================================

def predict_next_number(draws):

    if not draws or len(draws) < 10:

        return {

            "num": 5,

            "size": "大",

            "signal": "观望",

            "confidence": "低",

            "big_score": 0,

            "small_score": 0,

            "difference": 0,

            "markov_num": 5,

            "markov_size": "大",

            "mean_size": "平",

            "streak": 0,

            "special": False
        }

    nums = [
        int(d["number"])
        for d in draws
    ]

    sizes = [
        d["size"]
        for d in draws
    ]

    last_num = nums[0]

    last_size = sizes[0]

    # ========================================================
    # 1. 长龙
    # ========================================================

    streak_cnt = 0

    for size in sizes:

        if size == last_size:

            streak_cnt += 1

        else:

            break

    # ========================================================
    # 2. 马尔可夫
    # ========================================================

    transition_counts = [0] * 10

    for i in range(
        len(nums) - 1
    ):

        current_num = nums[i]

        previous_num = nums[i + 1]

        if previous_num == last_num:

            if 0 <= current_num <= 9:

                transition_counts[
                    current_num
                ] += 1

    max_transition = max(
        transition_counts
    )

    if max_transition > 0:

        markov_best_num = (
            transition_counts.index(
                max_transition
            )
        )

    else:

        markov_best_num = 5

    markov_size = (
        "大"
        if markov_best_num >= 5
        else "小"
    )

    # ========================================================
    # 3. 均值回归
    # ========================================================

    recent10 = nums[:10]

    big_count = sum(
        1
        for n in recent10
        if n >= 5
    )

    if big_count >= 7:

        mean_size = "小"

    elif big_count <= 3:

        mean_size = "大"

    else:

        mean_size = "平"

    # ========================================================
    # 4. 0 / 5特殊号
    # ========================================================

    is_special_num = (
        last_num == 0
        or last_num == 5
    )

    # ========================================================
    # 综合评分
    # ========================================================

    big_score = 0.0

    small_score = 0.0

    if markov_size == "大":

        big_score += 1.5

    else:

        small_score += 1.5

    if mean_size == "大":

        big_score += 1.0

    elif mean_size == "小":

        small_score += 1.0

    if streak_cnt >= 3:

        if last_size == "大":

            big_score += 1.2

        else:

            small_score += 1.2

    difference = abs(
        big_score - small_score
    )

    final_size = (
        "大"
        if big_score >= small_score
        else "小"
    )

    signal = "观望"

    confidence = "普通"

    if difference < 0.8:

        signal = "观望"

        confidence = "避险观望"

    elif is_special_num:

        signal = "观望"

        confidence = "避险观望"

    elif big_score > small_score:

        final_size = "大"

        signal = "BUY"

        confidence = (
            "🔥高确信"
            if big_score >= 2.5
            else "普通"
        )

    else:

        final_size = "小"

        signal = "SELL"

        confidence = (
            "🔥高确信"
            if small_score >= 2.5
            else "普通"
        )

    # ========================================================
    # 数字
    # ========================================================

    if final_size == "大":

        target_num = 7

        start_num = 5

        end_num = 10

    else:

        target_num = 2

        start_num = 0

        end_num = 5

    max_num_score = -1

    for i in range(
        start_num,
        end_num
    ):

        if (
            transition_counts[i]
            > max_num_score
        ):

            max_num_score = (
                transition_counts[i]
            )

            target_num = i

    if max_transition == 0:

        target_num = (
            7
            if final_size == "大"
            else 2
        )

    return {

        "num":
            target_num,

        "size":
            final_size,

        "signal":
            signal,

        "confidence":
            confidence,

        "big_score":
            round(
                big_score,
                2
            ),

        "small_score":
            round(
                small_score,
                2
            ),

        "difference":
            round(
                difference,
                2
            ),

        "markov_num":
            markov_best_num,

        "markov_size":
            markov_size,

        "mean_size":
            mean_size,

        "streak":
            streak_cnt,

        "special":
            is_special_num
    }


# ============================================================
# API
# ============================================================

def fetch_draw_page(
    page_no=1,
    page_size=10
):

    payload = {

        "pageSize":
            page_size,

        "pageNo":
            page_no,

        "typeId":
            TYPE_ID,

        "language":
            LANGUAGE,

        "random":
            generate_random()
    }

    payload[
        "signature"
    ] = generate_signature(
        payload
    )

    payload[
        "timestamp"
    ] = int(time.time())

    try:

        res = session.post(
            API_URL,
            json=payload,
            timeout=15
        )

        data = res.json()

        if data.get(
            "code"
        ) != 0:

            return []

        parsed = []

        for item in data.get(
            "data",
            {}
        ).get(
            "list",
            []
        ):

            number = int(
                item["number"]
            )

            parsed.append({

                "issueNumber":
                    str(
                        item[
                            "issueNumber"
                        ]
                    ),

                "number":
                    number,

                "colour":
                    str(
                        item["colour"]
                    ),

                "size":
                    get_size(
                        number
                    )
            })

        return parsed

    except Exception as e:

        print(
            f"⚠️ 请求失败: {e}"
        )

        return []


# ============================================================
# Main
# ============================================================

def main():

    memory_draws = []

    seen_issues = set()

    print(
        f"🔍 扫描最近 "
        f"{INIT_SCAN_PAGES * 10} 期..."
    )

    for p in range(
        1,
        INIT_SCAN_PAGES + 1
    ):

        page_data = fetch_draw_page(
            page_no=p,
            page_size=10
        )

        for item in page_data:

            issue = item[
                "issueNumber"
            ]

            if issue not in seen_issues:

                seen_issues.add(issue)

                memory_draws.append(
                    item
                )

        time.sleep(0.2)

    memory_draws.sort(
        key=lambda x:
            int(x["issueNumber"]),
        reverse=True
    )

    if not memory_draws:

        print(
            "❌ 未获取到数据"
        )

        return

    # ========================================================
    # WinGo统计
    # ========================================================

    streak_val = (
        memory_draws[0]["size"]
    )

    streak_cnt = 0

    for d in memory_draws:

        if d["size"] == streak_val:

            streak_cnt += 1

        else:

            break

    sizes = [
        d["size"]
        for d in memory_draws
    ]

    size_counts = Counter(
        sizes
    )

    prediction = (
        predict_next_number(
            memory_draws
        )
    )

    # ========================================================
    # 读取旧 data.json
    # 保留 Baccarat
    # ========================================================

    old_data = {}

    if os.path.exists(
        "data.json"
    ):

        try:

            with open(
                "data.json",
                "r",
                encoding="utf-8"
            ) as f:

                old_data = json.load(f)

        except Exception:

            old_data = {}

    # ========================================================
    # 保留 Baccarat
    # ========================================================

    baccarat_data = (
        old_data.get(
            "baccarat",
            {
                "current_room": "D51",
                "shoe_no": "01",
                "game_no": "01",
                "latest_result": "--",
                "predicted_result": "--",

                "stats": {
                    "banker_cnt": 0,
                    "player_cnt": 0,
                    "tie_cnt": 0,
                    "win_rate": 0
                },

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
        )
    )

    # ========================================================
    # 最终 data.json
    # ========================================================

    dashboard_payload = {

        "updated_at":
            int(time.time()),

        "wingo": {

            "stats": {

                "streak_val":
                    streak_val,

                "streak_cnt":
                    streak_cnt,

                "big_cnt":
                    size_counts.get(
                        "大",
                        0
                    ),

                "small_cnt":
                    size_counts.get(
                        "小",
                        0
                    )
            },

            "prediction":
                prediction,

            "draws":
                memory_draws
        },

        "baccarat":
            baccarat_data
    }

    with open(
        "data.json",
        "w",
        encoding="utf-8"
    ) as f:

        json.dump(
            dashboard_payload,
            f,
            ensure_ascii=False,
            indent=2
        )

    print(
        "✅ data.json 更新成功"
    )

    print(
        f"🎯 预测: "
        f"{prediction['size']} "
        f"{prediction['num']}"
    )

    print(
        f"📊 Score: "
        f"大={prediction['big_score']} "
        f"小={prediction['small_score']}"
    )

    print(
        f"📌 状态: "
        f"{prediction['confidence']}"
    )


if __name__ == "__main__":

    main()
