"""Merge independent multi-game producers without confusing attempt with success.

Pure code shared by the Render API and offline tests; never contains secrets.
"""
import time

GAMES = ('k3', '5d', 'trx')


def timestamp(record, key):
    try:
        return max(0, int(record.get(key) or 0))
    except (TypeError, ValueError):
        return 0


def merge_snapshots(base, runtime):
    data = dict(base) if isinstance(base, dict) else {}
    now = time.time()
    if not isinstance(runtime, dict):
        return data
    for game in GAMES:
        candidate = runtime.get(game)
        if not isinstance(candidate, dict):
            continue
        old = data.get(game) if isinstance(data.get(game), dict) else {}
        candidate_time = timestamp(candidate, 'last_success_at') or timestamp(candidate, 'updated_at')
        old_time = timestamp(old, 'last_success_at') or timestamp(old, 'updated_at')
        # Reject gross future clock-skew and snapshots without actual draws.
        if candidate_time and candidate_time <= now + 60 and candidate_time >= old_time and candidate.get('draws'):
            data[game] = candidate
        elif timestamp(candidate, 'last_attempt_at') > old_time and (
                not old_time or time.time() - old_time > 180):
            # Surface attempted read failure only if the relay did NOT already
            # deliver fresh data. Never hide a healthy relay's live snapshot.
            data[game] = {**old,
                          'status': str(candidate.get('status') or '等待数据'),
                          'last_attempt_at': candidate.get('last_attempt_at')}
    return data
