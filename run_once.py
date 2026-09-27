import os
import json
import hashlib
from datetime import datetime, timezone, timedelta


# =========================================================
# CONFIG
# =========================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data.json")

MYT = timezone(timedelta(hours=8))


# =========================================================
# TIME
# =========================================================

def now_myt():
    return datetime.now(MYT).strftime("%Y-%m-%d %H:%M:%S")


# =========================================================
# HASH
# =========================================================

def get_hash(data):
    raw = json.dumps(
        data,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":")
    )

    return hashlib.sha256(
        raw.encode("utf-8")
    ).hexdigest()


# =========================================================
# DEFAULT STRUCTURE
# =========================================================

def create_default_data():

    return {
        "updated_at": now_myt(),

        "wingo": {
            "stats": {
                "streak_val": "--",
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
                "special": ""
            },

            "draws": []
        },

        "baccarat": {
            "current_room": "D51",
            "shoe_no": "--",
            "game_no": "--",
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


# =========================================================
# LOAD
# =========================================================

def load_data():

    if not os.path.exists(DATA_FILE):
        print("data.json 不存在，建立新的資料結構")
        return create_default_data()

    try:

        with open(
            DATA_FILE,
            "r",
            encoding="utf-8"
        ) as f:

            data = json.load(f)

        if not isinstance(data, dict):
            raise ValueError("data.json 不是 JSON object")

        return data

    except Exception as e:

        print(
            f"⚠️ 讀取 data.json 失敗: {e}"
        )

        return create_default_data()


# =========================================================
# NORMALIZE
# =========================================================

def normalize_data(data):

    default = create_default_data()

    # -----------------------------------------------------
    # Root
    # -----------------------------------------------------

    if not isinstance(data, dict):
        data = {}

    # -----------------------------------------------------
    # WinGo
    # -----------------------------------------------------

    if not isinstance(
        data.get("wingo"),
        dict
    ):
        data["wingo"] = {}

    wingo = data["wingo"]

    if not isinstance(
        wingo.get("stats"),
        dict
    ):
        wingo["stats"] = {}

    if not isinstance(
        wingo.get("prediction"),
        dict
    ):
        wingo["prediction"] = {}

    if not isinstance(
        wingo.get("draws"),
        list
    ):
        wingo["draws"] = []

    for key, value in default["wingo"]["stats"].items():

        if key not in wingo["stats"]:
            wingo["stats"][key] = value

    for key, value in default["wingo"]["prediction"].items():

        if key not in wingo["prediction"]:
            wingo["prediction"][key] = value

    # -----------------------------------------------------
    # Baccarat
    # -----------------------------------------------------

    if not isinstance(
        data.get("baccarat"),
        dict
    ):
        data["baccarat"] = {}

    baccarat = data["baccarat"]

    if not isinstance(
        baccarat.get("stats"),
        dict
    ):
        baccarat["stats"] = {}

    if not isinstance(
        baccarat.get("rooms"),
        dict
    ):
        baccarat["rooms"] = {}

    for key, value in default["baccarat"]["stats"].items():

        if key not in baccarat["stats"]:
            baccarat["stats"][key] = value

    for room in (
        "D51",
        "D52",
        "D53",
        "D54",
        "D55",
        "D56",
        "D57",
        "D58"
    ):

        if not isinstance(
            baccarat["rooms"].get(room),
            list
        ):
            baccarat["rooms"][room] = []

    if "current_room" not in baccarat:
        baccarat["current_room"] = "D51"

    if "shoe_no" not in baccarat:
        baccarat["shoe_no"] = "--"

    if "game_no" not in baccarat:
        baccarat["game_no"] = "--"

    if "latest_result" not in baccarat:
        baccarat["latest_result"] = "--"

    if "predicted_result" not in baccarat:
        baccarat["predicted_result"] = "--"

    # -----------------------------------------------------
    # Root timestamp
    # -----------------------------------------------------

    data["updated_at"] = now_myt()

    return data


# =========================================================
# REMOVE OLD CONFLICTING FIELDS
# =========================================================

def cleanup_old_fields(data):

    # 這些是舊版 run_once.py 使用的欄位。
    # 不再讓 run_once.py 建立新的舊結構。
    #
    # 如果 Dashboard 目前還有使用，
    # 不強制刪除，只是不再重新建立。

    return data


# =========================================================
# SAVE
# =========================================================

def save_data(data):

    temp_file = DATA_FILE + ".tmp"

    data["updated_at"] = now_myt()

    # hash 只根據真正的 dashboard data 計算
    hash_source = {
        "wingo": data.get("wingo", {}),
        "baccarat": data.get("baccarat", {})
    }

    data["data_hash"] = get_hash(
        hash_source
    )

    with open(
        temp_file,
        "w",
        encoding="utf-8"
    ) as f:

        json.dump(
            data,
            f,
            ensure_ascii=False,
            indent=4
        )

        f.flush()
        os.fsync(f.fileno())

    os.replace(
        temp_file,
        DATA_FILE
    )


# =========================================================
# VALIDATE BACCARAT
# =========================================================

def validate_baccarat(data):

    baccarat = data.get(
        "baccarat",
        {}
    )

    rooms = baccarat.get(
        "rooms",
        {}
    )

    valid_rooms = (
        "D51",
        "D52",
        "D53",
        "D54",
        "D55",
        "D56",
        "D57",
        "D58"
    )

    total = 0

    for room in valid_rooms:

        history = rooms.get(
            room,
            []
        )

        if not isinstance(
            history,
            list
        ):
            rooms[room] = []
            continue

        clean_history = []

        for item in history:

            if not isinstance(
                item,
                dict
            ):
                continue

            result = item.get(
                "result"
            )

            if result not in (
                "庄",
                "闲",
                "和"
            ):
                continue

            # 確保必要欄位存在
            item.setdefault(
                "room",
                room
            )

            item.setdefault(
                "game",
                item.get(
                    "game_no",
                    "--"
                )
            )

            item.setdefault(
                "predict",
                "--"
            )

            item.setdefault(
                "game_id",
                ""
            )

            item.setdefault(
                "bval",
                0
            )

            item.setdefault(
                "pval",
                0
            )

            item.setdefault(
                "num",
                0
            )

            item.setdefault(
                "pair",
                0
            )

            clean_history.append(
                item
            )

        rooms[room] = clean_history[:200]

        total += len(
            rooms[room]
        )

    return total


# =========================================================
# MAIN
# =========================================================

def main():

    print("=" * 60)
    print("GitHub Actions - run_once.py")
    print("=" * 60)

    data = load_data()

    data = normalize_data(
        data
    )

    data = cleanup_old_fields(
        data
    )

    baccarat_total = validate_baccarat(
        data
    )

    save_data(
        data
    )

    print(
        f"[{now_myt()}] data.json 更新完成"
    )

    print(
        f"WinGo draws : "
        f"{len(data['wingo']['draws'])}"
    )

    print(
        f"Baccarat    : "
        f"{baccarat_total}"
    )

    print(
        f"Latest      : "
        f"{data['baccarat'].get('latest_result', '--')}"
    )

    print(
        f"Hash        : "
        f"{data.get('data_hash', '--')}"
    )

    print("=" * 60)


if __name__ == "__main__":
    main()
