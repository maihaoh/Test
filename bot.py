import os
import time
import requests
import hashlib
import json
import random
import threading
import websocket
from collections import Counter


# ============================================================
# 基本路径
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DATA_FILE = os.path.join(
    BASE_DIR,
    "data.json"
)

TEMP_DATA_FILE = os.path.join(
    BASE_DIR,
    "data.json.tmp"
)


# ============================================================
# WinGo 配置
# ============================================================

WINGO_API_URL = (
    "https://mzplayapi.com/api/webapi/"
    "GetNoaverageEmerdList"
)

WINGO_ORIGIN = "https://mzplay0.com"

WINGO_REFERER = "https://mzplay0.com/"

TYPE_ID = 30
LANGUAGE = 0

POLL_INTERVAL = 10
INIT_SCAN_PAGES = 10
MAX_WINGO_HISTORY = 300


# ============================================================
# Baccarat WebSocket
# ============================================================

BACCARAT_WS_URL = "wss://ng211.mdvuz.com:5000"

BACCARAT_ORIGIN = "https://gci.arvideo.video"

BACCARAT_ROOMS = (
    "D51",
    "D52",
    "D53",
    "D54",
    "D55",
    "D56",
    "D57",
    "D58",
)

MAX_BACCARAT_HISTORY = 200


# ============================================================
# 默认数据
# ============================================================

def create_default_data():
    return {
        "update_time": "2026-09-27 10:30:00",

        "price_history": [
            {
                "time": "10:00",
                "price": 64200
            },
            {
                "time": "10:05",
                "price": 64350
            }
        ],

        "ai_learning": {
            "weights": {
                "ma_factor": 0.35,
                "rsi_factor": 0.25,
                "trend_factor": 0.40
            }
        },

        "market_analysis": {
            "big10": "60%",
            "small10": "40%",
            "big50": "55%",
            "small50": "45%"
        },

        "updated_at": int(time.time()),

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
                "streak": 0,
                "special": False
            },

            "draws": []
        },

        "baccarat": {
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
    }


# ============================================================
# 全局变量
# ============================================================

global_data = create_default_data()

data_lock = threading.Lock()

session = requests.Session()

session.headers.update({
    "User-Agent": (
        "Mozilla/5.0 "
        "(Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 "
        "(KHTML, like Gecko) "
        "Chrome/153.0.0.0 "
        "Safari/537.36"
    ),

    "Content-Type": "application/json;charset=UTF-8",

    "Origin": WINGO_ORIGIN,

    "Referer": WINGO_REFERER
})


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

    if 0 <= number <= 4:
        return "小"

    return "大"


# ============================================================
# WinGo 颜色
# ============================================================

def normalize_wingo_colour(number, api_colour=""):
    try:
        number = int(number)
    except Exception:
        return str(api_colour or "")

    if api_colour:
        return str(api_colour)

    if number == 0:
        return "red,violet"

    if number == 5:
        return "green,violet"

    if number % 2 == 0:
        return "red"

    return "green"


# ============================================================
# WinGo 预测
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

    for item in draws:
        try:
            nums.append(
                int(item["number"])
            )

            sizes.append(
                str(item["size"])
            )

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
    # 当前
    # --------------------------------------------------------

    last_num = nums[0]
    last_size = sizes[0]

    # --------------------------------------------------------
    # 当前长龙
    # --------------------------------------------------------

    streak_cnt = 0

    for size in sizes:
        if size == last_size:
            streak_cnt += 1
        else:
            break

    # --------------------------------------------------------
    # 数字转换关系
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
    # 最近 10 局
    # --------------------------------------------------------

    recent10 = nums[:10]

    big_count = sum(
        1
        for number in recent10
        if number >= 5
    )

    if big_count >= 7:
        mean_size = "小"

    elif big_count <= 3:
        mean_size = "大"

    else:
        mean_size = "平"

    # --------------------------------------------------------
    # 特殊数字
    # --------------------------------------------------------

    special = (
        last_num == 0
        or last_num == 5
    )

    # --------------------------------------------------------
    # Score
    # --------------------------------------------------------

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

    # --------------------------------------------------------
    # 最终 Size
    # --------------------------------------------------------

    if big_score >= small_score:
        final_size = "大"
    else:
        final_size = "小"

    # --------------------------------------------------------
    # Signal
    # --------------------------------------------------------

    signal = "观望"
    confidence = "普通"

    if difference < 0.8:
        signal = "观望"
        confidence = "避险观望"

    elif special:
        signal = "观望"
        confidence = "避险观望"

    elif big_score > small_score:
        signal = "BUY"

        if big_score >= 2.5:
            confidence = "高确信"
        else:
            confidence = "普通"

    else:
        signal = "SELL"

        if small_score >= 2.5:
            confidence = "高确信"
        else:
            confidence = "普通"

    # --------------------------------------------------------
    # 目标数字
    # --------------------------------------------------------

    if final_size == "大":
        start_num = 5
        end_num = 10
        target_num = 7
    else:
        start_num = 0
        end_num = 5
        target_num = 2

    max_num_score = -1

    for number in range(start_num, end_num):
        if (
            transition_counts[number]
            > max_num_score
        ):
            max_num_score = (
                transition_counts[number]
            )

            target_num = number

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
        "special": special
    }


