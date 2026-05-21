from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .alignment_metrics import compute_alignment_metrics, compute_nearest_neighbor_sync
from .bag_inspector import inspect_bag
from .report_writer import write_recording_report, write_summary_report
from .rules import QualityRule, enabled_rules, evaluate_rule, load_rules, make_check, target_matches
from .topic_metrics import compute_topic_metrics
from .video_inspector import inspect_video

REQUIRED_TOPICS = [
    "/joint_states",
    "/info/gripper_feedback_L",
    "/info/gripper_feedback_R",
]


def run_quality_check(input_dir: Path, output_dir: Path, rules_path: Path | None = None) -> dict[str, Any]:
    rules = enabled_rules(load_rules(rules_path))
    bag_dirs = _list_recordings(input_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    reports: list[dict[str, Any]] = []
    for bag_dir in bag_dirs:
        report = check_recording(bag_dir, rules)
        write_recording_report(report, output_dir / bag_dir.name)
        reports.append(report)

    summary = _build_summary(input_dir, output_dir, reports)
    write_summary_report(summary, output_dir)
    return summary


def check_recording(bag_dir: Path, rules: list[QualityRule]) -> dict[str, Any]:
    created_at = datetime.now(timezone.utc).isoformat()
    checks: list[dict[str, Any]] = []
    metrics: dict[str, Any] = {
        "files": {},
        "bag": {},
        "topics": {},
        "video": {},
        "alignment": {},
    }

    try:
        bag_result = inspect_bag(bag_dir)
        topic_timestamps = bag_result.pop("topic_timestamps", {})
        timestamps_source = bag_result.pop("timestamps_source", "unavailable")
        bag_result.pop("all_timestamps", None)
        bag_result.pop("metadata", None)
        reader_warnings = list(bag_result.pop("warnings", []))
        metrics["files"] = bag_result["files"]
        metrics["bag"] = bag_result["bag"]
        metrics["topics"] = dict(bag_result["topics"])
    except Exception as exc:
        topic_timestamps = {}
        timestamps_source = "unavailable"
        reader_warnings = []
        checks.append(
            make_check(
                "bag_inspection_exception",
                "file",
                str(bag_dir),
                "inspect_bag",
                str(exc),
                "no exception",
                "error",
                f"Could not inspect raw ROS recording: {exc}",
                "Check metadata.yaml and raw bag files, then rerun quality-check.",
            )
        )

    for topic in REQUIRED_TOPICS:
        if topic not in metrics["topics"]:
            metrics["topics"][topic] = compute_topic_metrics([])

    try:
        metrics["video"] = inspect_video(bag_dir)
    except Exception as exc:
        checks.append(
            make_check(
                "video_inspection_exception",
                "video",
                str(bag_dir / "video" / "cameras.mp4"),
                "inspect_video",
                str(exc),
                "no exception",
                "error",
                f"Could not inspect cameras.mp4: {exc}",
                "Check that the video file is readable and not corrupted.",
            )
        )

    metrics["alignment"] = compute_alignment_metrics(metrics["bag"], metrics["topics"], metrics["video"])
    _fill_sync_metrics(metrics["alignment"], topic_timestamps, timestamps_source)

    checks.extend(_evaluate_rules(rules, metrics))
    checks.extend(_reader_warning_checks(reader_warnings))
    checks.extend(_alignment_availability_checks(metrics["alignment"]))

    overall_status = _overall_status(checks)
    report = {
        "recording_name": bag_dir.name,
        "overall_status": overall_status,
        "created_at": created_at,
        "input_path": str(bag_dir),
        "checks": checks,
        "metrics": metrics,
    }
    return report


def _list_recordings(input_dir: Path) -> list[Path]:
    if not input_dir.exists():
        raise FileNotFoundError(f"Input directory does not exist: {input_dir}")
    if input_dir.is_dir() and input_dir.name.startswith("my_bag-"):
        return [input_dir]
    bag_dirs = [child for child in sorted(input_dir.iterdir()) if child.is_dir() and child.name.startswith("my_bag-")]
    if not bag_dirs:
        raise ValueError(f"No my_bag-* directories found under: {input_dir}")
    return bag_dirs


def _evaluate_rules(rules: list[QualityRule], metrics: dict[str, Any]) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    for rule in rules:
        if rule.scope == "file":
            value = metrics["files"].get(rule.metric)
            checks.append(evaluate_rule(rule, "recording", value))
        elif rule.scope == "bag":
            value = metrics["bag"].get(rule.metric)
            checks.append(evaluate_rule(rule, "bag", value))
        elif rule.scope == "topic":
            for topic, topic_metric in sorted(metrics["topics"].items()):
                if target_matches(rule, topic):
                    checks.append(evaluate_rule(rule, topic, topic_metric.get(rule.metric)))
        elif rule.scope == "video":
            if rule.topic_pattern:
                for camera_name, camera_metrics in sorted(metrics["video"].get("camera_views", {}).items()):
                    if target_matches(rule, camera_name):
                        checks.append(evaluate_rule(rule, camera_name, camera_metrics.get(rule.metric)))
            else:
                value = metrics["video"].get(rule.metric)
                checks.append(evaluate_rule(rule, "video/cameras.mp4", value))
        elif rule.scope == "alignment":
            if rule.topic_pattern:
                for topic, sync_metrics in sorted(metrics["alignment"].get("sync", {}).items()):
                    if target_matches(rule, topic):
                        value = sync_metrics.get(rule.metric)
                        if value is None:
                            checks.append(
                                make_check(
                                    f"{rule.name}_unavailable",
                                    rule.scope,
                                    topic,
                                    rule.metric,
                                    value,
                                    rule.threshold,
                                    "warning",
                                    f"{rule.metric} is unavailable for {topic}; raw timestamps could not be inspected.",
                                    "Install MCAP/ROS bag reader dependencies and verify the raw bag file is readable.",
                                )
                            )
                            continue
                        checks.append(evaluate_rule(rule, topic, value))
            else:
                checks.append(evaluate_rule(rule, "video_vs_bag", metrics["alignment"].get(rule.metric)))
    return checks


def _fill_sync_metrics(alignment: dict[str, Any], topic_timestamps: dict[str, list[int]], timestamps_source: str) -> None:
    reference = topic_timestamps.get("/joint_states", [])
    sync = alignment.setdefault("sync", {})
    if timestamps_source != "raw":
        for topic in ["/info/gripper_feedback_L", "/info/gripper_feedback_R"]:
            sync[topic] = {
                "sync_error_median_ms": None,
                "sync_error_p95_ms": None,
                "sync_error_p99_ms": None,
                "sync_error_max_ms": None,
                "unmatched_count": None,
            }
        return

    for topic in ["/info/gripper_feedback_L", "/info/gripper_feedback_R"]:
        sync[topic] = compute_nearest_neighbor_sync(reference, topic_timestamps.get(topic, []))


def _reader_warning_checks(warnings: list[str]) -> list[dict[str, Any]]:
    return [
        make_check(
            "raw_bag_reader_warning",
            "file",
            "raw_bag",
            "reader_warning",
            warning,
            "readable raw bag timestamps",
            "warning",
            warning,
            "Install the declared dependencies and verify the raw bag file is not corrupted.",
        )
        for warning in warnings
    ]


def _alignment_availability_checks(alignment: dict[str, Any]) -> list[dict[str, Any]]:
    if alignment.get("absolute_time_alignment_available"):
        return []
    return [
        make_check(
            "absolute_time_alignment_unavailable",
            "alignment",
            "video_vs_bag",
            "absolute_time_alignment_available",
            False,
            True,
            "warning",
            alignment.get("alignment_note") or "Absolute video/ROS time alignment is unavailable.",
            "Record video_start_wall_ns or keep video/cameras_first_frame.yaml with first_frame_time.epoch_ns.",
        )
    ]


def _overall_status(checks: list[dict[str, Any]]) -> str:
    statuses = {check.get("status") for check in checks}
    if "error" in statuses:
        return "failed"
    if "warning" in statuses:
        return "warning"
    return "passed"


def _build_summary(input_dir: Path, output_dir: Path, reports: list[dict[str, Any]]) -> dict[str, Any]:
    status_counts = {"passed": 0, "warning": 0, "failed": 0}
    for report in reports:
        status_counts[report["overall_status"]] += 1

    return {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "input_path": str(input_dir),
        "output_path": str(output_dir),
        "recording_count": len(reports),
        "status_counts": status_counts,
        "recordings": [
            {
                "recording_name": report["recording_name"],
                "overall_status": report["overall_status"],
                "input_path": report["input_path"],
                "report_dir": str(output_dir / report["recording_name"]),
                "error_count": sum(1 for check in report["checks"] if check["status"] == "error"),
                "warning_count": sum(1 for check in report["checks"] if check["status"] == "warning"),
            }
            for report in reports
        ],
    }
