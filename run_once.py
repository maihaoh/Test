import json
import time
from collections import Counter

DATA_FILE = "data.json"

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


# ============================================================
# Load
# ============================================================

def load_data():

    try:

        with open(
            DATA_FILE,
            "r",
            encoding="utf-8"
        ) as f:

            return json.load(f)

    except Exception as e:

        print(
            f"❌ 无法读取 {DATA_FILE}: {e}"
        )

        return None


# ============================================================
# Save
# ============================================================

def save_data(data):

    data["updated_at"] = int(
        time.time()
    )

    temp_file = DATA_FILE + ".tmp"

    try:

        with open(
            temp_file,
            "w",
            encoding="utf-8"
        ) as f:

            json.dump(
                data,
                f,
                ensure_ascii=False,
                indent=2
            )

        import os

        if os.path.exists(DATA_FILE):

            os.remove(DATA_FILE)

        os.rename(
            temp_file,
            DATA_FILE
        )

        return True

    except Exception as e:

        print(
            f"❌ 保存失败: {e}"
        )

        return False


# ============================================================
# Baccarat helpers
# ============================================================

def clean_history(history):

    return [
        x
        for x in history
        if x.get("result")
        in ("庄", "闲", "和")
    ]


def bp_sequence(history):

    return [
        x["result"]
        for x in clean_history(history)
        if x["result"] in ("庄", "闲")
    ]


def recent_stats(
    history,
    count
):

    results = [
        x["result"]
        for x in clean_history(history)
    ]

    results = results[:count]

    return {
        "庄":
            results.count("庄"),

        "闲":
            results.count("闲"),

        "和":
            results.count("和")
    }


def get_streak(history):

    seq = bp_sequence(history)

    if not seq:

        return "-", 0

    latest = seq[0]

    count = 0

    for x in seq:

        if x == latest:

            count += 1

        else:

            break

    return latest, count


def detect_pattern(history):

    seq = bp_sequence(history)

    if len(seq) < 4:

        return "暂无足够数据"

    last = seq[:6]

    # 1-1
    if len(last) >= 4:

        if (
            last[0] != last[1]
            and
            last[1] != last[2]
            and
            last[2] != last[3]
        ):

            return "疑似1-1跳路"

    # 2-2
    if len(last) >= 4:

        if (
            last[0] == last[1]
            and
            last[2] == last[3]
            and
            last[0] != last[2]
        ):

            return "疑似2-2走势"

    # 3-3
    if len(last) >= 6:

        if (
            last[0] == last[1] == last[2]
            and
            last[3] == last[4] == last[5]
            and
            last[0] != last[3]
        ):

            return "疑似3-3走势"

    # 长龙
    streak_result, streak_count = (
        get_streak(history)
    )

    if streak_count >= 3:

        return (
            f"{streak_result}"
            f"连续{streak_count}局"
        )

    return "混合走势"


# ============================================================
# Prediction
# ============================================================

