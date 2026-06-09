from __future__ import annotations

import argparse
from pathlib import Path

from .raw_checker import run_quality_check


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check raw BAG_STORAGE/my_bag-* recordings before conversion."
    )
    parser.add_argument(
        "--input",
        required=True,
        type=Path,
        help="BAG_STORAGE directory containing my_bag-* raw recordings.",
    )
    parser.add_argument(
        "--output",
        required=True,
        type=Path,
        help="Directory where quality reports will be written.",
    )
    parser.add_argument(
        "--rules",
        type=Path,
        default=None,
        help="Optional YAML file that overrides or appends quality rules by rule name.",
    )
    parser.add_argument(
        "--required-topic",
        action="append",
        default=None,
        help="Required topic to include in topic existence checks. Can be passed multiple times.",
    )
    parser.add_argument(
        "--replace-rules",
        action="store_true",
        help="Use --rules as the complete rule set instead of merging with default rules.",
    )
    return parser.parse_args(argv)


def _resolve_report_output_dir(output_root: Path) -> Path:
    if output_root.name == "quality_report":
        return output_root
    return output_root / "quality_report"


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)
    output_dir = _resolve_report_output_dir(args.output)
    summary = run_quality_check(
        input_dir=args.input,
        output_dir=output_dir,
        rules_path=args.rules,
        required_topics=args.required_topic,
        merge_default_rules=not args.replace_rules,
    )
    counts = summary["status_counts"]
    error_count = sum(item.get("error_count", 0) for item in summary["recordings"])
    warning_count = sum(item.get("warning_count", 0) for item in summary["recordings"])
    print(
        "[DONE] Raw quality check complete. "
        f"recordings={summary['recording_count']}, "
        f"passed={counts['passed']}, warning={counts['warning']}, failed={counts['failed']}, "
        f"error_checks={error_count}, warning_checks={warning_count}, "
        f"output={output_dir}"
    )


if __name__ == "__main__":
    main()
