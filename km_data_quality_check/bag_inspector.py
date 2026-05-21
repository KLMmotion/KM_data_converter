from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import sqlite3
from typing import Any

import yaml

from .topic_metrics import compute_interval_summary, compute_topic_metrics


def inspect_bag(bag_dir: Path) -> dict[str, Any]:
    data_dir = bag_dir / "data"
    metadata_path = data_dir / "metadata.yaml"
    ros_files = sorted(data_dir.glob("*.mcap")) + sorted(data_dir.glob("*.db3"))

    files_metrics = _inspect_files(bag_dir, metadata_path, ros_files)
    metadata = _read_metadata(metadata_path)
    topics_from_messages, all_timestamps, read_warnings = _read_ros_timestamps(ros_files)

    timestamps_source = "raw"
    if not topics_from_messages:
        topics_from_messages = _topics_from_metadata(metadata)
        timestamps_source = "metadata_estimated" if topics_from_messages else "unavailable"

    topic_metrics = {
        topic: compute_topic_metrics(timestamps)
        for topic, timestamps in sorted(topics_from_messages.items())
    }

    bag_metrics = _bag_metrics(metadata, topic_metrics, topics_from_messages, all_timestamps)
    bag_metrics["timestamp_source"] = timestamps_source
    if read_warnings:
        bag_metrics["reader_warnings"] = read_warnings

    return {
        "files": files_metrics,
        "bag": bag_metrics,
        "topics": topic_metrics,
        "topic_timestamps": topics_from_messages,
        "timestamps_source": timestamps_source,
        "all_timestamps": all_timestamps,
        "metadata": metadata,
        "warnings": read_warnings,
    }


def _inspect_files(bag_dir: Path, metadata_path: Path, ros_files: list[Path]) -> dict[str, Any]:
    video_path = bag_dir / "video" / "cameras.mp4"
    ros_size = sum(path.stat().st_size for path in ros_files if path.exists())
    return {
        "recording_dir_exists": bag_dir.exists(),
        "metadata_yaml_exists": metadata_path.exists(),
        "metadata_yaml_size_bytes": metadata_path.stat().st_size if metadata_path.exists() else 0,
        "ros_data_file_exists": bool(ros_files),
        "ros_data_file_size_bytes": ros_size,
        "ros_data_files": [str(path) for path in ros_files],
        "cameras_mp4_exists": video_path.exists(),
        "cameras_mp4_size_bytes": video_path.stat().st_size if video_path.exists() else 0,
    }


def _read_metadata(metadata_path: Path) -> dict[str, Any]:
    if not metadata_path.exists():
        return {}
    try:
        with metadata_path.open("r", encoding="utf-8") as file:
            return yaml.safe_load(file) or {}
    except Exception as exc:
        return {"_read_error": str(exc)}


def _read_ros_timestamps(ros_files: list[Path]) -> tuple[dict[str, list[int]], list[int], list[str]]:
    topics: dict[str, list[int]] = defaultdict(list)
    all_timestamps: list[int] = []
    warnings: list[str] = []

    for path in ros_files:
        try:
            if path.suffix.lower() == ".mcap":
                _read_mcap(path, topics, all_timestamps)
            elif path.suffix.lower() == ".db3":
                _read_db3(path, topics, all_timestamps)
        except Exception as exc:
            warnings.append(f"Could not read {path.name}: {exc}")

    return dict(topics), all_timestamps, warnings


def _read_mcap(path: Path, topics: dict[str, list[int]], all_timestamps: list[int]) -> None:
    try:
        from mcap.reader import make_reader
    except ModuleNotFoundError as exc:
        raise RuntimeError("Python package 'mcap' is not installed; install dependencies to inspect MCAP timestamps.") from exc

    with path.open("rb") as file:
        reader = make_reader(file)
        for _, channel, message in reader.iter_messages():
            timestamp = int(message.log_time or message.publish_time)
            topics[channel.topic].append(timestamp)
            all_timestamps.append(timestamp)


def _read_db3(path: Path, topics: dict[str, list[int]], all_timestamps: list[int]) -> None:
    with sqlite3.connect(str(path)) as conn:
        topic_rows = conn.execute("SELECT id, name FROM topics").fetchall()
        topic_names = {int(topic_id): str(name) for topic_id, name in topic_rows}
        rows = conn.execute("SELECT topic_id, timestamp FROM messages ORDER BY id").fetchall()
        for topic_id, timestamp in rows:
            topic = topic_names.get(int(topic_id), f"<topic_id:{topic_id}>")
            timestamp_ns = int(timestamp)
            topics[topic].append(timestamp_ns)
            all_timestamps.append(timestamp_ns)


