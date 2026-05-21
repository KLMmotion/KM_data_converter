from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np


def compute_topic_metrics(timestamps_ns: Sequence[int]) -> dict[str, Any]:
    values = [int(ts) for ts in timestamps_ns if ts is not None]
    count = len(values)
    if count == 0:
        return {
            "topic_exists": False,
            "message_count": 0,
            "duration_sec": 0.0,
            "frequency_hz": 0.0,
            "first_timestamp": None,
            "last_timestamp": None,
            "max_interval_ms": None,
            "median_interval_ms": None,
            "p95_interval_ms": None,
            "p99_interval_ms": None,
            "timestamp_regression_count": 0,
            "duplicate_timestamp_count": 0,
        }

    ordered = np.asarray(values, dtype=np.int64)
    sorted_values = np.sort(ordered)
    duration_sec = float((sorted_values[-1] - sorted_values[0]) / 1_000_000_000) if count > 1 else 0.0
    frequency_hz = float((count - 1) / duration_sec) if duration_sec > 0 else 0.0
    intervals_ms = np.diff(sorted_values).astype(np.float64) / 1_000_000.0
    ordered_diffs = np.diff(ordered)

    return {
        "topic_exists": True,
        "message_count": count,
        "duration_sec": duration_sec,
        "frequency_hz": frequency_hz,
        "first_timestamp": int(sorted_values[0]),
        "last_timestamp": int(sorted_values[-1]),
        "max_interval_ms": _percentile(intervals_ms, 100),
        "median_interval_ms": _percentile(intervals_ms, 50),
        "p95_interval_ms": _percentile(intervals_ms, 95),
        "p99_interval_ms": _percentile(intervals_ms, 99),
        "timestamp_regression_count": int(np.sum(ordered_diffs < 0)) if count > 1 else 0,
        "duplicate_timestamp_count": int(count - len(np.unique(sorted_values))),
    }


def compute_interval_summary(timestamps_ns: Sequence[int]) -> dict[str, Any]:
    values = [int(ts) for ts in timestamps_ns if ts is not None]
    if len(values) < 2:
        return {
            "frame_interval_median_ms": None,
            "frame_interval_p95_ms": None,
            "frame_interval_p99_ms": None,
            "frame_interval_max_ms": None,
            "dropped_frame_count": 0,
        }

    sorted_values = np.sort(np.asarray(values, dtype=np.int64))
    intervals_ms = np.diff(sorted_values).astype(np.float64) / 1_000_000.0
    median_ms = _percentile(intervals_ms, 50)
    drop_threshold_ms = max(100.0, float(median_ms or 0.0) * 2.5)

    return {
        "frame_interval_median_ms": median_ms,
        "frame_interval_p95_ms": _percentile(intervals_ms, 95),
        "frame_interval_p99_ms": _percentile(intervals_ms, 99),
        "frame_interval_max_ms": _percentile(intervals_ms, 100),
        "dropped_frame_count": int(np.sum(intervals_ms > drop_threshold_ms)),
    }


def _percentile(values: np.ndarray, percentile: float) -> float | None:
    if values.size == 0:
        return None
    return float(np.percentile(values, percentile))