# ============================================================
# 读取旧 data.json
# ============================================================

def load_existing_data():
    global global_data

    if not os.path.exists(DATA_FILE):
        print(
            "ℹ️ data.json 不存在，"
            "使用默认数据"
        )
        return

    try:
        with open(
            DATA_FILE,
            "r",
            encoding="utf-8"
        ) as file:
            loaded = json.load(file)

        if not isinstance(loaded, dict):
            print(
                "⚠️ data.json 不是 JSON object，"
                "使用默认数据"
            )
            return

        default = create_default_data()

        # ----------------------------------------------------
        # 保留旧 Dashboard
        # ----------------------------------------------------

        for key in (
            "update_time",
            "price_history",
            "ai_learning",
            "market_analysis"
        ):
            if key in loaded:
                default[key] = loaded[key]

        # ----------------------------------------------------
        # 更新时间
        # ----------------------------------------------------

        if isinstance(
            loaded.get("updated_at"),
            int
        ):
            default["updated_at"] = (
                loaded["updated_at"]
            )

        # ----------------------------------------------------
        # WinGo
        # ----------------------------------------------------

        old_wingo = loaded.get("wingo")

        if isinstance(old_wingo, dict):
            old_draws = old_wingo.get(
                "draws",
                []
            )

            if isinstance(old_draws, list):
                clean_draws = []

                for item in old_draws:
                    normalized = (
                        normalize_wingo_item(item)
                    )

                    if normalized:
                        clean_draws.append(
                            normalized
                        )

                default["wingo"]["draws"] = (
                    clean_draws[
                        :MAX_WINGO_HISTORY
                    ]
                )

        # ----------------------------------------------------
        # Baccarat
        # ----------------------------------------------------

        old_baccarat = loaded.get(
            "baccarat"
        )

        if isinstance(old_baccarat, dict):

            for key in (
                "current_room",
                "shoe_no",
                "game_no",
                "latest_result",
                "predicted_result"
            ):
                if key in old_baccarat:
                    default["baccarat"][key] = (
                        old_baccarat[key]
                    )

            old_rooms = old_baccarat.get(
                "rooms",
                {}
            )

            if isinstance(old_rooms, dict):

                for room in BACCARAT_ROOMS:

                    history = old_rooms.get(
                        room,
                        []
                    )

                    if not isinstance(
                        history,
                        list
                    ):
                        continue

                    default["baccarat"]["rooms"][room] = (
                        history[
                            :MAX_BACCARAT_HISTORY
                        ]
                    )

        global_data = default

        print(
            "✅ 已读取现有 data.json"
        )

        print(
            f"📊 WinGo 历史: "
            f"{len(global_data['wingo']['draws'])}"
        )

        total_baccarat = sum(
            len(
                global_data[
                    "baccarat"
                ][
                    "rooms"
                ][room]
            )
            for room in BACCARAT_ROOMS
        )

        print(
            f"🃏 Baccarat 历史: "
            f"{total_baccarat}"
        )

    except json.JSONDecodeError as e:

        print(
            "⚠️ data.json JSON 格式错误"
        )

        print(
            f"   {e}"
        )

        print(
            "⚠️ 将使用默认结构，"
            "不会把错误 JSON 继续写回"
        )

        global_data = create_default_data()

    except Exception as e:

        print(
            f"⚠️ 读取 data.json 失败: {e}"
        )

        global_data = create_default_data()