def _topics_from_metadata(metadata: dict[str, Any]) -> dict[str, list[int]]:
    info = metadata.get("rosbag2_bagfile_information", {})
    duration_ns = int(info.get("duration", {}).get("nanoseconds", 0) or 0)
    start_ns = int(info.get("starting_time", {}).get("nanoseconds_since_epoch", 0) or 0)
    topics: dict[str, list[int]] = {}

    for item in info.get("topics_with_message_count", []) or []:
        topic_metadata = item.get("topic_metadata", {})
        name = topic_metadata.get("name")
        count = int(item.get("message_count", 0) or 0)
        if not name:
            continue
        if count <= 0:
            topics[str(name)] = []
            continue
        if count == 1 or duration_ns <= 0:
            topics[str(name)] = [start_ns]
            continue
        step = duration_ns // max(1, count - 1)
        topics[str(name)] = [start_ns + index * step for index in range(count)]
    return topics


def _bag_metrics(
    metadata: dict[str, Any],
    topic_metrics: dict[str, dict[str, Any]],
    topic_timestamps: dict[str, list[int]],
    all_timestamps: list[int],
) -> dict[str, Any]:
    info = metadata.get("rosbag2_bagfile_information", {})
    duration_sec = float((info.get("duration", {}).get("nanoseconds", 0) or 0) / 1_000_000_000)
    start_ns = info.get("starting_time", {}).get("nanoseconds_since_epoch")
    message_count_total = int(info.get("message_count", 0) or 0)

    if all_timestamps:
        sorted_ts = sorted(all_timestamps)
        duration_sec = float((sorted_ts[-1] - sorted_ts[0]) / 1_000_000_000) if len(sorted_ts) > 1 else duration_sec
        start_ns = int(sorted_ts[0])
        end_ns = int(sorted_ts[-1])
        message_count_total = len(all_timestamps)
        timestamp_regression_count = sum(
            1 for prev, current in zip(all_timestamps, all_timestamps[1:], strict=False) if current < prev
        )
    else:
        end_ns = int(start_ns + duration_sec * 1_000_000_000) if start_ns is not None else None
        timestamp_regression_count = 0

    reference_topic = "/joint_states" if "/joint_states" in topic_metrics else _highest_frequency_topic(topic_metrics)
    reference_frequency_hz = topic_metrics.get(reference_topic, {}).get("frequency_hz", 0.0) if reference_topic else 0.0
    reference_timestamps = topic_timestamps.get(reference_topic or "", [])
    if not reference_timestamps and reference_topic is not None:
        reference_timestamps = _metadata_topic_timestamps(metadata, reference_topic)
    interval_summary = compute_interval_summary(reference_timestamps)

    if interval_summary["frame_interval_median_ms"] is None and all_timestamps:
        interval_summary = compute_interval_summary(sorted(all_timestamps))

    return {
        "recording_duration_sec": duration_sec,
        "bag_start_time": int(start_ns) if start_ns is not None else None,
        "bag_end_time": int(end_ns) if end_ns is not None else None,
        "timestamp_regression_count": int(timestamp_regression_count),
        "reference_topic": reference_topic,
        "reference_frequency_hz": reference_frequency_hz,
        "message_count_total": message_count_total,
        **interval_summary,
    }


def _highest_frequency_topic(topic_metrics: dict[str, dict[str, Any]]) -> str | None:
    if not topic_metrics:
        return None
    return max(topic_metrics, key=lambda topic: float(topic_metrics[topic].get("frequency_hz") or 0.0))


def _metadata_topic_timestamps(metadata: dict[str, Any], topic: str) -> list[int]:
    info = metadata.get("rosbag2_bagfile_information", {})
    duration_ns = int(info.get("duration", {}).get("nanoseconds", 0) or 0)
    start_ns = int(info.get("starting_time", {}).get("nanoseconds_since_epoch", 0) or 0)
    for item in info.get("topics_with_message_count", []) or []:
        if item.get("topic_metadata", {}).get("name") != topic:
            continue
        count = int(item.get("message_count", 0) or 0)
        if count <= 1 or duration_ns <= 0:
            return [start_ns] * max(0, count)
        step = duration_ns // max(1, count - 1)
        return [start_ns + index * step for index in range(count)]
    return []