def predict(history):

    seq = bp_sequence(history)

    if len(seq) < 6:

        return {
            "signal": "WAIT",
            "prediction": "-",
            "confidence": 0,
            "reason": [
                "历史数据不足6局"
            ],
            "score": {
                "庄": 0,
                "闲": 0
            }
        }

    recent5 = seq[:5]

    recent10 = seq[:10]

    recent20 = seq[:20]

    banker = 0.0

    player = 0.0

    reasons = []

    # --------------------------------------------------------
    # Streak
    # --------------------------------------------------------

    streak_result, streak_count = (
        get_streak(history)
    )

    if streak_count >= 3:

        if streak_result == "庄":

            banker += 1.5

            reasons.append(
                f"庄连续{streak_count}局"
            )

        else:

            player += 1.5

            reasons.append(
                f"闲连续{streak_count}局"
            )

    # --------------------------------------------------------
    # Recent 5
    # --------------------------------------------------------

    b5 = recent5.count("庄")

    p5 = recent5.count("闲")

    if b5 >= 4:

        banker += 1

        reasons.append(
            "最近5局庄偏多"
        )

    elif p5 >= 4:

        player += 1

        reasons.append(
            "最近5局闲偏多"
        )

    # --------------------------------------------------------
    # Recent 10
    # --------------------------------------------------------

    b10 = recent10.count("庄")

    p10 = recent10.count("闲")

    if b10 - p10 >= 3:

        banker += 1.5

        reasons.append(
            "最近10局庄偏多"
        )

    elif p10 - b10 >= 3:

        player += 1.5

        reasons.append(
            "最近10局闲偏多"
        )

    # --------------------------------------------------------
    # Recent 20
    # --------------------------------------------------------

    b20 = recent20.count("庄")

    p20 = recent20.count("闲")

    if b20 - p20 >= 4:

        banker += 1

        reasons.append(
            "最近20局庄偏多"
        )

    elif p20 - b20 >= 4:

        player += 1

        reasons.append(
            "最近20局闲偏多"
        )

    # --------------------------------------------------------
    # Pattern
    # --------------------------------------------------------

    pattern = detect_pattern(history)

    if pattern == "疑似1-1跳路":

        if seq[0] == "庄":

            player += 1

        else:

            banker += 1

        reasons.append(
            "检测到疑似1-1"
        )

    elif pattern == "疑似2-2走势":

        if seq[0] == "庄":

            banker += 0.7

        else:

            player += 0.7

        reasons.append(
            "检测到疑似2-2"
        )

    elif pattern == "疑似3-3走势":

        if seq[0] == "庄":

            banker += 0.7

        else:

            player += 0.7

        reasons.append(
            "检测到疑似3-3"
        )

    # --------------------------------------------------------
    # Final
    # --------------------------------------------------------

    difference = abs(
        banker - player
    )

    if difference < 1.0:

        return {
            "signal": "WAIT",
            "prediction": "-",
            "confidence": 0,
            "reason":
                reasons +
                ["信号冲突，观望"],
            "score": {
                "庄":
                    round(banker, 2),

                "闲":
                    round(player, 2)
            }
        }

    if banker > player:

        result = "庄"

    else:

        result = "闲"

    confidence = int(
        min(
            95,
            50 + difference * 12
        )
    )

    return {
        "signal": result,

        "prediction": result,

        "confidence": confidence,

        "reason": reasons,

        "score": {
            "庄":
                round(banker, 2),

            "闲":
                round(player, 2)
        }
    }


# ============================================================
# Analyze Room
# ============================================================

def analyze_room(
    history
):

    prediction = predict(history)

    streak_result, streak_count = (
        get_streak(history)
    )

    return {

        "signal":
            prediction["signal"],

        "confidence":
            prediction["confidence"],

        "streak_result":
            streak_result,

        "streak_count":
            streak_count,

        "recent5":
            recent_stats(
                history,
                5
            ),

        "recent10":
            recent_stats(
                history,
                10
            ),

        "recent20":
            recent_stats(
                history,
                20
            ),

        "recent30":
            recent_stats(
                history,
                30
            ),

        "pattern":
            detect_pattern(
                history
            ),

        "reason":
            prediction["reason"],

        "score":
            prediction["score"]
    }


# ============================================================
# Backtest
# ============================================================

def backtest(
    history
):

    # history:
    # newest -> oldest

    sequence = bp_sequence(history)

    if len(sequence) < 20:

        return {
            "total": 0,
            "win": 0,
            "loss": 0,
            "wait": 0,
            "win_rate": 0
        }

    total = 0

    win = 0

    loss = 0

    wait = 0

    # --------------------------------------------------------
    # 从较旧的位置开始模拟
    # --------------------------------------------------------

    for index in range(
        len(sequence) - 1,
        5,
        -1
    ):

        target = sequence[index]

        previous_history = (
            sequence[index + 1:]
        )

        fake_history = [
            {
                "result": x
            }
            for x in previous_history
        ]

        prediction = predict(
            fake_history
        )

        predicted = prediction.get(
            "prediction",
            "-"
        )

        if predicted not in ("庄", "闲"):

            wait += 1

            continue

        total += 1

        if predicted == target:

            win += 1

        else:

            loss += 1

    if total > 0:

        win_rate = round(
            win / total * 100,
            2
        )

    else:

        win_rate = 0

    return {
        "total": total,
        "win": win,
        "loss": loss,
        "wait": wait,
        "win_rate": win_rate
    }


