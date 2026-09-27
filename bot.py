import time
import requests
import hashlib
import json
import random
import threading
import os
import tempfile
from collections import Counter
import websocket


# ============================================================
# WinGo 配置
# ============================================================

WINGO_API_URL = (
    "https://mzplayapi.com/api/webapi/GetNoaverageEmerdList"
)

WINGO_ORIGIN = "https://mzplay0.com"
WINGO_REFERER = "https://mzplay0.com/"

TYPE_ID = 30
LANGUAGE = 0

# 正常实时检查间隔
POLL_INTERVAL = 10

# 启动时扫描页数
INIT_SCAN_PAGES = 10

# 每页数量
WINGO_PAGE_SIZE = 10

# 最大保存期数
WINGO_MAX_HISTORY = 300

# API 请求重试次数
WINGO_RETRIES = 3


# ============================================================
# Choice Baccarat WebSocket
# ============================================================

BACCARAT_WS_URL = "wss://ng211.mdvuz.com:5000"

BACCARAT_ORIGIN = "https://gci.arvideo.video"

BACCARAT_ROOMS = {
    "D51",
    "D52",
    "D53",
    "D54",
    "D55",
    "D56",
    "D57",
    "D58"
}

# Baccarat 每个房间最大保存局数
BACCARAT_MAX_HISTORY = 200

# WS 断线重连时间
BACCARAT_RECONNECT_DELAY = 5


# ============================================================
# 文件配置
# ============================================================

BASE_DIR = os.path.dirname(
    os.path.abspath(__file__)
)

DATA_FILE = os.path.join(
    BASE_DIR,
    "data.json"
)


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
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/153.0.0.0 Safari/537.36",

    "Content-Type":
        "application/json;charset=UTF-8",

    "Origin":
        WINGO_ORIGIN,

    "Referer":
        WINGO_REFERER,

    "Accept":
        "application/json, text/plain, */*"
})


# ============================================================
# 基础工具
# ============================================================

def generate_random(length=32):
    return "".join(
        random.choices(
            "0123456789abcdef",
            k=length
        )
    )


def generate_signature(data):
    """
    保留目前已经验证过的 WinGo Signature 逻辑。

    不加入：
    signature
    timestamp
    track
    xosoBettingData
    """

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
    try:
        number = int(number)
    except Exception:
        return "小"

    return (
        "小"
        if 0 <= number <= 4
        else "大"
    )


def safe_int(value, default=0):
    try:
        return int(value)
    except Exception:
        return default


