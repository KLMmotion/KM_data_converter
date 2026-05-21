#!/usr/bin/env python3
"""Sample video frames and add image stats to a local LeRobot stats file."""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path
from typing import Any

import av
import numpy as np

try:
    from lerobot.datasets.compute_stats import (
        RunningQuantileStats,
        aggregate_feature_stats,
        auto_downsample_height_width,
    )
except ImportError as exc:  # pragma: no cover - depends on local environment
    raise ImportError(
        "This script needs lerobot.datasets.compute_stats. "
        "Please run it in the same Python environment used for conversion."
    ) from exc


DEFAULT_OUTPUT_NAME = "stats_with_images.json"
DEFAULT_TOLERANCE_S = 1e-4
DEFAULT_SAMPLE_RATIO = 0.10
RELAXED_TOLERANCE_S = 0.08


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def to_jsonable(value: Any) -> Any:
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, dict):
        return {key: to_jsonable(val) for key, val in value.items()}
    if isinstance(value, list):
        return [to_jsonable(item) for item in value]
    return value


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(to_jsonable(data), f, indent=4)
        f.write("\n")


def video_feature_keys(info: dict[str, Any]) -> list[str]:
    features = info.get("features")
    if not isinstance(features, dict):
        raise ValueError("meta/info.json does not contain a valid 'features' object.")

    keys = [
        key
        for key, feature in features.items()
        if isinstance(feature, dict) and feature.get("dtype") == "video"
    ]
    if not keys:
        raise ValueError("No video features with dtype='video' were found in meta/info.json.")
    return keys


def find_video_files(dataset_root: Path, feature_key: str, verbose: bool = True) -> list[Path]:
    video_dir = dataset_root / "videos" / feature_key
    if not video_dir.exists():
        if verbose:
            print(f"[warn] Missing video directory for {feature_key}: {video_dir}")
        return []
    return sorted(video_dir.glob("chunk-*/*.mp4"))


def load_frame_times(video_path: Path) -> np.ndarray:
    times: list[float] = []
    with av.open(str(video_path)) as container:
        stream = container.streams.video[0]
        time_base = stream.time_base
        for frame in container.decode(video=0):
            if frame.pts is not None:
                times.append(float(frame.pts * time_base))
    return np.asarray(times, dtype=np.float64)


def sample_timestamps(frame_times: np.ndarray, samples_per_video: int) -> list[float]:
    if samples_per_video <= 0:
        raise ValueError("--samples-per-video must be greater than 0.")
    if frame_times.size == 0:
        return []
    if frame_times.size <= samples_per_video:
        return frame_times.tolist()

    sample_idx = np.round(
        np.linspace(0, frame_times.size - 1, samples_per_video)
    ).astype(int)
    return frame_times[sample_idx].tolist()


def sample_count_for_frames(
    frame_count: int,
    samples_per_video: int | None = None,
    sample_ratio: float | None = None,
) -> int:
    if frame_count <= 0:
        return 0
    if sample_ratio is not None:
        if sample_ratio <= 0:
            raise ValueError("sample_ratio must be greater than 0.")
        return max(1, math.ceil(frame_count * sample_ratio))
    if samples_per_video is None:
        raise ValueError("Either samples_per_video or sample_ratio must be provided.")
    if samples_per_video <= 0:
        raise ValueError("--samples-per-video must be greater than 0.")
    return min(frame_count, samples_per_video)


def frame_to_chw_uint8(frame: av.VideoFrame) -> np.ndarray:
    rgb = frame.to_ndarray(format="rgb24")
    return rgb.transpose(2, 0, 1)


