from __future__ import annotations

from typing import Any

import numpy as np


def compute_alignment_metrics(
    bag_metrics: dict[str, Any],
    topic_metrics: dict[str, dict[str, Any]],
    video_metrics: dict[str, Any],
) -> dict[str, Any]:
    bag_start = bag_metrics.get("bag_start_time")
    bag_end = bag_metrics.get("bag_end_time")
    video_start = video_metrics.get("video_start_time")
    video_end = video_metrics.get("video_end_time")
    bag_duration = float(bag_metrics.get("recording_duration_sec") or 0.0)
    video_duration = float(video_metrics.get("duration_sec") or 0.0)
    duration_diff = abs(video_duration - bag_duration)

    metrics: dict[str, Any] = {
        "bag_start_time": bag_start,
        "bag_end_time": bag_end,
        "video_start_time": video_start,
        "video_end_time": video_end,
        "bag_duration": bag_duration,
        "video_duration": video_duration,
        "duration_diff_abs_sec": duration_diff,
        "overlap_duration": None,
        "overlap_ratio": None,
        "absolute_time_alignment_available": False,
        "alignment_note": "",
        "sync": {},
    }

    if bag_start is not None and bag_end is not None and video_start is not None and video_end is not None:
        overlap_ns = max(0, min(int(bag_end), int(video_end)) - max(int(bag_start), int(video_start)))
        overlap_duration = overlap_ns / 1_000_000_000
        denominator = min(bag_duration, video_duration) if min(bag_duration, video_duration) > 0 else 0.0
        metrics.update(
            {
                "overlap_duration": overlap_duration,
                "overlap_ratio": float(overlap_duration / denominator) if denominator > 0 else 0.0,
                "absolute_time_alignment_available": True,
            }
        )
    else:
        metrics["alignment_note"] = (
            "Missing video_start_wall_ns/cameras_first_frame.yaml timing; "
            "absolute time alignment is unavailable, only duration can be compared."
        )

    metrics["sync"] = _compute_sync_from_metrics(topic_metrics)
    return metrics


def compute_nearest_neighbor_sync(reference: list[int], target: list[int]) -> dict[str, Any]:
    if not reference or not target:
        return {
            "sync_error_median_ms": None,
            "sync_error_p95_ms": None,
            "sync_error_p99_ms": None,
            "sync_error_max_ms": None,
            "unmatched_count": len(reference),
        }

    ref = np.asarray(sorted(reference), dtype=np.int64)
    tgt = np.asarray(sorted(target), dtype=np.int64)
    positions = np.searchsorted(tgt, ref)
    errors: list[int] = []
    unmatched = 0
    for ref_ts, pos in zip(ref, positions, strict=False):
        candidates = []
        if pos < len(tgt):
            candidates.append(abs(int(tgt[pos]) - int(ref_ts)))
        if pos > 0:
            candidates.append(abs(int(tgt[pos - 1]) - int(ref_ts)))
        if not candidates:
            unmatched += 1
        else:
            errors.append(min(candidates))

    if not errors:
        return {
            "sync_error_median_ms": None,
            "sync_error_p95_ms": None,
            "sync_error_p99_ms": None,
            "sync_error_max_ms": None,
            "unmatched_count": unmatched,
        }

    err_ms = np.asarray(errors, dtype=np.float64) / 1_000_000.0
    return {
        "sync_error_median_ms": float(np.percentile(err_ms, 50)),
        "sync_error_p95_ms": float(np.percentile(err_ms, 95)),
        "sync_error_p99_ms": float(np.percentile(err_ms, 99)),
        "sync_error_max_ms": float(np.max(err_ms)),
        "unmatched_count": int(unmatched),
    }


def _compute_sync_from_metrics(topic_metrics: dict[str, dict[str, Any]]) -> dict[str, Any]:
    # Exact nearest-neighbor sync is computed in raw_checker when raw timestamps are available.
    # This placeholder keeps the report schema stable for metadata-only fallback runs.
    sync_topics = ["/info/gripper_feedback_L", "/info/gripper_feedback_R"]
    return {
        topic: {
            "sync_error_median_ms": None,
            "sync_error_p95_ms": None,
            "sync_error_p99_ms": None,
            "sync_error_max_ms": None,
            "unmatched_count": None,
        }
        for topic in sync_topics
        if topic in topic_metrics
    }
