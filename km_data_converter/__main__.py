from __future__ import annotations

import sys
from collections.abc import Callable

from . import mcap_to_rrd, pipeline, rrd_to_lerobot, split_video, video_to_rrd
from km_data_quality_check import cli as quality_check

Command = Callable[[list[str] | None], None]


def _print_help() -> None:
    print("KM Data Converter CLI")
    print("")
    print("Usage:")
    print("  python -m km_data_converter <command> [args]")
    print("")
    print("Commands:")
    print("  run-full       Run full pipeline: split -> mcap2rrd -> video2rrd -> lerobot")
    print("  split-video    Split tiled cameras.mp4 into four camera videos")
    print("  mcap-to-rrd    Export MCAP files to per-episode RRD")
    print("  video-to-rrd   Merge split videos with robot state into RRD")
    print("  rrd-to-lerobot Export video2rrd files to a LeRobot dataset")
    print("  quality-check  Check raw recordings before conversion")
    print("")
    print("Use -h/--help after a command for command-specific options.")


def main(argv: list[str] | None = None) -> None:
    args = list(sys.argv[1:] if argv is None else argv)

    commands: dict[str, Command] = {
        "run-full": pipeline.main,
        "split-video": split_video.main,
        "mcap-to-rrd": mcap_to_rrd.main,
        "video-to-rrd": video_to_rrd.main,
        "rrd-to-lerobot": rrd_to_lerobot.main,
        "quality-check": quality_check.main,
    }

    if not args or args[0] in {"-h", "--help"}:
        _print_help()
        return

    command = args[0]
    command_argv = args[1:]

    if command not in commands:
        print(f"Unknown command: {command}")
        print("")
        _print_help()
        raise SystemExit(2)

    commands[command](command_argv)


if __name__ == "__main__":
    main()
