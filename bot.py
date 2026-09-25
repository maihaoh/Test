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
# Baccarat WebSocket
# ============================================================

BACCARAT_WS_URL = "wss://et165.mdvuz.com:5030/"

BACCARAT_ROOMS = [
    "D51",
    "D52",
    "D53",
    "D54",
    "D55",
    "D56",
    "D57",
    "D58"
]

DATA_FILE = "data.json"

# ============================================================
# Lock
# ============================================================

data_lock = threading.RLock()

# ============================================================
# HTTP Session
# ============================================================

session = requests.Session()

session.headers.update({
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 "
        "(KHTML, like Gecko) "
        "Chrome/153.0.0.0 Safari/537.36",

    "Content-Type": "application/json;charset=UTF-8",

    "Origin": WINGO_ORIGIN,

    "Referer": WINGO_REFERER,
})


# ============================================================
# 默认 Baccarat Room
# ============================================================

def create_baccarat_rooms():

    return {
        room: []
        for room in BACCARAT_ROOMS
    }


# ============================================================
# 默认数据
# ============================================================

def create_default_data():

    return {
        "updated_at": 0,

        "wingo": {
            "stats": {
                "streak_val": "-",
                "streak_cnt": 0,
                "big_cnt": 0,
                "small_cnt": 0
            },

            "draws": []
        },

        "baccarat": {

            "current_room": "D51",

            "shoe_no": "01",

            "game_no": "01",

            "latest_result": "-",

            "predicted_result": "-",

            "prediction_status": "WAIT",

            "stats": {
                "banker_cnt": 0,
                "player_cnt": 0,
                "tie_cnt": 0,

                "prediction_count": 0,
                "win_count": 0,
                "loss_count": 0,

                "win_rate": 0
            },

            "analysis": {
                "signal": "WAIT",
                "confidence": 0,

                "streak_result": "-",
                "streak_count": 0,

                "recent5": {
                    "庄": 0,
                    "闲": 0,
                    "和": 0
                },

                "recent10": {
                    "庄": 0,
                    "闲": 0,
                    "和": 0
                },

                "recent20": {
                    "庄": 0,
                    "闲": 0,
                    "和": 0
                },

                "recent30": {
                    "庄": 0,
                    "闲": 0,
                    "和": 0
                },

                "pattern": "暂无数据",

                "reason": []
            },

            "rooms": create_baccarat_rooms()
        }
    }


# ============================================================
# 读取 data.json
# ============================================================

def load_data_json():

    default_data = create_default_data()

    try:

        with open(
            DATA_FILE,
            "r",
            encoding="utf-8"
        ) as f:

            old_data = json.load(f)

        # ----------------------------------------------------
        # 兼容你旧版 data.json
        # ----------------------------------------------------

        if "wingo" not in old_data:

            if "draws" in old_data:

                default_data["wingo"]["draws"] = old_data.get(
                    "draws",
                    []
                )

                default_data["wingo"]["stats"] = old_data.get(
                    "stats",
                    default_data["wingo"]["stats"]
                )

        else:

            default_data["wingo"] = old_data.get(
                "wingo",
                default_data["wingo"]
            )

        # ----------------------------------------------------
        # Baccarat
        # ----------------------------------------------------

        if isinstance(old_data.get("baccarat"), dict):

            old_baccarat = old_data["baccarat"]

            for key in [
                "current_room",
                "shoe_no",
                "game_no",
                "latest_result",
                "predicted_result",
                "prediction_status"
            ]:

                if key in old_baccarat:

                    default_data["baccarat"][key] = old_baccarat[key]

            if isinstance(
                old_baccarat.get("stats"),
                dict
            ):

                default_data["baccarat"]["stats"].update(
                    old_baccarat["stats"]
                )

            if isinstance(
                old_baccarat.get("analysis"),
                dict
            ):

                default_data["baccarat"]["analysis"].update(
                    old_baccarat["analysis"]
                )

            if isinstance(
                old_baccarat.get("rooms"),
                dict
            ):

                for room in BACCARAT_ROOMS:

                    if room in old_baccarat["rooms"]:

                        default_data["baccarat"]["rooms"][room] = (
                            old_baccarat["rooms"][room]
                        )

        return default_data

    except Exception as e:

        print(f"⚠️ 读取 data.json 失败，使用新结构: {e}")

        return default_data


# ============================================================
# 全局数据
# ============================================================