def issue_sort_key(item):
    try:
        return int(
            str(
                item.get(
                    "issueNumber",
                    "0"
                )
            )
        )
    except Exception:
        return 0


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
            number = int(
                d["number"]
            )

            size = d.get(
                "size",
                get_wingo_size(number)
            )

            nums.append(number)
            sizes.append(size)

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
    # Markov-like transition
    # --------------------------------------------------------

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

    # --------------------------------------------------------
    # 最近 10 期
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
    # 特殊数字
    # --------------------------------------------------------

    is_special_num = (
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

        if big_score >= 2.5:
            confidence = "🔥高确信"

        else:
            confidence = "普通"

    else:

        final_size = "小"
        signal = "SELL"

        if small_score >= 2.5:
            confidence = "🔥高确信"

        else:
            confidence = "普通"

    # --------------------------------------------------------
    # 目标数字
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
        "num": target_num,
        "size": final_size,
        "signal": signal,
        "confidence": confidence,

        "big_score": round(
            big_score,
            2
        ),

        "small_score": round(
            small_score,
            2
        ),

        "difference": round(
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
# 加载已有 data.json
# ============================================================

def load_existing_data():

    global global_data

    if not os.path.exists(
        DATA_FILE
    ):
        print(
            "ℹ️ [DATA] "
            "没有旧 data.json，开始建立新数据。"
        )
        return

    try:

        with open(
            DATA_FILE,
            "r",
            encoding="utf-8"
        ) as f:

            old_data = json.load(f)

        if not isinstance(
            old_data,
            dict
        ):
            return

        with data_lock:

            # ------------------------------------------------
            # WinGo
            # ------------------------------------------------

            old_wingo = old_data.get(
                "wingo"
            )

            if isinstance(
                old_wingo,
                dict
            ):

                old_draws = old_wingo.get(
                    "draws",
                    []
                )

                if isinstance(
                    old_draws,
                    list
                ):

                    clean_draws = []

                    for item in old_draws:

                        if not isinstance(
                            item,
                            dict
                        ):
                            continue

                        issue = str(
                            item.get(
                                "issueNumber",
                                ""
                            )
                        ).strip()

                        if not issue:
                            continue

                        number = safe_int(
                            item.get(
                                "number"
                            ),
                            -1
                        )

                        if not 0 <= number <= 9:
                            continue

                        clean_draws.append({
                            "issueNumber":
                                issue,

                            "number":
                                number,

                            "colour":
                                str(
                                    item.get(
                                        "colour",
                                        ""
                                    )
                                ),

                            "size":
                                get_wingo_size(
                                    number
                                )
                        })

                    clean_draws = dedupe_wingo_draws(
                        clean_draws
                    )

                    clean_draws.sort(
                        key=issue_sort_key,
                        reverse=True
                    )

                    global_data[
                        "wingo"
                    ][
                        "draws"
                    ] = clean_draws[
                        :WINGO_MAX_HISTORY
                    ]

            # ------------------------------------------------
            # Baccarat
            # ------------------------------------------------

            old_baccarat = old_data.get(
                "baccarat"
            )

            if isinstance(
                old_baccarat,
                dict
            ):

                for room in BACCARAT_ROOMS:

                    old_rooms = (
                        old_baccarat
                        .get(
                            "rooms",
                            {}
                        )
                    )

                    history = (
                        old_rooms
                        .get(
                            room,
                            []
                        )
                        if isinstance(
                            old_rooms,
                            dict
                        )
                        else []
                    )

                    if not isinstance(
                        history,
                        list
                    ):
                        continue

                    clean_history = []

                    seen_ids = set()

                    for item in history:

                        if not isinstance(
                            item,
                            dict
                        ):
                            continue

                        game_id = str(
                            item.get(
                                "game_id",
                                ""
                            )
                        ).strip()

                        if not game_id:
                            continue

                        if game_id in seen_ids:
                            continue

                        seen_ids.add(
                            game_id
                        )

                        clean_history.append(
                            item
                        )

                    global_data[
                        "baccarat"
                    ][
                        "rooms"
                    ][
                        room
                    ] = clean_history[
                        :BACCARAT_MAX_HISTORY
                    ]

                # 当前房间
                current_room = normalize_room(
                    old_baccarat.get(
                        "current_room"
                    )
                )

                if current_room:
                    global_data[
                        "baccarat"
                    ][
                        "current_room"
                    ] = current_room

        print(
            f"💾 [DATA] "
            f"已读取旧数据 | "
            f"WinGo:{len(global_data['wingo']['draws'])}期"
        )

    except Exception as e:

        print(
            f"⚠️ [DATA] "
            f"读取旧 data.json 失败: {e}"
        )


# ============================================================
# WinGo 去重
# ============================================================

def dedupe_wingo_draws(draws):

    result = []
    seen = set()

    for item in draws:

        issue = str(
            item.get(
                "issueNumber",
                ""
            )
        ).strip()

        if not issue:
            continue

        if issue in seen:
            continue

        seen.add(issue)

        result.append(
            item
        )

    return result


# ============================================================
# 安全保存 data.json
# ============================================================

def save_data_json():

    try:

        with data_lock:

            global_data[
                "updated_at"
            ] = int(
                time.time()
            )

            # 深复制，避免写文件过程中其他线程修改
            snapshot = json.loads(
                json.dumps(
                    global_data,
                    ensure_ascii=False
                )
            )

        directory = os.path.dirname(
            DATA_FILE
        )

        os.makedirs(
            directory,
            exist_ok=True
        )

        fd, temp_path = (
            tempfile.mkstemp(
                prefix=".data_",
                suffix=".tmp",
                dir=directory
            )
        )

        try:

            with os.fdopen(
                fd,
                "w",
                encoding="utf-8"
            ) as f:

                json.dump(
                    snapshot,
                    f,
                    ensure_ascii=False,
                    indent=2
                )

                f.flush()
                os.fsync(
                    f.fileno()
                )

            os.replace(
                temp_path,
                DATA_FILE
            )

        finally:

            if os.path.exists(
                temp_path
            ):

                try:
                    os.remove(
                        temp_path
                    )
                except Exception:
                    pass

    except Exception as e:

        print(
            f"❌ [DATA] "
            f"保存 data.json 失败: {e}"
        )


# ============================================================
# WinGo API
# ============================================================

def fetch_wingo_draw_page(
    page_no=1,
    page_size=WINGO_PAGE_SIZE
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

    # --------------------------------------------------------
    # Signature 必须在 timestamp 加入前生成
    # 保持你目前已经验证成功的方式
    # --------------------------------------------------------

    payload[
        "signature"
    ] = generate_signature(
        payload
    )

    payload[
        "timestamp"
    ] = int(
        time.time()
    )

    for attempt in range(
        1,
        WINGO_RETRIES + 1
    ):

        try:

            response = session.post(
                WINGO_API_URL,
                json=payload,
                timeout=15
            )

            response.raise_for_status()

            data = response.json()

            if not isinstance(
                data,
                dict
            ):

                raise ValueError(
                    "API 返回不是 JSON Object"
                )

            code = data.get(
                "code"
            )

            if code != 0:

                msg = data.get(
                    "msg",
                    "Unknown"
                )

                print(
                    f"⚠️ [WinGo API] "
                    f"第{page_no}页 "
                    f"code={code} "
                    f"msg={msg}"
                )

                return []

            data_block = data.get(
                "data",
                {}
            )

            if not isinstance(
                data_block,
                dict
            ):
                return []

            raw_list = data_block.get(
                "list",
                []
            )

            if not isinstance(
                raw_list,
                list
            ):
                return []

            result = []

            for item in raw_list:

                if not isinstance(
                    item,
                    dict
                ):
                    continue

                try:

                    issue = str(
                        item[
                            "issueNumber"
                        ]
                    ).strip()

                    number = int(
                        item[
                            "number"
                        ]
                    )

                    if (
                        not issue
                        or not 0 <= number <= 9
                    ):
                        continue

                    result.append({
                        "issueNumber":
                            issue,

                        "number":
                            number,

                        "colour":
                            str(
                                item.get(
                                    "colour",
                                    ""
                                )
                            ),

                        "size":
                            get_wingo_size(
                                number
                            )
                    })

                except Exception:
                    continue

            return result

        except requests.RequestException as e:

            print(
                f"⚠️ [WinGo API] "
                f"第{page_no}页 "
                f"请求失败 "
                f"({attempt}/{WINGO_RETRIES}): "
                f"{e}"
            )

        except ValueError as e:

            print(
                f"⚠️ [WinGo API] "
                f"第{page_no}页 "
                f"数据错误: {e}"
            )

            return []

        except Exception as e:

            print(
                f"⚠️ [WinGo API] "
                f"第{page_no}页 "
                f"未知错误: {e}"
            )

        if attempt < WINGO_RETRIES:

            time.sleep(
                1.5 * attempt
            )

    return []


# ============================================================
# 更新 WinGo
# ============================================================

def update_wingo_data(
    draws,
    save=True
):

    if not draws:
        return

    draws = dedupe_wingo_draws(
        draws
    )

    draws.sort(
        key=issue_sort_key,
        reverse=True
    )

    draws = draws[
        :WINGO_MAX_HISTORY
    ]

    streak_val = draws[0].get(
        "size",
        "-"
    )

    streak_cnt = 0

    for d in draws:

        if d.get(
            "size"
        ) == streak_val:

            streak_cnt += 1

        else:

            break

    sizes = [
        d.get(
            "size"
        )
        for d in draws
    ]

    size_counts = Counter(
        sizes
    )

    prediction = (
        predict_wingo_next(
            draws
        )
    )

    with data_lock:

        global_data[
            "wingo"
        ] = {

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

    if save:
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

    # --------------------------------------------------------
    # 先从 data.json 读取旧数据
    # --------------------------------------------------------

    with data_lock:

        memory_draws = list(
            global_data[
                "wingo"
            ].get(
                "draws",
                []
            )
        )

    memory_draws = dedupe_wingo_draws(
        memory_draws
    )

    memory_draws.sort(
        key=issue_sort_key,
        reverse=True
    )

    seen_issues = {
        str(
            item.get(
                "issueNumber"
            )
        )
        for item in memory_draws
        if item.get(
            "issueNumber"
        )
    }

    # --------------------------------------------------------
    # 首次同步
    # --------------------------------------------------------

    print(
        f"🔍 [WinGo] "
        f"首次扫描最近 "
        f"{INIT_SCAN_PAGES} 页..."
    )

    for page in range(
        1,
        INIT_SCAN_PAGES + 1
    ):

        page_data = (
            fetch_wingo_draw_page(
                page_no=page,
                page_size=WINGO_PAGE_SIZE
            )
        )

        if page_data:

            for item in page_data:

                issue = str(
                    item.get(
                        "issueNumber",
                        ""
                    )
                )

                if (
                    issue
                    and issue not in seen_issues
                ):

                    seen_issues.add(
                        issue
                    )

                    memory_draws.append(
                        item
                    )

        else:

            print(
                f"⚠️ [WinGo] "
                f"第 {page} 页没有数据"
            )

        time.sleep(
            0.3
        )

    memory_draws = dedupe_wingo_draws(
        memory_draws
    )

    memory_draws.sort(
        key=issue_sort_key,
        reverse=True
    )

    memory_draws = memory_draws[
        :WINGO_MAX_HISTORY
    ]

    seen_issues = {
        str(
            item.get(
                "issueNumber"
            )
        )
        for item in memory_draws
    }

    if memory_draws:

        update_wingo_data(
            memory_draws
        )

    else:

        print(
            "⚠️ [WinGo] "
            "首次同步没有取得数据，"
            "继续等待实时 API..."
        )

    # --------------------------------------------------------
    # 实时循环
    # --------------------------------------------------------

    while True:

        try:

            time.sleep(
                POLL_INTERVAL
            )

            latest_page = (
                fetch_wingo_draw_page(
                    page_no=1,
                    page_size=WINGO_PAGE_SIZE
                )
            )

            if not latest_page:

                print(
                    "⏳ [WinGo] "
                    "本次没有取得最新开奖，"
                    "保留旧数据。"
                )

                continue

            new_items = []

            for item in latest_page:

                issue = str(
                    item.get(
                        "issueNumber",
                        ""
                    )
                )

                if not issue:
                    continue

                if issue not in seen_issues:

                    new_items.append(
                        item
                    )

            if new_items:

                new_items.sort(
                    key=issue_sort_key,
                    reverse=True
                )

                memory_draws = (
                    new_items
                    + memory_draws
                )

                memory_draws = (
                    dedupe_wingo_draws(
                        memory_draws
                    )
                )

                memory_draws.sort(
                    key=issue_sort_key,
                    reverse=True
                )

                memory_draws = (
                    memory_draws[
                        :WINGO_MAX_HISTORY
                    ]
                )

                seen_issues = {
                    str(
                        item.get(
                            "issueNumber"
                        )
                    )
                    for item in memory_draws
                }

                update_wingo_data(
                    memory_draws
                )

                print(
                    f"🆕 [WinGo] "
                    f"新增 {len(new_items)} 期"
                )

            else:

                # ------------------------------------------------
                # 如果没有新数据，定期再检查一次历史第一页
                # 防止临时 API 异常后漏掉数据
                # ------------------------------------------------

                print(
                    "⏳ [WinGo] "
                    "等待下一期开奖..."
                )

        except Exception as e:

            print(
                f"❌ [WinGo LOOP] "
                f"{e}"
            )

            time.sleep(
                3
            )


# ============================================================
# Baccarat 预测
# ============================================================

def predict_baccarat_next(
    history
):

    if not history:
        return "庄"

    recent = history[:10]

    banker_cnt = sum(
        1
        for h in recent
        if h.get(
            "result"
        ) == "庄"
    )

    player_cnt = sum(
        1
        for h in recent
        if h.get(
            "result"
        ) == "闲"
    )

    if banker_cnt >= 6:
        return "闲"

    if player_cnt >= 6:
        return "庄"

    return "庄"


# ============================================================
# Baccarat 预测准确率
# ============================================================

def calculate_baccarat_win_rate(
    history
):

    checked = 0
    correct = 0

    for item in history:

        predicted = item.get(
            "predict"
        )

        actual = item.get(
            "result"
        )

        # 和局不计算为庄/闲预测输赢
        if actual == "和":
            continue

        if predicted not in (
            "庄",
            "闲"
        ):
            continue

        checked += 1

        if predicted == actual:
            correct += 1

    if checked <= 0:
        return 0

    return round(
        correct
        / checked
        * 100,
        2
    )


# ============================================================
# Baccarat 二进制工具
# ============================================================

def bytes_to_hex(
    data
):

    if not isinstance(
        data,
        (
            bytes,
            bytearray
        )
    ):
        return ""

    return bytes(
        data
    ).hex().upper()


def safe_ascii(
    data
):

    try:

        return data.decode(
            "utf-8",
            errors="ignore"
        )

    except Exception:

        return ""


def normalize_room(
    text
):

    if not text:
        return None

    text = str(
        text
    ).upper().strip()

    # D051 -> D51
    if (
        text.startswith("D0")
        and len(text) >= 4
    ):

        room = (
            "D"
            + text[2:4]
        )

        if room in BACCARAT_ROOMS:
            return room

    if text in BACCARAT_ROOMS:
        return text

    return None


# ============================================================
# Choice 房间代码
# ============================================================

def room_to_choice_code(
    room
):

    mapping = {

        "D51":
            b"D051",

        "D52":
            b"D052",

        "D53":
            b"D053",

        "D54":
            b"D054",

        "D55":
            b"D055",

        "D56":
            b"D056",

        "D57":
            b"D057",

        "D58":
            b"D058"
    }

    return mapping.get(
        room,
        b"D051"
    )


# ============================================================
# Choice Baccarat 房间订阅封包
#
# 已确认格式：
#
# 000610030000001900000000
# + D051
# + 000000000000000100
#
# ============================================================

def build_baccarat_room_packet(
    room
):

    room_code = (
        room_to_choice_code(
            room
        )
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

    return bytes(
        packet
    )


# ============================================================
# Choice Baccarat 房间订阅
# ============================================================

def subscribe_baccarat_rooms(
    ws
):

    print(
        "📡 [Choice百家乐] "
        "开始发送房间订阅..."
    )

    for room in sorted(
        BACCARAT_ROOMS
    ):

        try:

            packet = (
                build_baccarat_room_packet(
                    room
                )
            )

            ws.send(
                packet,
                opcode=(
                    websocket.ABNF
                    .OPCODE_BINARY
                )
            )

            print(
                f"📤 [百家乐] "
                f"{room} -> "
                f"{bytes_to_hex(packet)}"
            )

            time.sleep(
                0.15
            )

        except Exception as e:

            print(
                f"⚠️ [百家乐] "
                f"{room} "
                f"订阅失败: {e}"
            )


# ============================================================
# Baccarat Binary Result Parser
#
# BacGameResultResp:
#
# vid   = 4 bytes
# res   = 1 byte
# code  = 4 bytes
# bval  = 1 byte
# pval  = 1 byte
# num   = 1 byte
# pair  = 1 byte
#
# Payload = 13 bytes
# ============================================================

def parse_bac_result_candidates(
    raw
):

    if not isinstance(
        raw,
        (
            bytes,
            bytearray
        )
    ):
        return []

    data = bytes(
        raw
    )

    candidates = []

    payload_length = 13

    if len(data) < payload_length:
        return candidates

    # --------------------------------------------------------
    # 搜索 D051-D058
    # --------------------------------------------------------

    for room in BACCARAT_ROOMS:

        vid = room_to_choice_code(
            room
        )

        start = 0

        while True:

            pos = data.find(
                vid,
                start
            )

            if pos < 0:
                break

            end = (
                pos
                + payload_length
            )

            if end <= len(data):

                chunk = data[
                    pos:end
                ]

                try:

                    res = chunk[4]

                    code_raw = chunk[
                        5:9
                    ]

                    bval = chunk[9]
                    pval = chunk[10]
                    num = chunk[11]
                    pair = chunk[12]

                    # ------------------------------------------------
                    # Baccarat 正常点数
                    # ------------------------------------------------

                    valid_points = (
                        0 <= bval <= 9
                        and
                        0 <= pval <= 9
                    )

                    valid_num = (
                        0 <= num <= 20
                    )

                    valid_pair = (
                        0 <= pair <= 3
                    )

                    if (
                        valid_points
                        and valid_num
                        and valid_pair
                    ):

                        if bval > pval:

                            result = "庄"

                        elif pval > bval:

                            result = "闲"

                        else:

                            result = "和"

                        code = safe_ascii(
                            code_raw
                        ).strip(
                            "\x00 "
                        )

                        candidates.append({

                            "room":
                                room,

                            "result":
                                result,

                            "bval":
                                bval,

                            "pval":
                                pval,

                            "num":
                                num,

                            "pair":
                                pair,

                            "res":
                                res,

                            "code":
                                code,

                            "offset":
                                pos,

                            "raw":
                                bytes(
                                    chunk
                                )
                        })

                except Exception:
                    pass

            start = pos + 1

    return candidates


# ============================================================
# Baccarat Packet Parser
# ============================================================

def parse_choice_baccarat_packet(
    raw_msg
):

    if not isinstance(
        raw_msg,
        (
            bytes,
            bytearray
        )
    ):
        return None

    raw = bytes(
        raw_msg
    )

    candidates = (
        parse_bac_result_candidates(
            raw
        )
    )

    if not candidates:
        return None

    # --------------------------------------------------------
    # 如果一个 packet 有多个结果
    # 取最后一个
    # --------------------------------------------------------

    item = candidates[-1]

    room = item[
        "room"
    ]

    result = item[
        "result"
    ]

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

        "room":
            room,

        "shoe":
            "01",

        "game":
            game_no,

        "result":
            result,

        "game_id":
            game_id,

        "bval":
            item[
                "bval"
            ],

        "pval":
            item[
                "pval"
            ],

        "num":
            item[
                "num"
            ],

        "pair":
            item[
                "pair"
            ],

        "code":
            item[
                "code"
            ],

        "res":
            item[
                "res"
            ]
    }


# ============================================================
# Baccarat Stats
# ============================================================

def update_baccarat_stats(
    room
):

    bacc = global_data[
        "baccarat"
    ]

    history = bacc[
        "rooms"
    ][
        room
    ]

    results = [
        h.get(
            "result"
        )
        for h in history
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

    bacc[
        "stats"
    ][
        "win_rate"
    ] = calculate_baccarat_win_rate(
        history
    )


# ============================================================
# Baccarat 全局预测
# ============================================================

def update_global_baccarat_prediction():

    bacc = global_data[
        "baccarat"
    ]

    room = bacc.get(
        "current_room",
        "D51"
    )

    history = (
        bacc[
            "rooms"
        ].get(
            room,
            []
        )
    )

    if not history:

        bacc[
            "predicted_result"
        ] = "--"

        return

    bacc[
        "predicted_result"
    ] = predict_baccarat_next(
        history
    )


# ============================================================
# Baccarat WS Message
# ============================================================

def on_baccarat_message(
    ws,
    message
):

    if not isinstance(
        message,
        (
            bytes,
            bytearray
        )
    ):

        return

    raw = bytes(
        message
    )

    # --------------------------------------------------------
    # Binary Debug
    # --------------------------------------------------------

    contains_room = any(
        room_code in raw
        for room_code in (
            b"D051",
            b"D052",
            b"D053",
            b"D054",
            b"D055",
            b"D056",
            b"D057",
            b"D058"
        )
    )

    if contains_room:

        print(
            f"📥 [百家乐 Binary] "
            f"{bytes_to_hex(raw)}"
        )

    # --------------------------------------------------------
    # Parse
    # --------------------------------------------------------

    try:

        parsed = (
            parse_choice_baccarat_packet(
                raw
            )
        )

    except Exception as e:

        print(
            f"⚠️ [百家乐 Parser] "
            f"{e}"
        )

        return

    if not parsed:
        return

    room = parsed[
        "room"
    ]

    if room not in BACCARAT_ROOMS:
        return

    with data_lock:

        bacc = global_data[
            "baccarat"
        ]

        room_history = bacc[
            "rooms"
        ][
            room
        ]

        # ----------------------------------------------------
        # 防重复
        # ----------------------------------------------------

        game_id = parsed.get(
            "game_id",
            ""
        )

        exists = any(
            item.get(
                "game_id"
            )
            == game_id

            for item in room_history
        )

        if exists:

            return

        # ----------------------------------------------------
        # 关键修正
        #
        # 这个结果还没有加入 history。
        #
        # 所以这里得到的 prediction
        # 才是真正「开奖前」的预测。
        # ----------------------------------------------------

        prediction_before_result = (
            predict_baccarat_next(
                room_history
            )
        )

        parsed[
            "predict"
        ] = prediction_before_result

        # ----------------------------------------------------
        # 最新结果放最前
        # ----------------------------------------------------

        room_history.insert(
            0,
            parsed
        )

        room_history = (
            room_history[
                :BACCARAT_MAX_HISTORY
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

        # ----------------------------------------------------
        # Stats
        # ----------------------------------------------------

        update_baccarat_stats(
            room
        )

        # ----------------------------------------------------
        # 关键修正
        #
        # 加入最新结果后，
        # 再预测下一局。
        # ----------------------------------------------------

        bacc[
            "predicted_result"
        ] = predict_baccarat_next(
            room_history
        )

    # --------------------------------------------------------
    # 保存
    # --------------------------------------------------------

    save_data_json()

    print(
        f"🃏 [百家乐 {room}] "
        f"结果:{parsed['result']} | "
        f"预测:{parsed['predict']} | "
        f"庄:{parsed['bval']} "
        f"闲:{parsed['pval']} | "
        f"局:{parsed['game']}"
    )


# ============================================================
# Baccarat WS Error
# ============================================================

def on_baccarat_error(
    ws,
    error
):

    print(
        f"⚠️ [百家乐 WS 错误] "
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
        "🔌 [Choice百家乐 WS断开]"
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

def on_baccarat_open(
    ws
):

    print(
        "🟢 [Choice百家乐 WS] "
        "连接成功"
    )

    print(
        f"🌐 {BACCARAT_WS_URL}"
    )

    try:

        subscribe_baccarat_rooms(
            ws
        )

        print(
            "✅ [Choice百家乐] "
            "D51-D58 订阅请求已发送"
        )

    except Exception as e:

        print(
            f"❌ [Choice百家乐] "
            f"初始化失败: {e}"
        )


# ============================================================
# Baccarat WebSocket
# ============================================================

def start_baccarat_ws():

    # --------------------------------------------------------
    # 不直接手动加入 Origin header
    #
    # websocket-client 自己会处理 Origin。
    # 使用 origin 参数指定来源。
    # --------------------------------------------------------

    headers = [
        "User-Agent: Mozilla/5.0 "
        "(Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 "
        "(KHTML, like Gecko) "
        "Chrome/153.0.0.0 "
        "Safari/537.36"
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

                on_open=
                    on_baccarat_open,

                on_message=
                    on_baccarat_message,

                on_error=
                    on_baccarat_error,

                on_close=
                    on_baccarat_close
            )

            ws.run_forever(

                ping_interval=20,

                ping_timeout=10,

                origin=BACCARAT_ORIGIN
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
            f"⏳ "
            f"{BACCARAT_RECONNECT_DELAY}秒后"
            f"重新连接 Baccarat..."
        )

        time.sleep(
            BACCARAT_RECONNECT_DELAY
        )


# ============================================================
# 启动时重新计算 Baccarat 数据
# ============================================================

def rebuild_baccarat_state():

    with data_lock:

        bacc = global_data[
            "baccarat"
        ]

        # ----------------------------------------------------
        # 每个房间重新计算
        # ----------------------------------------------------

        for room in BACCARAT_ROOMS:

            history = bacc[
                "rooms"
            ][
                room
            ]

            if not isinstance(
                history,
                list
            ):
                history = []

            history = history[
                :BACCARAT_MAX_HISTORY
            ]

            bacc[
                "rooms"
            ][
                room
            ] = history

            update_baccarat_stats(
                room
            )

        # ----------------------------------------------------
        # 当前房间
        # ----------------------------------------------------

        current_room = normalize_room(
            bacc.get(
                "current_room",
                "D51"
            )
        )

        if not current_room:
            current_room = "D51"

        bacc[
            "current_room"
        ] = current_room

        history = bacc[
            "rooms"
        ].get(
            current_room,
            []
        )

        if history:

            latest = history[0]

            bacc[
                "latest_result"
            ] = latest.get(
                "result",
                "--"
            )

            bacc[
                "shoe_no"
            ] = latest.get(
                "shoe",
                "01"
            )

            bacc[
                "game_no"
            ] = latest.get(
                "game",
                "01"
            )

            bacc[
                "predicted_result"
            ] = predict_baccarat_next(
                history
            )

        else:

            bacc[
                "latest_result"
            ] = "--"

            bacc[
                "predicted_result"
            ] = "--"


# ============================================================
# 打印启动状态
# ============================================================

def print_startup_status():

    with data_lock:

        wingo_count = len(
            global_data[
                "wingo"
            ][
                "draws"
            ]
        )

        current_room = (
            global_data[
                "baccarat"
            ][
                "current_room"
            ]
        )

        baccarat_count = len(
            global_data[
                "baccarat"
            ][
                "rooms"
            ].get(
                current_room,
                []
            )
        )

    print(
        "=" * 70
    )

    print(
        "🚀 WinGo + Choice百家乐 "
        "实时数据采集系统"
    )

    print(
        "=" * 70
    )

    print(
        f"🎯 WinGo API: "
        f"{WINGO_API_URL}"
    )

    print(
        f"🎯 WinGo Type ID: "
        f"{TYPE_ID}"
    )

    print(
        f"🎯 WinGo 历史: "
        f"{wingo_count} 期"
    )

    print(
        f"🃏 Baccarat WS: "
        f"{BACCARAT_WS_URL}"
    )

    print(
        f"🃏 Baccarat 当前房间: "
        f"{current_room}"
    )

    print(
        f"🃏 Baccarat 历史: "
        f"{baccarat_count} 局"
    )

    print(
        f"💾 数据文件: "
        f"{DATA_FILE}"
    )

    print(
        "=" * 70
    )


# ============================================================
# MAIN
# ============================================================

def main():

    # --------------------------------------------------------
    # 切换到 bot.py 所在目录
    # --------------------------------------------------------

    try:

        os.chdir(
            BASE_DIR
        )

    except Exception:
        pass

    # --------------------------------------------------------
    # 读取旧数据
    # --------------------------------------------------------

    load_existing_data()

    # --------------------------------------------------------
    # 重建 Baccarat Stats
    # --------------------------------------------------------

    rebuild_baccarat_state()

    # --------------------------------------------------------
    # 保存一次干净的数据
    # --------------------------------------------------------

    save_data_json()

    # --------------------------------------------------------
    # 显示启动状态
    # --------------------------------------------------------

    print_startup_status()

    # --------------------------------------------------------
    # WinGo Thread
    # --------------------------------------------------------

    wingo_thread = threading.Thread(

        target=wingo_loop,

        name="WinGoThread",

        daemon=True
    )

    wingo_thread.start()

    # --------------------------------------------------------
    # Baccarat Thread
    # --------------------------------------------------------

    baccarat_thread = threading.Thread(

        target=start_baccarat_ws,

        name="BaccaratThread",

        daemon=True
    )

    baccarat_thread.start()

    print(
        "🟢 [SYSTEM] "
        "WinGo + Baccarat 已启动"
    )

    # --------------------------------------------------------
    # Main Keep Alive
    # --------------------------------------------------------

    try:

        while True:

            time.sleep(
                1
            )

    except KeyboardInterrupt:

        print(
            "\n👋 "
            "程序已安全退出"
        )


# ============================================================
# ENTRY
# ============================================================

if __name__ == "__main__":

    main()