# ============================================================
# Process
# ============================================================

def process():

    data = load_data()

    if data is None:

        return

    # ========================================================
    # 兼容旧版 WinGo JSON
    # ========================================================

    if "wingo" not in data:

        old_draws = data.get(
            "draws",
            []
        )

        old_stats = data.get(
            "stats",
            {}
        )

        data["wingo"] = {

            "stats":
                old_stats,

            "draws":
                old_draws
        }

    # ========================================================
    # Baccarat
    # ========================================================

    if "baccarat" not in data:

        data["baccarat"] = {

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

            "analysis": {},

            "rooms": {}
        }

    rooms = data[
        "baccarat"
    ].setdefault(
        "rooms",
        {}
    )

    # ========================================================
    # 每个房间分析
    # ========================================================

    for room in BACCARAT_ROOMS:

        history = rooms.get(
            room,
            []
        )

        if not history:

            rooms[room] = []

            continue

        # ----------------------------------------------
        # 分析
        # ----------------------------------------------

        analysis = analyze_room(
            history
        )

        # ----------------------------------------------
        # Backtest
        # ----------------------------------------------

        bt = backtest(
            history
        )

        # ----------------------------------------------
        # 房间统计
        # ----------------------------------------------

        results = [
            x.get("result")
            for x in history
        ]

        counts = Counter(
            results
        )

        # ----------------------------------------------
        # 给每一局补预测结果
        # ----------------------------------------------

        for item in history:

            if "prediction_result" not in item:

                item["prediction_result"] = "WAIT"

        # ----------------------------------------------
        # 写回
        # ----------------------------------------------

        # D51 作为主分析
        if room == "D51":

            data["baccarat"][
                "analysis"
            ] = analysis

            data["baccarat"][
                "backtest"
            ] = bt

            data["baccarat"][
                "predicted_result"
            ] = analysis.get(
                "signal",
                "WAIT"
            )

            data["baccarat"][
                "prediction_status"
            ] = analysis.get(
                "signal",
                "WAIT"
            )

            data["baccarat"][
                "stats"
            ][
                "banker_cnt"
            ] = counts.get(
                "庄",
                0
            )

            data["baccarat"][
                "stats"
            ][
                "player_cnt"
            ] = counts.get(
                "闲",
                0
            )

            data["baccarat"][
                "stats"
            ][
                "tie_cnt"
            ] = counts.get(
                "和",
                0
            )

        # 房间级 backtest
        if room not in data["baccarat"]:

            data["baccarat"][room] = {}

        # 给 room 本身附加分析
        # 不破坏 rooms 原来的列表结构
        # 因此额外写入 room_analysis

    # ========================================================
    # 保存
    # ========================================================

    if save_data(data):

        print("=" * 60)

        print(
            "✅ data.json 分析更新完成"
        )

        print("=" * 60)

        baccarat = data[
            "baccarat"
        ]

        print(
            f"🏠 房间: "
            f"{baccarat.get('current_room', 'D51')}"
        )

        print(
            f"🎯 当前预测: "
            f"{baccarat.get('predicted_result', '-')}"
        )

        print(
            f"📊 状态: "
            f"{baccarat.get('prediction_status', 'WAIT')}"
        )

        print(
            f"📈 Backtest: "
            f"{baccarat.get('backtest', {})}"
        )

        print("=" * 60)


# ============================================================
# Main
# ============================================================

if __name__ == "__main__":

    process()
