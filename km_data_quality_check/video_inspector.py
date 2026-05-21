from __future__ import annotations

from pathlib import Path
from typing import Any

import cv2
import numpy as np
import yaml

CAMERA_VIEW_SLICES = {
    "left_eye": ("top", "left"),
    "left_wrist": ("top", "right"),
    "right_wrist": ("bottom", "left"),
    "right_eye": ("bottom", "right"),
}

BLACK_FRAME_MEAN_BRIGHTNESS_THRESHOLD = 15.0
BLACK_SCREEN_RATIO_THRESHOLD = 0.8


def inspect_video(bag_dir: Path) -> dict[str, Any]:
    video_path = bag_dir / "video" / "cameras.mp4"
    first_frame_path = bag_dir / "video" / "cameras_first_frame.yaml"
    metrics: dict[str, Any] = {
        "video_path": str(video_path),
        "exists": video_path.exists(),
        "opened": False,
        "fps": 0.0,
        "width": 0,
        "height": 0,
        "frame_count": 0,
        "duration_sec": 0.0,
        "estimated_frame_interval_ms": None,
        "abnormal_frame_gap_count": None,
        "pts_note": "OpenCV does not expose reliable per-frame PTS here; frame gaps are estimated from fps and frame_count.",
        "blur_score": None,
        "exposure_abnormal_ratio": None,
        "camera_views": _empty_camera_views(),
        "black_frame_mean_brightness_threshold": BLACK_FRAME_MEAN_BRIGHTNESS_THRESHOLD,
        "black_screen_ratio_threshold": BLACK_SCREEN_RATIO_THRESHOLD,
        "video_start_time": None,
        "video_end_time": None,
        "first_frame_yaml_exists": first_frame_path.exists(),
    }

    if first_frame_path.exists():
        metrics["video_start_time"] = _read_first_frame_epoch_ns(first_frame_path)

    if not video_path.exists():
        return metrics

    cap = cv2.VideoCapture(str(video_path))
    try:
        metrics["opened"] = bool(cap.isOpened())
        if not cap.isOpened():
            return metrics

        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        duration_sec = float(frame_count / fps) if fps > 0 else 0.0

        metrics.update(
            {
                "fps": fps,
                "width": width,
                "height": height,
                "frame_count": frame_count,
                "duration_sec": duration_sec,
                "estimated_frame_interval_ms": float(1000.0 / fps) if fps > 0 else None,
            }
        )
        if metrics["video_start_time"] is not None:
            metrics["video_end_time"] = int(metrics["video_start_time"] + duration_sec * 1_000_000_000)

        blur_values: list[float] = []
        exposure_abnormal = 0
        camera_view_stats = _init_camera_view_stats()
        sampled = 0
        sample_limit = 120
        sample_stride = max(1, frame_count // sample_limit) if frame_count > 0 else 1
        index = 0
        while sampled < sample_limit:
            ok, frame = cap.read()
            if not ok:
                break
            if index % sample_stride == 0:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                blur_values.append(float(cv2.Laplacian(gray, cv2.CV_64F).var()))
                mean_brightness = float(np.mean(gray))
                if mean_brightness < 25.0 or mean_brightness > 230.0:
                    exposure_abnormal += 1
                _accumulate_camera_view_stats(frame, camera_view_stats)
                sampled += 1
            index += 1

        metrics["blur_score"] = float(np.median(blur_values)) if blur_values else None
        metrics["exposure_abnormal_ratio"] = float(exposure_abnormal / sampled) if sampled else None
        metrics["camera_views"] = _finalize_camera_view_stats(camera_view_stats)
    finally:
        cap.release()

    return metrics


def _empty_camera_views() -> dict[str, dict[str, Any]]:
    return {
        camera_name: {
            "sampled_frame_count": 0,
            "mean_brightness": None,
            "black_frame_ratio": None,
            "is_black_screen": None,
        }
        for camera_name in CAMERA_VIEW_SLICES
    }


def _init_camera_view_stats() -> dict[str, dict[str, Any]]:
    return {
        camera_name: {
            "sampled_frame_count": 0,
            "brightness_values": [],
            "black_frame_count": 0,
        }
        for camera_name in CAMERA_VIEW_SLICES
    }


def _accumulate_camera_view_stats(frame: np.ndarray, stats: dict[str, dict[str, Any]]) -> None:
    height, width = frame.shape[:2]
    half_h = height // 2
    half_w = width // 2
    slices = {
        "left_eye": (slice(0, half_h), slice(0, half_w)),
        "left_wrist": (slice(0, half_h), slice(half_w, width)),
        "right_wrist": (slice(half_h, height), slice(0, half_w)),
        "right_eye": (slice(half_h, height), slice(half_w, width)),
    }

    for camera_name, (rows, cols) in slices.items():
        crop = frame[rows, cols]
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        mean_brightness = float(np.mean(gray))
        stats[camera_name]["sampled_frame_count"] += 1
        stats[camera_name]["brightness_values"].append(mean_brightness)
        if mean_brightness < BLACK_FRAME_MEAN_BRIGHTNESS_THRESHOLD:
            stats[camera_name]["black_frame_count"] += 1


def _finalize_camera_view_stats(stats: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for camera_name, camera_stats in stats.items():
        sampled_count = int(camera_stats["sampled_frame_count"])
        brightness_values = camera_stats["brightness_values"]
        black_frame_count = int(camera_stats["black_frame_count"])
        black_frame_ratio = float(black_frame_count / sampled_count) if sampled_count else None
        result[camera_name] = {
            "sampled_frame_count": sampled_count,
            "mean_brightness": float(np.mean(brightness_values)) if brightness_values else None,
            "black_frame_ratio": black_frame_ratio,
            "is_black_screen": (
                bool(black_frame_ratio >= BLACK_SCREEN_RATIO_THRESHOLD)
                if black_frame_ratio is not None
                else None
            ),
        }
    return result


def _read_first_frame_epoch_ns(path: Path) -> int | None:
    try:
        with path.open("r", encoding="utf-8") as file:
            data = yaml.safe_load(file) or {}
        value = data.get("first_frame_time", {}).get("epoch_ns")
        return int(value) if value is not None else None
    except Exception:
        return None