def format_image_stats(stats: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    formatted: dict[str, np.ndarray] = {}
    for key, value in stats.items():
        if key == "count":
            formatted[key] = value
        else:
            normalized = np.squeeze(value.reshape(1, -1, 1, 1) / 255.0, axis=0)
            formatted[key] = np.clip(normalized, 0.0, 1.0)
    return formatted


def decode_sampled_frames(
    video_path: Path,
    timestamps: list[float],
    tolerance_s: float,
    verbose: bool = True,
) -> list[np.ndarray]:
    try:
        return _decode_sampled_frames(video_path, timestamps, tolerance_s)
    except Exception:
        relaxed_tolerance = max(tolerance_s, RELAXED_TOLERANCE_S)
        if relaxed_tolerance == tolerance_s:
            raise
        if verbose:
            print(f"  - retry decode with tolerance_s={relaxed_tolerance}")
        return _decode_sampled_frames(video_path, timestamps, relaxed_tolerance)


def _decode_sampled_frames(
    video_path: Path,
    timestamps: list[float],
    tolerance_s: float,
) -> list[np.ndarray]:
    frames: list[np.ndarray] = []
    wanted = list(timestamps)
    if not wanted:
        return frames

    with av.open(str(video_path)) as container:
        stream = container.streams.video[0]
        time_base = stream.time_base
        next_idx = 0

        for frame in container.decode(video=0):
            if frame.pts is None:
                continue

            frame_time = float(frame.pts * time_base)
            while next_idx < len(wanted) and wanted[next_idx] + tolerance_s < frame_time:
                next_idx += 1

            if next_idx >= len(wanted):
                break

            if abs(frame_time - wanted[next_idx]) <= tolerance_s:
                frames.append(frame_to_chw_uint8(frame))
                next_idx += 1

        if len(frames) != len(wanted):
            raise RuntimeError(
                f"Decoded {len(frames)}/{len(wanted)} sampled frames from {video_path} "
                f"with tolerance_s={tolerance_s}."
            )

    return frames


def compute_video_file_stats(
    video_path: Path,
    samples_per_video: int,
    tolerance_s: float,
) -> dict[str, np.ndarray] | None:
    frame_times = load_frame_times(video_path)
    timestamps = sample_timestamps(frame_times, samples_per_video)
    if not timestamps:
        print(f"  - no frames found, skip: {video_path.name}")
        return None

    frames = decode_sampled_frames(video_path, timestamps, tolerance_s)
    tracker = RunningQuantileStats()

    for frame in frames:
        img_down = auto_downsample_height_width(frame)
        channels = img_down.shape[0]
        img_for_stats = img_down.transpose(1, 2, 0).reshape(-1, channels)
        tracker.update(img_for_stats)

    return format_image_stats(tracker.get_statistics())


def compute_image_stats(
    dataset_root: Path,
    video_keys: list[str],
    samples_per_video: int | None = None,
    tolerance_s: float = DEFAULT_TOLERANCE_S,
    sample_ratio: float | None = None,
    verbose: bool = True,
) -> dict[str, dict[str, np.ndarray]]:
    image_stats: dict[str, dict[str, np.ndarray]] = {}

    for feature_idx, feature_key in enumerate(video_keys, start=1):
        video_files = find_video_files(dataset_root, feature_key, verbose=verbose)
        if verbose:
            print(
                f"[image-stats] {feature_idx}/{len(video_keys)} {feature_key}: "
                f"{len(video_files)} video(s)"
            )

        per_video_stats: list[dict[str, np.ndarray]] = []
        for video_idx, video_path in enumerate(video_files, start=1):
            start_ts = time.perf_counter()
            frame_times = load_frame_times(video_path)
            sampled_count = sample_count_for_frames(
                frame_times.size,
                samples_per_video=samples_per_video,
                sample_ratio=sample_ratio,
            )
            if verbose:
                print(
                    f"  [{video_idx}/{len(video_files)}] {video_path.name}: "
                    f"frames={frame_times.size} samples={sampled_count}"
                )

            if frame_times.size == 0:
                if verbose:
                    print("    skip empty video")
                continue

            timestamps = sample_timestamps(frame_times, sampled_count)
            frames = decode_sampled_frames(video_path, timestamps, tolerance_s, verbose=verbose)

            tracker = RunningQuantileStats()
            for frame in frames:
                img_down = auto_downsample_height_width(frame)
                channels = img_down.shape[0]
                img_for_stats = img_down.transpose(1, 2, 0).reshape(-1, channels)
                tracker.update(img_for_stats)

            per_video_stats.append(format_image_stats(tracker.get_statistics()))
            elapsed = time.perf_counter() - start_ts
            if verbose:
                print(f"    done in {elapsed:.2f}s")

        if per_video_stats:
            image_stats[feature_key] = aggregate_feature_stats(per_video_stats)
        else:
            if verbose:
                print(f"[warn] No usable videos found for {feature_key}; stats not written.")

    return image_stats


def recompute_image_stats_file(
    dataset_root: Path,
    sample_ratio: float = DEFAULT_SAMPLE_RATIO,
    output: Path | None = None,
    tolerance_s: float = DEFAULT_TOLERANCE_S,
    verbose: bool = True,
) -> Path:
    dataset_root = dataset_root.expanduser().resolve()
    meta_dir = dataset_root / "meta"
    info_path = meta_dir / "info.json"
    stats_path = meta_dir / "stats.json"
    output_path = (
        output.expanduser().resolve()
        if output is not None
        else stats_path
    )

    if not dataset_root.exists():
        raise FileNotFoundError(f"Dataset root not found: {dataset_root}")
    if not info_path.exists():
        raise FileNotFoundError(f"Missing info.json: {info_path}")
    if not stats_path.exists():
        raise FileNotFoundError(f"Missing stats.json: {stats_path}")

    info = load_json(info_path)
    stats = load_json(stats_path)
    keys = video_feature_keys(info)

    if verbose:
        print(f"Dataset root: {dataset_root}")
        print(f"Input stats:   {stats_path}")
        print(f"Output stats:  {output_path}")
        print(f"Video keys:    {', '.join(keys)}")
        print(f"Sample ratio:  {sample_ratio:.0%}")

    image_stats = compute_image_stats(
        dataset_root=dataset_root,
        video_keys=keys,
        sample_ratio=sample_ratio,
        tolerance_s=tolerance_s,
        verbose=verbose,
    )

    stats.update(image_stats)
    write_json(output_path, stats)
    return output_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Sample frames from LeRobot video features and write a new stats JSON "
            "containing image statistics."
        )
    )
    parser.add_argument(
        "--dataset-root",
        type=Path,
        required=True,
        help="LeRobot dataset root.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help=(
            "Output JSON path. Default: "
            "<dataset-root>/meta/stats_with_images.json"
        ),
    )
    parser.add_argument(
        "--samples-per-video",
        type=int,
        default=1,
        help="Number of evenly spaced frames to sample from each video.",
    )
    parser.add_argument(
        "--tolerance-s",
        type=float,
        default=DEFAULT_TOLERANCE_S,
        help="Timestamp tolerance in seconds when matching sampled video frames.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    dataset_root = args.dataset_root.expanduser().resolve()
    meta_dir = dataset_root / "meta"
    info_path = meta_dir / "info.json"
    stats_path = meta_dir / "stats.json"
    output_path = (
        args.output.expanduser().resolve()
        if args.output is not None
        else meta_dir / DEFAULT_OUTPUT_NAME
    )

    if not dataset_root.exists():
        raise FileNotFoundError(f"Dataset root not found: {dataset_root}")
    if not info_path.exists():
        raise FileNotFoundError(f"Missing info.json: {info_path}")
    if not stats_path.exists():
        raise FileNotFoundError(f"Missing stats.json: {stats_path}")

    info = load_json(info_path)
    stats = load_json(stats_path)
    keys = video_feature_keys(info)

    print(f"Dataset root: {dataset_root}")
    print(f"Input stats:   {stats_path}")
    print(f"Output stats:  {output_path}")
    print(f"Video keys:    {', '.join(keys)}")
    print(f"Samples/video: {args.samples_per_video}")

    image_stats = compute_image_stats(
        dataset_root=dataset_root,
        video_keys=keys,
        samples_per_video=args.samples_per_video,
        tolerance_s=args.tolerance_s,
        verbose=True,
    )

    stats.update(image_stats)
    write_json(output_path, stats)
    print(f"Done. Wrote stats with image keys to: {output_path}")


if __name__ == "__main__":
    main()