# ============================================================
# WinGo 数据标准化
# ============================================================

def normalize_wingo_item(item):

    if not isinstance(item, dict):
        return None

    try:
        issue = str(
            item.get(
                "issueNumber",
                item.get(
                    "issue",
                    ""
                )
            )
        )

        number = int(
            item.get("number")
        )

    except Exception:
        return None

    if not issue:
        return None

    if not (0 <= number <= 9):
        return None

    colour = normalize_wingo_colour(
        number,
        item.get(
            "colour",
            ""
        )
    )

    return {
        "issueNumber": issue,
        "number": number,
        "colour": colour,
        "size": get_wingo_size(number)
    }


# ============================================================
# 安全保存 data.json
# ============================================================

save_lock = threading.Lock()


def save_data_json():
    with save_lock:
        _save_data_json_locked()


def _save_data_json_locked():

    with data_lock:

        snapshot = json.loads(
            json.dumps(
                global_data,
                ensure_ascii=False
            )
        )

        snapshot["updated_at"] = int(
            time.time()
        )

        global_data["updated_at"] = (
            snapshot["updated_at"]
        )

    try:

        with open(
            TEMP_DATA_FILE,
            "w",
            encoding="utf-8"
        ) as file:

            json.dump(
                snapshot,
                file,
                ensure_ascii=False,
                indent=2
            )

            file.flush()

            os.fsync(
                file.fileno()
            )

        os.replace(
            TEMP_DATA_FILE,
            DATA_FILE
        )

    except Exception as e:

        print(
            f"❌ 保存 data.json 失败: {e}"
        )

        try:

            if os.path.exists(
                TEMP_DATA_FILE
            ):
                os.remove(
                    TEMP_DATA_FILE
                )

        except Exception:
            pass


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

        response.raise_for_status()

        data = response.json()

        if data.get("code") != 0:

            print(
                f"⚠️ [WinGo] "
                f"API code={data.get('code')} "
                f"msg={data.get('msg')}"
            )

            return []

        result = []

        api_data = data.get(
            "data",
            {}
        )

        if not isinstance(
            api_data,
            dict
        ):
            return []

        items = api_data.get(
            "list",
            []
        )

        if not isinstance(
            items,
            list
        ):
            return []

        for item in items:

            normalized = (
                normalize_wingo_item(item)
            )

            if normalized:
                result.append(
                    normalized
                )

        return result

    except Exception as e:

        print(
            f"⚠️ [WinGo API] "
            f"请求错误: {e}"
        )

        return []


# ============================================================
# 更新 WinGo
# ============================================================

def update_wingo_data(draws):

    if not draws:
        return

    draws = sorted(
        draws,
        key=lambda x: int(
            x["issueNumber"]
        ),
        reverse=True
    )

    draws = draws[:MAX_WINGO_HISTORY]

    streak_val = draws[0]["size"]

    streak_cnt = 0

    for item in draws:

        if item["size"] == streak_val:
            streak_cnt += 1
        else:
            break

    size_counts = Counter(
        item["size"]
        for item in draws
    )

    prediction = predict_wingo_next(
        draws
    )

    with data_lock:

        global_data["wingo"] = {
            "stats": {
                "streak_val": streak_val,
                "streak_cnt": streak_cnt,
                "big_cnt": size_counts.get(
                    "大",
                    0
                ),
                "small_cnt": size_counts.get(
                    "小",
                    0
                )
            },

            "prediction": prediction,

            "draws": draws
        }

    save_data_json()

    print(
        f"✅ [WinGo] "
        f"{len(draws)}期 | "
        f"最新:{draws[0]['number']} | "
        f"长龙:{streak_val}x{streak_cnt} | "
        f"预测:{prediction['size']} "
        f"{prediction['num']} | "
        f"{prediction['confidence']}"
    )


# ============================================================
# WinGo 启动历史扫描
# ============================================================

