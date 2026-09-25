import time
import requests
import hashlib
import json
import random
import threading
import zlib
from collections import Counter
import websocket

# ============================================================
# WinGo 配置
# ============================================================

WINGO_API_URL = "https://mzplayapi.com/api/webapi/GetNoaverageEmerdList"
WINGO_ORIGIN = "https://mzplay0.com"
WINGO_REFERER = "https://mzplay0.com/"
TYPE_ID = 30
LANGUAGE = 0

POLL_INTERVAL = 10
INIT_SCAN_PAGES = 5

# ============================================================
# Choice Baccarat WebSocket
# ============================================================

BACCARAT_WS_URL = "wss://et165.mdvuz.com:5030/"

# ============================================================
# 全局数据
# ============================================================

global_data = {
    "updated_at": 0,

    "wingo": {
        "stats": {
            "streak_val": "-",
            "streak_cnt": 0,
            "big_cnt": 0,
            "small_cnt": 0
        },

        "prediction": {
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
            "special": False
        },

        "draws": []
    },

    "baccarat": {
        "current_room": "D51",
        "shoe_no": "01",
        "game_no": "01",
        "latest_result": "庄",
        "predicted_result": "闲",

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
}

data_lock = threading.Lock()

session = requests.Session()

session.headers.update({
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/153.0.0.0 Safari/537.36",

    "Content-Type": "application/json;charset=UTF-8",
    "Origin": WINGO_ORIGIN,
    "Referer": WINGO_REFERER,
})


# ============================================================
# 工具
# ============================================================

def generate_random(length=32):
    return ''.join(
        random.choices("0123456789abcdef", k=length)
    )


def generate_signature(data):

    sign_data = {
        k: v
        for k, v in sorted(data.items())
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


def get_wingo_size(number):

    number = int(number)

    return "小" if 0 <= number <= 4 else "大"


# ============================================================
# WinGo 预测算法
# ============================================================

def predict_wingo_next(draws):

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

    nums = []

    sizes = []

    for d in draws:

        try:
            nums.append(int(d["number"]))
            sizes.append(d["size"])
        except Exception:
            continue

    if len(nums) < 10:
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

    # --------------------------------------------------------
    # 最新
    # --------------------------------------------------------

    last_num = nums[0]

    last_size = sizes[0]

    # --------------------------------------------------------
    # 指标 1：长龙
    # --------------------------------------------------------

    streak_cnt = 0

    for size in sizes:

        if size == last_size:
            streak_cnt += 1
        else:
            break

    # --------------------------------------------------------
    # 指标 2：马尔可夫转移
    # --------------------------------------------------------

    transition_counts = [0] * 10

    for i in range(len(nums) - 1):

        current_num = nums[i]

        previous_num = nums[i + 1]

        if previous_num == last_num:

            if 0 <= current_num <= 9:

                transition_counts[current_num] += 1

    max_transition = max(transition_counts)

    if max_transition > 0:

        markov_best_num = transition_counts.index(
            max_transition
        )

    else:

        markov_best_num = 5

    markov_size = (
        "大"
        if markov_best_num >= 5
        else "小"
    )

    # --------------------------------------------------------
    # 指标 3：近10期均值回归
    # --------------------------------------------------------

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

    # --------------------------------------------------------
    # 指标 4：0 / 5 特殊号
    # --------------------------------------------------------

    is_special_num = (
        last_num == 0
        or last_num == 5
    )

    # --------------------------------------------------------
    # 综合评分
    # --------------------------------------------------------

    big_score = 0.0

    small_score = 0.0

    # 马尔可夫
    if markov_size == "大":

        big_score += 1.5

    else:

        small_score += 1.5

    # 均值回归
    if mean_size == "大":

        big_score += 1.0

    elif mean_size == "小":

        small_score += 1.0

    # 长龙
    if streak_cnt >= 3:

        if last_size == "大":

            big_score += 1.2

        else:

            small_score += 1.2

    difference = abs(
        big_score - small_score
    )

    # --------------------------------------------------------
    # 最终方向
    # --------------------------------------------------------

    final_size = (
        "大"
        if big_score >= small_score
        else "小"
    )

    signal = "观望"

    confidence = "普通"

    # 指标冲突
    if difference < 0.8:

        signal = "观望"

        confidence = "避险观望"

    # 0 / 5
    elif is_special_num:

        signal = "观望"

        confidence = "避险观望"

    # 大
    elif big_score > small_score:

        final_size = "大"

        signal = "BUY"

        if big_score >= 2.5:

            confidence = "🔥高确信"

        else:

            confidence = "普通"

    # 小
    else:

        final_size = "小"

        signal = "SELL"

        if small_score >= 2.5:

            confidence = "🔥高确信"

        else:

            confidence = "普通"

    # --------------------------------------------------------
    # 具体数字
    # --------------------------------------------------------

    if final_size == "大":

        target_num = 7

        start_num = 5

        end_num = 10

    else:

        target_num = 2

        start_num = 0

        end_num = 5

    max_num_score = -1

    for i in range(start_num, end_num):

        if transition_counts[i] > max_num_score:

            max_num_score = transition_counts[i]

            target_num = i

    # 没有历史转移时使用中位数
    if max_transition == 0:

        target_num = (
            7
            if final_size == "大"
            else 2
        )

    return {
        "num": target_num,
        "size": final_size,
        "signal": signal,
        "confidence": confidence,

        "big_score": round(big_score, 2),
        "small_score": round(small_score, 2),
        "difference": round(difference, 2),

        "markov_num": markov_best_num,
        "markov_size": markov_size,

        "mean_size": mean_size,

        "streak": streak_cnt,

        "special": is_special_num
    }


# ============================================================
# 保存 data.json
# ============================================================

def save_data_json():

    with data_lock:

        global_data["updated_at"] = int(
            time.time()
        )

        with open(
            "data.json",
            "w",
            encoding="utf-8"
        ) as f:

            json.dump(
                global_data,
                f,
                ensure_ascii=False,
                indent=2
            )


# ============================================================
# WinGo API
# ============================================================

def fetch_wingo_draw_page(
    page_no=1,
    page_size=10
):

    payload = {
        "pageSize": page_size,
        "pageNo": page_no,
        "typeId": TYPE_ID,
        "language": LANGUAGE,
        "random": generate_random()
    }

    payload["signature"] = generate_signature(
        payload
    )

    payload["timestamp"] = int(
        time.time()
    )

    try:

        response = session.post(
            WINGO_API_URL,
            json=payload,
            timeout=15
        )

        data = response.json()

        if data.get("code") != 0:

            return []

        result = []

        for item in data.get(
            "data",
            {}
        ).get(
            "list",
            []
        ):

            try:

                number = int(
                    item["number"]
                )

                result.append({
                    "issueNumber":
                        str(item["issueNumber"]),

                    "number":
                        number,

                    "colour":
                        str(item["colour"]),

                    "size":
                        get_wingo_size(number)
                })

            except Exception:

                continue

        return result

    except Exception as e:

        print(
            f"⚠️ [WinGo API] 请求错误: {e}"
        )

        return []


# ============================================================
# 更新 WinGo
# ============================================================

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

    sizes = [
        d["size"]
        for d in draws
    ]

    size_counts = Counter(
        sizes
    )

    prediction = predict_wingo_next(
        draws
    )

    with data_lock:

        global_data["wingo"] = {

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
                draws
        }

    save_data_json()

    print(
        f"✅ [WinGo] "
        f"{len(draws)}期 | "
        f"长龙:{streak_val}x{streak_cnt} | "
        f"预测:{prediction['size']} "
        f"{prediction['num']} | "
        f"{prediction['confidence']}"
    )


# ============================================================
# WinGo 实时循环
# ============================================================

def wingo_loop():

    memory_draws = []

    seen_issues = set()

    print(
        f"🔍 [WinGo] "
        f"扫描最近 {INIT_SCAN_PAGES} 页..."
    )

    for page in range(
        1,
        INIT_SCAN_PAGES + 1
    ):

        page_data = fetch_wingo_draw_page(
            page_no=page,
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

        time.sleep(0.3)

    memory_draws.sort(
        key=lambda x:
            int(x["issueNumber"]),
        reverse=True
    )

    update_wingo_data(
        memory_draws
    )

    while True:

        time.sleep(
            POLL_INTERVAL
        )

        latest_page = (
            fetch_wingo_draw_page(
                page_no=1,
                page_size=10
            )
        )

        new_items = []

        for item in latest_page:

            issue = item[
                "issueNumber"
            ]

            if issue not in seen_issues:

                seen_issues.add(issue)

                new_items.append(
                    item
                )

        if new_items:

            new_items.sort(
                key=lambda x:
                    int(x["issueNumber"]),
                reverse=True
            )

            memory_draws = (
                new_items
                + memory_draws
            )

            # 防止内存无限增长
            memory_draws = (
                memory_draws[:200]
            )

            update_wingo_data(
                memory_draws
            )


# ============================================================
# Baccarat 预测
# ============================================================

def predict_baccarat_next(history):

    if not history:

        return "庄"

    recent = history[:10]

    banker_cnt = sum(
        1
        for h in recent
        if h.get("result") == "庄"
    )

    player_cnt = sum(
        1
        for h in recent
        if h.get("result") == "闲"
    )

    if banker_cnt >= 6:

        return "闲"

    if player_cnt >= 6:

        return "庄"

    # 数据不足以形成明显方向
    return "庄"


# ============================================================
# Baccarat 数据包解析
# ============================================================

def parse_choice_baccarat_packet(
    raw_msg
):

    if isinstance(
        raw_msg,
        bytes
    ):

        try:

            raw_msg = zlib.decompress(
                raw_msg,
                16 + zlib.MAX_WBITS
            ).decode("utf-8")

        except Exception:

            try:

                raw_msg = zlib.decompress(
                    raw_msg
                ).decode("utf-8")

            except Exception:

                return None

    try:

        data = json.loads(
            raw_msg
        )

        game_id = str(
            data.get(
                "gameId",
                data.get(
                    "game_id",
                    ""
                )
            )
        )

        if not game_id:

            return None

        if "GD" not in game_id:

            return None

        room_id = (
            "D"
            + game_id[2:4]
        )

        shoe_no = str(
            data.get(
                "shoeNo",
                data.get(
                    "shoe_no",
                    "01"
                )
            )
        )

        game_no = str(
            data.get(
                "roundNo",
                data.get(
                    "game_no",
                    "01"
                )
            )
        )

        winner_raw = str(
            data.get(
                "winner",
                data.get(
                    "result",
                    "Banker"
                )
            )
        ).lower()

        if (
            "banker" in winner_raw
            or winner_raw == "1"
        ):

            winner = "庄"

        elif (
            "player" in winner_raw
            or winner_raw == "2"
        ):

            winner = "闲"

        else:

            winner = "和"

        if room_id not in global_data[
            "baccarat"
        ][
            "rooms"
        ]:

            room_id = "D51"

        return {

            "room":
                room_id,

            "shoe":
                shoe_no,

            "game":
                game_no,

            "result":
                winner,

            "game_id":
                game_id
        }

    except Exception:

        return None


# ============================================================
# Baccarat WS
# ============================================================

def on_baccarat_message(
    ws,
    message
):

    parsed = (
        parse_choice_baccarat_packet(
            message
        )
    )

    if not parsed:

        return

    room = parsed[
        "room"
    ]

    with data_lock:

        bacc = global_data[
            "baccarat"
        ]

        room_history = bacc[
            "rooms"
        ][
            room
        ]

        prediction = (
            predict_baccarat_next(
                room_history
            )
        )

        parsed[
            "predict"
        ] = prediction

        exists = any(
            item.get(
                "game_id"
            ) == parsed[
                "game_id"
            ]
            for item in room_history
        )

        if not exists:

            room_history.insert(
                0,
                parsed
            )

            bacc[
                "rooms"
            ][
                room
            ] = room_history[
                :100
            ]

        if room == "D51":

            bacc[
                "shoe_no"
            ] = parsed[
                "shoe"
            ]

            bacc[
                "game_no"
            ] = parsed[
                "game"
            ]

            bacc[
                "latest_result"
            ] = parsed[
                "result"
            ]

            bacc[
                "predicted_result"
            ] = predict_baccarat_next(
                room_history
            )

            results = [
                h["result"]
                for h in room_history
            ]

            counts = Counter(
                results
            )

            bacc[
                "stats"
            ][
                "banker_cnt"
            ] = counts.get(
                "庄",
                0
            )

            bacc[
                "stats"
            ][
                "player_cnt"
            ] = counts.get(
                "闲",
                0
            )

            bacc[
                "stats"
            ][
                "tie_cnt"
            ] = counts.get(
                "和",
                0
            )

    save_data_json()

    print(
        f"🃏 [百家乐 {room}] "
        f"靴:{parsed['shoe']} "
        f"局:{parsed['game']} | "
        f"结果:{parsed['result']} | "
        f"预测:{parsed['predict']}"
    )


def on_baccarat_error(
    ws,
    error
):

    print(
        f"⚠️ [百家乐 WS 错误]: {error}"
    )


def on_baccarat_close(
    ws,
    close_status_code,
    close_msg
):

    print(
        "🔌 [Choice百家乐 WS断开]"
    )

    print(
        "5秒后自动重连..."
    )

    time.sleep(5)

    start_baccarat_ws()


def start_baccarat_ws():

    headers = {
        "User-Agent":
            "Mozilla/5.0 "
            "(Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 "
            "(KHTML, like Gecko) "
            "Chrome/153.0.0.0 "
            "Safari/537.36",

        "Origin":
            "https://gc.ckrkg.com"
    }

    ws = websocket.WebSocketApp(

        BACCARAT_WS_URL,

        header=headers,

        on_message=
            on_baccarat_message,

        on_error=
            on_baccarat_error,

        on_close=
            on_baccarat_close
    )

    ws.run_forever()


# ============================================================
# MAIN
# ============================================================

def main():

    print("=" * 65)

    print(
        "🚀 WinGo + Choice百家乐 "
        "实时数据采集系统"
    )

    print(
        "🎯 WinGo：4指标共振预测"
    )

    print(
        "🃏 Baccarat：D51-D58 WebSocket"
    )

    print("=" * 65)

    wingo_thread = threading.Thread(
        target=wingo_loop,
        daemon=True
    )

    wingo_thread.start()

    baccarat_thread = threading.Thread(
        target=start_baccarat_ws,
        daemon=True
    )

    baccarat_thread.start()

    try:

        while True:

            time.sleep(1)

    except KeyboardInterrupt:

        print(
            "\n👋 程序已安全退出"
        )


if __name__ == "__main__":

    main()
