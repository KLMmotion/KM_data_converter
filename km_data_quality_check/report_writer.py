from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def write_recording_report(report: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    _write_json(output_dir / "raw_quality_report.json", report)
    (output_dir / "raw_quality_report.md").write_text(_recording_markdown(report), encoding="utf-8")


def write_summary_report(summary: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    _write_json(output_dir / "summary_raw_quality_report.json", summary)
    (output_dir / "summary_raw_quality_report.md").write_text(_summary_markdown(summary), encoding="utf-8")


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _recording_markdown(report: dict[str, Any]) -> str:
    lines = [
        f"# Raw Quality Report: {report['recording_name']}",
        "",
        f"- Overall status: **{report['overall_status']}**",
        f"- Created at: {report['created_at']}",
        f"- Input path: `{report['input_path']}`",
        "",
        "## Findings",
        "",
    ]

    findings = [check for check in report["checks"] if check["status"] in {"warning", "error"}]
    if findings:
        lines.extend(_checks_table(findings))
    else:
        lines.append("All enabled checks passed.")

    lines.extend(["", "## Bag Metrics", ""])
    lines.extend(_dict_table(report["metrics"].get("bag", {})))
    lines.extend(["", "## Topic Metrics", ""])
    for topic, metrics in sorted(report["metrics"].get("topics", {}).items()):
        lines.append(f"### `{topic}`")
        lines.extend(_dict_table(metrics))
        lines.append("")

    lines.extend(["## Video Metrics", ""])
    lines.extend(_dict_table(report["metrics"].get("video", {})))
    lines.extend(["", "## Alignment Metrics", ""])
    alignment = dict(report["metrics"].get("alignment", {}))
    sync = alignment.pop("sync", {})
    lines.extend(_dict_table(alignment))
    if sync:
        lines.extend(["", "### Sync", ""])
        for topic, metrics in sorted(sync.items()):
            lines.append(f"#### `{topic}`")
            lines.extend(_dict_table(metrics))
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def _summary_markdown(summary: dict[str, Any]) -> str:
    lines = [
        "# Summary Raw Quality Report",
        "",
        f"- Created at: {summary['created_at']}",
        f"- Input path: `{summary['input_path']}`",
        f"- Output path: `{summary['output_path']}`",
        f"- Recording count: {summary['recording_count']}",
        "",
        "## Status Counts",
        "",
    ]
    lines.extend(_dict_table(summary["status_counts"]))
    lines.extend(["", "## Recordings", "", "| recording | status | errors | warnings |", "| --- | --- | ---: | ---: |"])
    for item in summary["recordings"]:
        lines.append(
            f"| `{item['recording_name']}` | {item['overall_status']} | "
            f"{item['error_count']} | {item['warning_count']} |"
        )
    return "\n".join(lines).rstrip() + "\n"


def _checks_table(checks: list[dict[str, Any]]) -> list[str]:
    lines = ["| status | scope | target | metric | value | threshold | message | suggestion |", "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for check in checks:
        lines.append(
            "| {status} | {scope} | `{target}` | `{metric}` | {value} | {threshold} | {message} | {suggestion} |".format(
                status=check["status"],
                scope=check["scope"],
                target=_escape_pipe(check["target"]),
                metric=_escape_pipe(check["metric"]),
                value=_escape_pipe(_format_value(check["value"])),
                threshold=_escape_pipe(_format_value(check["threshold"])),
                message=_escape_pipe(check["message"]),
                suggestion=_escape_pipe(check["suggestion"]),
            )
        )
    return lines


def _dict_table(values: dict[str, Any]) -> list[str]:
    if not values:
        return ["No metrics available."]
    lines = ["| metric | value |", "| --- | --- |"]
    for key, value in values.items():
        lines.append(f"| `{_escape_pipe(str(key))}` | {_escape_pipe(_format_value(value))} |")
    return lines


def _format_value(value: Any) -> str:
    if isinstance(value, float):
        return f"{value:.6g}"
    if isinstance(value, (list, dict)):
        return f"`{json.dumps(value, ensure_ascii=False)}`"
    if value is None:
        return "null"
    return str(value)


def _escape_pipe(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ")