def load_wingo_history():

    existing = []

    with data_lock:

        existing = list(
            global_data[
                "wingo"
            ].get(
                "draws",
                []
            )
        )

    issue_map = {}

    for item in existing:

        normalized = (
            normalize_wingo_item(item)
        )

        if normalized:

            issue_map[
                normalized["issueNumber"]
            ] = normalized

    print(
        f"🔍 [WinGo] "
        f"扫描最近 {INIT_SCAN_PAGES} 页..."
    )

    for page in range(
        1,
        INIT_SCAN_PAGES + 1
    ):

        page_data = (
            fetch_wingo_draw_page(
                page_no=page,
                page_size=10
            )
        )

        if not page_data:

            print(
                f"⚠️ [WinGo] "
                f"第 {page} 页没有数据"
            )

        for item in page_data:

            issue_map[
                item["issueNumber"]
            ] = item

        time.sleep(0.3)

    draws = sorted(
        issue_map.values(),
        key=lambda x: int(
            x["issueNumber"]
        ),
        reverse=True
    )

    return draws[
        :MAX_WINGO_HISTORY
    ]


# ============================================================
# WinGo 实时循环
# ============================================================

def wingo_loop():

    memory_draws = (
        load_wingo_history()
    )

    update_wingo_data(
        memory_draws
    )

    seen_issues = {
        item["issueNumber"]
        for item in memory_draws
    }

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

        if not latest_page:
            continue

        changed = False

        for item in latest_page:

            issue = item[
                "issueNumber"
            ]

            if issue not in seen_issues:

                seen_issues.add(
                    issue
                )

                memory_draws.insert(
                    0,
                    item
                )

                changed = True

        if changed:

            memory_draws = sorted(
                memory_draws,
                key=lambda x: int(
                    x["issueNumber"]
                ),
                reverse=True
            )

            memory_draws = (
                memory_draws[
                    :MAX_WINGO_HISTORY
                ]
            )

            seen_issues = {
                item["issueNumber"]
                for item in memory_draws
            }

            update_wingo_data(
                memory_draws
            )


# ============================================================
# Baccarat Prediction
# ============================================================

def predict_baccarat_next(history):

    if not history:
        return "庄"

    recent = history[:10]

    banker_cnt = sum(
        1
        for item in recent
        if item.get("result") == "庄"
    )

    player_cnt = sum(
        1
        for item in recent
        if item.get("result") == "闲"
    )

    if banker_cnt >= 6:
        return "闲"

    if player_cnt >= 6:
        return "庄"

    if banker_cnt > player_cnt:
        return "闲"

    if player_cnt > banker_cnt:
        return "庄"

    return "庄"


# ============================================================
# Baccarat Prediction Win Rate
# ============================================================

def calculate_baccarat_win_rate(history):

    checked = 0
    wins = 0

    for item in history:

        result = item.get(
            "result"
        )

        predicted = item.get(
            "predict"
        )

        if result not in (
            "庄",
            "闲"
        ):
            continue

        if predicted not in (
            "庄",
            "闲"
        ):
            continue

        checked += 1

        if result == predicted:
            wins += 1

    if checked <= 0:
        return 0

    return round(
        wins / checked * 100,
        1
    )


# ============================================================
# Baccarat Binary Utils
# ============================================================

def bytes_to_hex(data):

    if not isinstance(
        data,
        (bytes, bytearray)
    ):
        return ""

    return bytes(data).hex().upper()


def safe_ascii(data):

    try:
        return data.decode(
            "utf-8",
            errors="ignore"
        )

    except Exception:
        return ""


def room_to_choice_code(room):

    mapping = {
        "D51": b"D051",
        "D52": b"D052",
        "D53": b"D053",
        "D54": b"D054",
        "D55": b"D055",
        "D56": b"D056",
        "D57": b"D057",
        "D58": b"D058"
    }

    return mapping.get(
        room,
        b"D051"
    )


# ============================================================
# Baccarat Subscribe Packet
# ============================================================

def build_baccarat_room_packet(room):

    room_code = (
        room_to_choice_code(room)
    )

    packet = bytearray(
        bytes.fromhex(
            "000610030000001900000000"
        )
    )

    packet.extend(
        room_code
    )

    packet.extend(
        bytes.fromhex(
            "000000000000000100"
        )
    )

    return bytes(packet)


