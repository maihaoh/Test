import os
import json
import hashlib
from datetime import datetime

def get_hash(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode('utf-8')).hexdigest()

def main():
    data_file = 'data.json'
    
    default_data = {
        "update_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "price_history": [],
        "ai_learning": {"weights": {"ma_factor": 0.35, "rsi_factor": 0.25, "trend_factor": 0.40}},
        "market_analysis": {"big10": "60%", "small10": "40%", "big50": "55%", "small50": "45%"}
    }

    if os.path.exists(data_file):
        try:
            with open(data_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            data = default_data
    else:
        data = default_data

    data["update_time"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    data["data_hash"] = get_hash(data.get("market_analysis", {}))

    with open(data_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

    print(f"[{datetime.now()}] run_once.py 執行成功！")

if __name__ == "__main__":
    main()