global_data = load_data_json()


# ============================================================
# 保存 JSON
# ============================================================

def save_data_json():

    with data_lock:

        global_data["updated_at"] = int(time.time())

        temp_file = DATA_FILE + ".tmp"

        try:

            with open(
                temp_file,
                "w",
                encoding="utf-8"
            ) as f:

                json.dump(
                    global_data,
                    f,
                    ensure_ascii=False,
                    indent=2
                )

            # Windows 下替换
            import os

            if os.path.exists(DATA_FILE):

                os.remove(DATA_FILE)

            os.rename(
                temp_file,
                DATA_FILE
            )

        except Exception as e:

            print(f"⚠️ 保存 data.json 失败: {e}")


# ============================================================
# 工具
# ============================================================

def generate_random(length=32):

    return "".join(
        random.choices(
            "0123456789abcdef",
            k=length
        )
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

    payload["signature"] = generate_signature(payload)

    payload["timestamp"] = int(time.time())

    try:

        response = session.post(
            WINGO_API_URL,
            json=payload,
            timeout=15
        )

        data = response.json()

        if data.get("code") != 0:

            return []

        parsed = []

        for item in data.get(
            "data",
            {}
        ).get(
            "list",
            []
        ):

            try:

                number = int(item["number"])

                parsed.append({
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

        return parsed

    except Exception as e:

        print(
            f"⚠️ [WinGo] API 请求错误: {e}"
        )

        return []


# ============================================================
# WinGo 更新
# ============================================================

def update_wingo_data(draws):

    if not draws:

        return

    streak_val = draws[0]["size"]

    streak_cnt = 0

    for item in draws:

        if item["size"] == streak_val:

            streak_cnt += 1

        else:

            break

    sizes = [
        item["size"]
        for item in draws
    ]

    size_counts = Counter(sizes)

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

            "draws":
                draws
        }

    save_data_json()

    print(
        f"✅ [WinGo] 同步 "
        f"{len(draws)} 期 "
        f"(长龙: {streak_val} x {streak_cnt})"
    )


# ============================================================
# WinGo Loop
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

            issue = item["issueNumber"]

            if issue not in seen_issues:

                seen_issues.add(issue)

                memory_draws.append(item)

        time.sleep(0.3)

    memory_draws.sort(
        key=lambda x: int(
            x["issueNumber"]
        ),
        reverse=True
    )

    if memory_draws:

        update_wingo_data(
            memory_draws
        )

    while True:

        time.sleep(
            POLL_INTERVAL
        )

        latest_page = fetch_wingo_draw_page(
            page_no=1,
            page_size=10
        )

        new_items = []

        for item in latest_page:

            issue = item["issueNumber"]

            if issue not in seen_issues:

                seen_issues.add(issue)

                new_items.append(item)

        if new_items:

            new_items.sort(
                key=lambda x: int(
                    x["issueNumber"]
                ),
                reverse=True
            )

            memory_draws = (
                new_items +
                memory_draws
            )

            # 防止无限增长
            memory_draws = memory_draws[:500]

            update_wingo_data(
                memory_draws
            )


# ============================================================
# Baccarat
# ============================================================

def clean_baccarat_history(history):

    return [
        item
        for item in history
        if item.get("result")
        in ("庄", "闲", "和")
    ]


def get_bp_sequence(history):

    """
    和局不加入庄/闲走势。
    """

    return [
        item["result"]
        for item in clean_baccarat_history(history)
        if item["result"] in ("庄", "闲")
    ]


def get_streak(history):

    sequence = get_bp_sequence(history)

    if not sequence:

        return "-", 0

    latest = sequence[0]

    count = 0

    for result in sequence:

        if result == latest:

            count += 1

        else:

            break

    return latest, count


def get_recent_stats(
    history,
    count
):

    results = [
        item.get("result")
        for item in history
    ]

    results = [
        r for r in results
        if r in ("庄", "闲", "和")
    ]

    recent = results[:count]

    return {
        "庄":
            recent.count("庄"),

        "闲":
            recent.count("闲"),

        "和":
            recent.count("和")
    }


def detect_pattern(history):

    seq = get_bp_sequence(history)

    if len(seq) < 4:

        return "暂无足够数据"

    last = seq[:6]

    # --------------------------------------------------------
    # 连庄
    # --------------------------------------------------------

    if len(last) >= 3:

        if (
            last[0] == last[1] ==
            last[2]
        ):

            return (
                f"当前{last[0]}连续"
                f"{len(last)}局附近"
            )

    # --------------------------------------------------------
    # 1-1 跳
    # --------------------------------------------------------

    if len(last) >= 4:

        if (
            last[0] != last[1] and
            last[1] != last[2] and
            last[2] != last[3]
        ):

            return "疑似1-1跳路"

    # --------------------------------------------------------
    # 2-2
    # --------------------------------------------------------

    if len(last) >= 4:

        if (
            last[0] == last[1] and
            last[2] == last[3] and
            last[0] != last[2]
        ):

            return "疑似2-2走势"

    # --------------------------------------------------------
    # 3-3
    # --------------------------------------------------------

    if len(last) >= 6:

        if (
            last[0] == last[1] == last[2] and
            last[3] == last[4] == last[5] and
            last[0] != last[3]
        ):

            return "疑似3-3走势"

    return "混合走势"


# ============================================================
# Baccarat Prediction
# ============================================================

def predict_baccarat_next(history):

    """
    仅根据已经结束的局进行分析。

    这里不是保证结果的算法。
    如果信号冲突，返回 WAIT。
    """

    sequence = get_bp_sequence(history)

    if len(sequence) < 6:

        return {
            "signal": "WAIT",
            "prediction": "-",
            "confidence": 0,
            "reason": [
                "历史数据不足6局"
            ]
        }

    recent5 = sequence[:5]

    recent10 = sequence[:10]

    recent20 = sequence[:20]

    banker_score = 0.0

    player_score = 0.0

    reasons = []

    # --------------------------------------------------------
    # 当前长龙
    # --------------------------------------------------------

    streak_result, streak_count = get_streak(history)

    if streak_count >= 3:

        if streak_result == "庄":

            banker_score += 1.5

            reasons.append(
                f"当前庄连续{streak_count}局"
            )

        elif streak_result == "闲":

            player_score += 1.5

            reasons.append(
                f"当前闲连续{streak_count}局"
            )

    # --------------------------------------------------------
    # 最近5
    # --------------------------------------------------------

    b5 = recent5.count("庄")

    p5 = recent5.count("闲")

    if b5 >= 4:

        banker_score += 1.0

        reasons.append(
            "最近5局庄占多数"
        )

    elif p5 >= 4:

        player_score += 1.0

        reasons.append(
            "最近5局闲占多数"
        )

    # --------------------------------------------------------
    # 最近10
    # --------------------------------------------------------

    b10 = recent10.count("庄")

    p10 = recent10.count("闲")

    if b10 - p10 >= 3:

        banker_score += 1.5

        reasons.append(
            "最近10局庄明显较多"
        )

    elif p10 - b10 >= 3:

        player_score += 1.5

        reasons.append(
            "最近10局闲明显较多"
        )

    # --------------------------------------------------------
    # 最近20
    # --------------------------------------------------------

    b20 = recent20.count("庄")

    p20 = recent20.count("闲")

    if b20 - p20 >= 4:

        banker_score += 1.0

        reasons.append(
            "最近20局庄偏多"
        )

    elif p20 - b20 >= 4:

        player_score += 1.0

        reasons.append(
            "最近20局闲偏多"
        )

    # --------------------------------------------------------
    # Pattern
    # --------------------------------------------------------

    pattern = detect_pattern(history)

    if pattern == "疑似1-1跳路":

        if sequence[0] == "庄":

            player_score += 1.0

        else:

            banker_score += 1.0

        reasons.append(
            "检测到疑似1-1跳路"
        )

    elif pattern == "疑似2-2走势":

        if sequence[0] == "庄":

            banker_score += 0.7

        else:

            player_score += 0.7

        reasons.append(
            "检测到疑似2-2走势"
        )

    elif pattern == "疑似3-3走势":

        if sequence[0] == "庄":

            banker_score += 0.7

        else:

            player_score += 0.7

        reasons.append(
            "检测到疑似3-3走势"
        )

    # --------------------------------------------------------
    # 最终判断
    # --------------------------------------------------------

    difference = abs(
        banker_score -
        player_score
    )

    total_score = (
        banker_score +
        player_score
    )

    if total_score <= 0:

        return {
            "signal": "WAIT",
            "prediction": "-",
            "confidence": 0,
            "reason": [
                "没有明确方向"
            ]
        }

    # 信号差距太小
    if difference < 1.0:

        return {
            "signal": "WAIT",
            "prediction": "-",
            "confidence": int(
                difference / 3 * 100
            ),
            "reason":
                reasons +
                ["庄闲信号冲突，观望"]
        }

    if banker_score > player_score:

        prediction = "庄"

    else:

        prediction = "闲"

    confidence = int(
        min(
            95,
            50 +
            difference * 12
        )
    )

    return {
        "signal": prediction,
        "prediction": prediction,
        "confidence": confidence,
        "reason": reasons,
        "score": {
            "庄":
                round(
                    banker_score,
                    2
                ),

            "闲":
                round(
                    player_score,
                    2
                )
        }
    }


# ============================================================
# 更新 Baccarat 分析
# ============================================================

def update_baccarat_analysis(
    room
):

    with data_lock:

        history = global_data[
            "baccarat"
        ][
            "rooms"
        ].get(
            room,
            []
        )

        prediction = predict_baccarat_next(
            history
        )

        streak_result, streak_count = (
            get_streak(history)
        )

        analysis = {
            "signal":
                prediction.get(
                    "signal",
                    "WAIT"
                ),

            "confidence":
                prediction.get(
                    "confidence",
                    0
                ),

            "streak_result":
                streak_result,

            "streak_count":
                streak_count,

            "recent5":
                get_recent_stats(
                    history,
                    5
                ),

            "recent10":
                get_recent_stats(
                    history,
                    10
                ),

            "recent20":
                get_recent_stats(
                    history,
                    20
                ),

            "recent30":
                get_recent_stats(
                    history,
                    30
                ),

            "pattern":
                detect_pattern(
                    history
                ),

            "reason":
                prediction.get(
                    "reason",
                    []
                ),

            "score":
                prediction.get(
                    "score",
                    {
                        "庄": 0,
                        "闲": 0
                    }
                )
        }

        global_data[
            "baccarat"
        ][
            "analysis"
        ] = analysis

        global_data[
            "baccarat"
        ][
            "predicted_result"
        ] = prediction.get(
            "prediction",
            "-"
        )

        global_data[
            "baccarat"
        ][
            "prediction_status"
        ] = prediction.get(
            "signal",
            "WAIT"
        )


# ============================================================
# Baccarat Packet
# ============================================================

def parse_choice_baccarat_packet(
    raw_msg
):

    if isinstance(
        raw_msg,
        bytes
    ):

        decompressed = None

        try:

            decompressed = zlib.decompress(
                raw_msg,
                16 + zlib.MAX_WBITS
            )

        except Exception:

            try:

                decompressed = zlib.decompress(
                    raw_msg
                )

            except Exception:

                return None

        try:

            raw_msg = decompressed.decode(
                "utf-8"
            )

        except Exception:

            return None

    try:

        data = json.loads(
            raw_msg
        )

    except Exception:

        return None

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

    # --------------------------------------------------------
    # 房间
    # --------------------------------------------------------

    room_id = ""

    if game_id.startswith("GD") and len(game_id) >= 4:

        room_id = "D" + game_id[2:4]

    room_id = room_id.upper()

    if room_id not in BACCARAT_ROOMS:

        return None

    # --------------------------------------------------------
    # 局号
    # --------------------------------------------------------

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

    # --------------------------------------------------------
    # 结果
    # --------------------------------------------------------

    winner_raw = str(
        data.get(
            "winner",
            data.get(
                "result",
                ""
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

    elif "tie" in winner_raw:

        winner = "和"

    else:

        return None

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
            game_id,

        "timestamp":
            int(time.time())
    }


# ============================================================
# Baccarat Message
# ============================================================

def on_baccarat_message(
    ws,
    message
):

    parsed = parse_choice_baccarat_packet(
        message
    )

    if not parsed:

        return

    room = parsed["room"]

    with data_lock:

        bacc = global_data[
            "baccarat"
        ]

        history = bacc[
            "rooms"
        ][room]

        # ----------------------------------------------------
        # 如果是新局
        # ----------------------------------------------------

        already_exists = any(
            item.get("game_id")
            ==
            parsed["game_id"]
            for item in history
        )

        if already_exists:

            return

        # ----------------------------------------------------
        # 在加入新结果之前：
        # 先保存上一局对下一局的预测
        # ----------------------------------------------------

        prediction_before = predict_baccarat_next(
            history
        )

        prediction = prediction_before.get(
            "prediction",
            "-"
        )

        if prediction in ("庄", "闲"):

            parsed["prediction"] = prediction

            if parsed["result"] == "和":

                parsed["prediction_result"] = "TIE"

            elif parsed["result"] == prediction:

                parsed["prediction_result"] = "WIN"

            else:

                parsed["prediction_result"] = "LOSS"

        else:

            parsed["prediction"] = "-"

            parsed["prediction_result"] = "WAIT"

        # ----------------------------------------------------
        # 加入历史
        # ----------------------------------------------------

        history.insert(
            0,
            parsed
        )

        bacc[
            "rooms"
        ][room] = history[:200]

        # ----------------------------------------------------
        # 重新分析
        # ----------------------------------------------------

        update_baccarat_analysis(
            room
        )

        # ----------------------------------------------------
        # D51 同步主状态
        # ----------------------------------------------------

        if room == "D51":

            bacc[
                "current_room"
            ] = "D51"

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

            # ----------------------------------------------
            # 统计预测
            # ----------------------------------------------

            prediction_count = 0
            win_count = 0
            loss_count = 0

            for item in history:

                result_status = item.get(
                    "prediction_result"
                )

                if result_status == "WIN":

                    prediction_count += 1
                    win_count += 1

                elif result_status == "LOSS":

                    prediction_count += 1
                    loss_count += 1

            if prediction_count > 0:

                win_rate = round(
                    win_count /
                    prediction_count *
                    100,
                    2
                )

            else:

                win_rate = 0

            results = [
                item.get("result")
                for item in history
            ]

            counts = Counter(
                results
            )

            bacc[
                "stats"
            ] = {

                "banker_cnt":
                    counts.get(
                        "庄",
                        0
                    ),

                "player_cnt":
                    counts.get(
                        "闲",
                        0
                    ),

                "tie_cnt":
                    counts.get(
                        "和",
                        0
                    ),

                "prediction_count":
                    prediction_count,

                "win_count":
                    win_count,

                "loss_count":
                    loss_count,

                "win_rate":
                    win_rate
            }

    save_data_json()

    print(
        f"🃏 [Baccarat {room}] "
        f"靴:{parsed['shoe']} "
        f"局:{parsed['game']} "
        f"| 结果:{parsed['result']} "
        f"| 当局预测:{parsed.get('prediction', '-')}"
        f" "
        f"| {parsed.get('prediction_result', 'WAIT')}"
    )


# ============================================================
# WebSocket
# ============================================================

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
        "🔌 [Choice Baccarat WS 断开]"
    )

    print(
        "5 秒后重新连接..."
    )

    time.sleep(5)

    try:

        start_baccarat_ws()

    except Exception as e:

        print(
            f"⚠️ 重连失败: {e}"
        )


def start_baccarat_ws():

    headers = {
        "User-Agent":
            "Mozilla/5.0 "
            "(Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 "
            "(KHTML, like Gecko) "
            "Chrome/153.0.0.0 Safari/537.36",

        "Origin":
            "https://gc.ckrkg.com"
    }

    print(
        f"🔌 正在连接 Baccarat WS:"
        f"\n{BACCARAT_WS_URL}"
    )

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

    ws.run_forever(
        ping_interval=20,
        ping_timeout=10
    )


# ============================================================
# Main
# ============================================================

def main():

    print("=" * 70)

    print(
        "🚀 WinGo + Baccarat 双模块数据采集器"
    )

    print(
        "📁 数据文件:",
        DATA_FILE
    )

    print(
        "🏠 Baccarat 房间:",
        ", ".join(BACCARAT_ROOMS)
    )

    print("=" * 70)

    # --------------------------------------------------------
    # 先保存一次统一结构
    # --------------------------------------------------------

    save_data_json()

    # --------------------------------------------------------
    # WinGo
    # --------------------------------------------------------

    wingo_thread = threading.Thread(
        target=wingo_loop,
        daemon=True
    )

    wingo_thread.start()

    # --------------------------------------------------------
    # Baccarat
    # --------------------------------------------------------

    baccarat_thread = threading.Thread(
        target=start_baccarat_ws,
        daemon=True
    )

    baccarat_thread.start()

    # --------------------------------------------------------
    # Keep Alive
    # --------------------------------------------------------

    try:

        while True:

            time.sleep(1)

    except KeyboardInterrupt:

        print(
            "\n👋 程序已停止"
        )


if __name__ == "__main__":

    main()