def subscribe_baccarat_rooms(ws):

    print(
        "📡 [百家乐] "
        "开始订阅 D51-D58..."
    )

    for room in BACCARAT_ROOMS:

        try:

            packet = (
                build_baccarat_room_packet(
                    room
                )
            )

            ws.send(
                packet,
                opcode=(
                    websocket
                    .ABNF
                    .OPCODE_BINARY
                )
            )

            print(
                f"📤 [百家乐] "
                f"{room} -> "
                f"{bytes_to_hex(packet)}"
            )

            time.sleep(0.15)

        except Exception as e:

            print(
                f"⚠️ [百家乐] "
                f"{room} 订阅失败: {e}"
            )


# ============================================================
# Baccarat Binary Parser
# ============================================================

# ============================================================
# Baccarat Binary Debug Parser
# ============================================================

DEBUG_BACCARAT_RAW = True
MAX_RAW_PREVIEW = 512


def bytes_to_hex(data):
    if not isinstance(data, (bytes, bytearray)):
        return ""

    return bytes(data).hex().upper()


def safe_ascii(data):
    try:
        return data.decode(
            "utf-8",
            errors="ignore"
        )
    except Exception:
        return ""


def debug_baccarat_packet(raw):
    """
    只负责观察 Choice WebSocket 原始数据。
    暂时不猜测 packet 的真实结构。
    """

    if not isinstance(raw, (bytes, bytearray)):
        return

    data = bytes(raw)

    print()
    print("=" * 80)
    print("📥 [Choice百家乐] RAW WebSocket Packet")
    print("=" * 80)

    print(
        f"长度: {len(data)} bytes"
    )

    print(
        f"HEX: {bytes_to_hex(data[:MAX_RAW_PREVIEW])}"
    )

    ascii_data = safe_ascii(
        data[:MAX_RAW_PREVIEW]
    )

    if ascii_data:
        print(
            f"ASCII: {repr(ascii_data)}"
        )

    print(
        f"D51: {data.find(b'D051')}"
    )

    print(
        f"D52: {data.find(b'D052')}"
    )

    print(
        f"D53: {data.find(b'D053')}"
    )

    print(
        f"D54: {data.find(b'D054')}"
    )

    print(
        f"D55: {data.find(b'D055')}"
    )

    print(
        f"D56: {data.find(b'D056')}"
    )

    print(
        f"D57: {data.find(b'D057')}"
    )

    print(
        f"D58: {data.find(b'D058')}"
    )

    print("=" * 80)


def parse_bac_result_candidates(raw):
    """
    第一阶段：

    不再强行把 packet 当成固定 13 bytes。

    先扫描 D051-D058 附近的数据，
    同时保留旧 parser 作为候选解析器。
    """

    if not isinstance(
        raw,
        (bytes, bytearray)
    ):
        return []

    data = bytes(raw)

    candidates = []

    for room in BACCARAT_ROOMS:

        room_code = room_to_choice_code(
            room
        )

        start = 0

        while True:

            pos = data.find(
                room_code,
                start
            )

            if pos < 0:
                break

            # ------------------------------------------------
            # 保留旧的 13-byte candidate
            # ------------------------------------------------

            if (
                pos + 13
                <= len(data)
            ):

                chunk = data[
                    pos:pos + 13
                ]

                res = chunk[4]

                code_raw = chunk[5:9]

                bval = chunk[9]

                pval = chunk[10]

                num = chunk[11]

                pair = chunk[12]

                valid_points = (
                    0 <= bval <= 9
                    and
                    0 <= pval <= 9
                )

                valid_num = (
                    0 <= num <= 20
                )

                if (
                    valid_points
                    and valid_num
                ):

                    if bval > pval:

                        result = "庄"

                    elif pval > bval:

                        result = "闲"

                    else:

                        result = "和"

                    code = (
                        safe_ascii(
                            code_raw
                        )
                        .strip(
                            "\x00 "
                        )
                    )

                    candidates.append({

                        "room": room,

                        "result": result,

                        "bval": bval,

                        "pval": pval,

                        "num": num,

                        "pair": pair,

                        "res": res,

                        "code": code,

                        "offset": pos,

                        "raw": bytes(chunk)

                    })

            start = pos + 1

    return candidates


def parse_choice_baccarat_packet(raw_msg):

    if not isinstance(
        raw_msg,
        (bytes, bytearray)
    ):
        return None

    raw = bytes(raw_msg)

    # --------------------------------------------------------
    # 第一阶段：打印真实 packet
    # --------------------------------------------------------

    if DEBUG_BACCARAT_RAW:

        debug_baccarat_packet(
            raw
        )

    # --------------------------------------------------------
    # 暂时使用旧 candidate parser
    # --------------------------------------------------------

    candidates = (
        parse_bac_result_candidates(
            raw
        )
    )

    if not candidates:

        print(
            "⚠️ [Choice百家乐] "
            "暂时无法解析这个 packet"
        )

        return None

    # --------------------------------------------------------
    # 显示所有 candidate
    # --------------------------------------------------------

    print(
        f"🔎 [Choice百家乐] "
        f"找到 {len(candidates)} 个 candidate"
    )

    for index, item in enumerate(
        candidates
    ):

        print(
            f"   #{index + 1} "
            f"{item['room']} | "
            f"庄={item['bval']} | "
            f"闲={item['pval']} | "
            f"num={item['num']} | "
            f"pair={item['pair']} | "
            f"code={repr(item['code'])} | "
            f"offset={item['offset']}"
        )

    # --------------------------------------------------------
    # 暂时取最后一个 candidate
    # --------------------------------------------------------

    item = candidates[-1]

    room = item["room"]

    result = item["result"]

    game_no = item.get(
        "code",
        ""
    )

    if not game_no:

        game_no = str(
            item.get(
                "num",
                0
            )
        )

    # --------------------------------------------------------
    # 临时稳定 ID
    # --------------------------------------------------------

    game_id = (
        f"{room}-"
        f"{game_no}-"
        f"{item['bval']}-"
        f"{item['pval']}-"
        f"{item['num']}-"
        f"{item['pair']}"
    )

    return {

        "room": room,

        "shoe": "01",

        "game": game_no,

        "result": result,

        "game_id": game_id,

        "bval": item["bval"],

        "pval": item["pval"],

        "num": item["num"],

        "pair": item["pair"],

        "code": item["code"],

        "res": item["res"]

    }

    if not isinstance(
        raw_msg,
        (bytes, bytearray)
    ):
        return None

    candidates = (
        parse_bac_result_candidates(
            raw_msg
        )
    )

    if not candidates:
        return None

    item = candidates[-1]

    room = item["room"]

    result = item["result"]

    game_no = item.get(
        "code",
        ""
    )

    if not game_no:

        game_no = str(
            item.get(
                "num",
                0
            )
        )

    game_id = (
        f"{room}-"
        f"{game_no}-"
        f"{item['bval']}-"
        f"{item['pval']}-"
        f"{item['num']}-"
        f"{item['pair']}"
    )

    return {
        "room": room,

        "shoe": "01",

        "game": game_no,

        "result": result,

        "game_id": game_id,

        "bval": item["bval"],

        "pval": item["pval"],

        "num": item["num"],

        "pair": item["pair"],

        "code": item["code"],

        "res": item["res"]
    }


# ============================================================
# Baccarat Stats
# ============================================================

def rebuild_baccarat_stats(room):

    bacc = global_data["baccarat"]

    history = (
        bacc[
            "rooms"
        ][
            room
        ]
    )

    counts = Counter(
        item.get("result")
        for item in history
    )

    bacc["stats"]["banker_cnt"] = (
        counts.get("庄", 0)
    )

    bacc["stats"]["player_cnt"] = (
        counts.get("闲", 0)
    )

    bacc["stats"]["tie_cnt"] = (
        counts.get("和", 0)
    )

    bacc["stats"]["win_rate"] = (
        calculate_baccarat_win_rate(
            history
        )
    )


def rebuild_all_baccarat():

    with data_lock:

        for room in BACCARAT_ROOMS:

            history = (
                global_data[
                    "baccarat"
                ][
                    "rooms"
                ][
                    room
                ]
            )

            if not isinstance(
                history,
                list
            ):
                history = []

            global_data[
                "baccarat"
            ][
                "rooms"
            ][room] = (
                history[
                    :MAX_BACCARAT_HISTORY
                ]
            )

        current_room = (
            global_data[
                "baccarat"
            ].get(
                "current_room",
                "D51"
            )
        )

        if current_room not in BACCARAT_ROOMS:
            current_room = "D51"

        global_data[
            "baccarat"
        ][
            "current_room"
        ] = current_room

        current_history = (
            global_data[
                "baccarat"
            ][
                "rooms"
            ][
                current_room
            ]
        )

        if current_history:

            latest = (
                current_history[0]
            )

            global_data[
                "baccarat"
            ][
                "latest_result"
            ] = latest.get(
                "result",
                "--"
            )

            global_data[
                "baccarat"
            ][
                "predicted_result"
            ] = (
                predict_baccarat_next(
                    current_history
                )
            )

            global_data[
                "baccarat"
            ][
                "shoe_no"
            ] = str(
                latest.get(
                    "shoe",
                    "01"
                )
            )

            global_data[
                "baccarat"
            ][
                "game_no"
            ] = str(
                latest.get(
                    "game",
                    "01"
                )
            )

        else:

            global_data[
                "baccarat"
            ][
                "latest_result"
            ] = "--"

            global_data[
                "baccarat"
            ][
                "predicted_result"
            ] = "--"

        rebuild_baccarat_stats(
            current_room
        )


# ============================================================
# Baccarat WS Message
# ============================================================

def on_baccarat_message(
    ws,
    message
):

    # ========================================================
    # 只接受 Binary
    # ========================================================

    if not isinstance(
        message,
        (bytes, bytearray)
    ):

        print(
            "📨 [Choice百家乐] "
            f"收到非 Binary 数据: "
            f"{type(message).__name__}"
        )

        return

    raw = bytes(message)

    # ========================================================
    # 解析
    # ========================================================

    parsed = (
        parse_choice_baccarat_packet(
            raw
        )
    )

    if not parsed:

        return

    room = parsed.get(
        "room"
    )

    if room not in BACCARAT_ROOMS:

        print(
            f"⚠️ [Choice百家乐] "
            f"未知房间: {room}"
        )

        return

    # ========================================================
    # 写入 data.json
    # ========================================================

    with data_lock:

        bacc = global_data[
            "baccarat"
        ]

        room_history = (
            bacc[
                "rooms"
            ][
                room
            ]
        )

        # ----------------------------------------------------
        # 防重复
        # ----------------------------------------------------

        game_id = parsed[
            "game_id"
        ]

        exists = any(

            item.get(
                "game_id"
            ) == game_id

            for item in room_history

        )

        if exists:

            print(
                f"⏭️ [百家乐 {room}] "
                f"重复局，跳过: "
                f"{game_id}"
            )

            return

        # ----------------------------------------------------
        # 预测
        # ----------------------------------------------------

        parsed["predict"] = (
            predict_baccarat_next(
                room_history
            )
        )

        # ----------------------------------------------------
        # 最新放最前
        # ----------------------------------------------------

        room_history.insert(
            0,
            parsed
        )

        room_history = (
            room_history[
                :MAX_BACCARAT_HISTORY
            ]
        )

        bacc[
            "rooms"
        ][
            room
        ] = room_history

        # ----------------------------------------------------
        # 当前房间
        # ----------------------------------------------------

        bacc[
            "current_room"
        ] = room

        bacc[
            "shoe_no"
        ] = parsed.get(
            "shoe",
            "01"
        )

        bacc[
            "game_no"
        ] = parsed.get(
            "game",
            "01"
        )

        bacc[
            "latest_result"
        ] = parsed.get(
            "result",
            "--"
        )

        # ----------------------------------------------------
        # 下一局预测
        # ----------------------------------------------------

        bacc[
            "predicted_result"
        ] = predict_baccarat_next(
            room_history
        )

        # ----------------------------------------------------
        # 统计
        # ----------------------------------------------------

        rebuild_baccarat_stats(
            room
        )

    # ========================================================
    # 保存
    # ========================================================

    save_data_json()

    # ========================================================
    # Console
    # ========================================================

    print()
    print(
        "🃏 ========================================"
    )

    print(
        f"🃏 [百家乐 {room}] "
        f"成功写入"
    )

    print(
        f"   结果: {parsed['result']}"
    )

    print(
        f"   庄点: {parsed['bval']}"
    )

    print(
        f"   闲点: {parsed['pval']}"
    )

    print(
        f"   局号: {parsed['game']}"
    )

    print(
        f"   Pair: {parsed['pair']}"
    )

    print(
        f"   Game ID: {parsed['game_id']}"
    )

    print(
        "🃏 ========================================"
    )



# ============================================================
# Baccarat WS Error
# ============================================================

def on_baccarat_error(
    ws,
    error
):

    print(
        f"⚠️ [百家乐 WS] "
        f"{error}"
    )


# ============================================================
# Baccarat WS Close
# ============================================================

def on_baccarat_close(
    ws,
    close_status_code,
    close_msg
):

    print(
        "🔌 [Choice百家乐] "
        "WS 断开"
    )

    print(
        f"状态: {close_status_code}"
    )

    print(
        f"原因: {close_msg}"
    )


# ============================================================
# Baccarat WS Open
# ============================================================

def on_baccarat_open(ws):

    print(
        "🟢 [Choice百家乐] "
        "连接成功"
    )

    print(
        BACCARAT_WS_URL
    )

    try:

        subscribe_baccarat_rooms(
            ws
        )

        print(
            "✅ D51-D58 "
            "订阅请求已发送"
        )

    except Exception as e:

        print(
            f"❌ [百家乐] "
            f"初始化失败: {e}"
        )


# ============================================================
# Baccarat WebSocket
# ============================================================

def start_baccarat_ws():

    headers = [
        (
            "User-Agent: "
            "Mozilla/5.0 "
            "(Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 "
            "(KHTML, like Gecko) "
            "Chrome/153.0.0.0 "
            "Safari/537.36"
        ),

        (
            "Origin: "
            "https://gci.arvideo.video"
        )
    ]

    while True:

        ws = None

        try:

            print(
                "🔌 [Choice百家乐] "
                "正在连接..."
            )

            ws = websocket.WebSocketApp(
                BACCARAT_WS_URL,
                header=headers,
                on_open=on_baccarat_open,
                on_message=on_baccarat_message,
                on_error=on_baccarat_error,
                on_close=on_baccarat_close
            )

            ws.run_forever(
                ping_interval=20,
                ping_timeout=10
            )

        except Exception as e:

            print(
                f"❌ [百家乐 WS] "
                f"{e}"
            )

        finally:

            try:

                if ws is not None:
                    ws.close()

            except Exception:
                pass

        print(
            "⏳ 5 秒后重新连接 Baccarat..."
        )

        time.sleep(5)


# ============================================================
# 启动时重新计算
# ============================================================

def initialize_data():

    load_existing_data()

    with data_lock:

        existing_draws = (
            global_data[
                "wingo"
            ].get(
                "draws",
                []
            )
        )

    if existing_draws:

        update_wingo_data(
            existing_draws
        )

    rebuild_all_baccarat()

    save_data_json()


# ============================================================
# MAIN
# ============================================================

def main():

    print("=" * 70)

    print(
        "🚀 WinGo + Choice Baccarat"
    )

    print(
        "📡 实时数据采集系统"
    )

    print("=" * 70)

    print(
        f"📁 data.json: "
        f"{DATA_FILE}"
    )

    print(
        f"🎯 WinGo Type ID: "
        f"{TYPE_ID}"
    )

    print(
        "🃏 Baccarat: D51-D58"
    )

    print("=" * 70)

    # --------------------------------------------------------
    # 读取旧数据
    # --------------------------------------------------------

    initialize_data()

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
    # 主线程
    # --------------------------------------------------------

    try:

        while True:

            time.sleep(1)

    except KeyboardInterrupt:

        print(
            "\n👋 程序已安全退出"
        )


# ============================================================
# 程序入口
# ============================================================

if __name__ == "__main__":
    main()
