from __future__ import annotations

import argparse
from pathlib import Path
import shutil

from .mcap_to_rrd import convert_bag_storage_to_rrd
from .rrd_to_lerobot import convert_rrds_to_lerobot
from .split_video import find_cameras_videos, split_cameras_video
from .video_to_rrd import convert_bag_storage_video_to_rrd


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run full pipeline: split video -> mcap2rrd -> video2rrd -> lerobot dataset."
    )
    parser.add_argument(
        "bag_storage_path",
        nargs="?",
        type=Path,
        help="Optional positional BAG_STORAGE path. Equivalent to --bag-storage.",
    )
    parser.add_argument(
        "output_root_path",
        nargs="?",
        type=Path,
        help=(
            "Optional positional output root path. Equivalent to --output-dir. "
            "Outputs are written under <output_root>/mcap2rrd, <output_root>/video2rrd, "
            "and <output_root>/lerobot_output/lerobot_datasets-<timestamp>."
        ),
    )
    parser.add_argument(
        "--bag-storage",
        type=Path,
        default=None,
        help="Directory containing many my_bag-* folders.",
    )
    parser.add_argument(
        "--split-target-fps",
        "--target-fps",
        dest="split_target_fps",
        type=float,
        default=10.0,
        help="Target FPS for splitting each tiled cameras.mp4 into four camera videos.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help=(
            "Unified output root directory. Equivalent to positional output_root_path. "
            "If omitted, defaults to <bag_storage>/datasets."
        ),
    )
    parser.add_argument(
        "--mcap2rrd-dir",
        type=Path,
        default=None,
        help="Output directory for mcap-to-rrd files.",
    )
    parser.add_argument(
        "--video2rrd-dir",
        type=Path,
        default=None,
        help="Output directory for video-enriched rrd files.",
    )
    parser.add_argument(
        "--lerobot-output",
        type=Path,
        default=None,
        help="Base output path for final LeRobot dataset. The pipeline appends the earliest bag timestamp.",
    )
    parser.add_argument(
        "--repo-id",
        type=str,
        default="rerun/droid_lerobot_full",
        help="LeRobot repo_id metadata for the generated dataset.",
    )
    parser.add_argument(
        "--end-effector",
        choices=["gripper", "hand"],
        default="gripper",
        help="Select robot end-effector state source: gripper (default) or hand.",
    )
    parser.add_argument(
        "--task-description",
        type=str,
        default=None,
        help=(
            "Optional fixed task description to write for all frames in the final LeRobot dataset. "
            "If omitted, task text is read from /language_instruction in each RRD."
        ),
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Fail on first bad bag while running mcap2rrd/video2rrd steps.",
    )
    return parser.parse_args(argv)


def _resolve_bag_storage(args: argparse.Namespace) -> Path:
    if args.bag_storage is not None and args.bag_storage_path is not None:
        raise ValueError("Use either positional BAG_STORAGE path or --bag-storage, not both.")

    if args.bag_storage is not None:
        return args.bag_storage

    if args.bag_storage_path is not None:
        return args.bag_storage_path

    return Path("BAG_STORAGE")


def _resolve_output_paths(args: argparse.Namespace) -> tuple[Path, Path, Path]:
    explicit_output_root = args.output_root_path
    if args.output_dir is not None and args.output_root_path is not None:
        raise ValueError("Use either positional output_root_path or --output-dir, not both.")
    if args.output_dir is not None:
        explicit_output_root = args.output_dir

    # If no output root is provided, default to bag_storage/datasets.
    if explicit_output_root is None:
        output_root = _resolve_bag_storage(args) / "datasets"
    else:
        output_root = explicit_output_root

    mcap2rrd_dir = args.mcap2rrd_dir if args.mcap2rrd_dir is not None else (output_root / "mcap2rrd")
    video2rrd_dir = args.video2rrd_dir if args.video2rrd_dir is not None else (output_root / "video2rrd")
    lerobot_output = (
        args.lerobot_output
        if args.lerobot_output is not None
        else (output_root / "lerobot_output" / "lerobot_datasets")
    )

    return mcap2rrd_dir, video2rrd_dir, lerobot_output


def _split_all_videos(bag_storage: Path, target_fps: float, strict: bool) -> tuple[int, int]:
    if not bag_storage.exists():
        raise FileNotFoundError(f"bag storage does not exist: {bag_storage}")

    videos = find_cameras_videos(bag_storage)
    if not videos:
        raise ValueError(f"No cameras.mp4 found under: {bag_storage}")

    success_count = 0
    fail_count = 0

    for video_path in videos:
        ok = split_cameras_video(video_path, target_fps=target_fps)
        if ok:
            success_count += 1
            continue

        fail_count += 1
        if strict:
            raise RuntimeError(f"Failed to split video: {video_path}")

    if success_count == 0:
        raise RuntimeError("No cameras.mp4 was successfully split.")

    return success_count, fail_count


def _list_bag_dirs(bag_storage: Path) -> list[Path]:
    if not bag_storage.exists():
        raise FileNotFoundError(f"bag storage does not exist: {bag_storage}")

    bag_dirs = [
        child
        for child in sorted(bag_storage.iterdir())
        if child.is_dir() and child.name.startswith("my_bag-")
    ]
    if not bag_dirs:
        raise ValueError(f"No my_bag-* directories found under: {bag_storage}")
    return bag_dirs


def _bag_timestamp(bag_dir: Path) -> str:
    prefix = "my_bag-"
    if bag_dir.name.startswith(prefix):
        return bag_dir.name[len(prefix):]
    return bag_dir.name


def _resolve_lerobot_output(bag_storage: Path, base_output: Path) -> Path:
    earliest_bag_dir = _list_bag_dirs(bag_storage)[0]
    earliest_timestamp = _bag_timestamp(earliest_bag_dir)
    return base_output.parent / f"{base_output.name}-{earliest_timestamp}"


def _reset_video2rrd_dir(output_dir: Path) -> int:
    if not output_dir.exists():
        return 0

    removed_count = 0
    for rrd_path in output_dir.rglob("*.rrd"):
        if rrd_path.is_file():
            rrd_path.unlink()
            removed_count += 1

    for child in sorted(output_dir.iterdir(), reverse=True):
        if child.is_dir() and not any(child.iterdir()):
            shutil.rmtree(child)

    return removed_count


def _reset_lerobot_output_dir(output_dir: Path) -> bool:
    if not output_dir.exists():
        return False

    shutil.rmtree(output_dir)
    return True


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)
    bag_storage = _resolve_bag_storage(args)
    mcap2rrd_dir, video2rrd_dir, lerobot_output_base = _resolve_output_paths(args)
    lerobot_output = _resolve_lerobot_output(bag_storage, lerobot_output_base)

    print("[1/4] Splitting tiled cameras.mp4 into four camera videos ...")
    split_success, split_fail = _split_all_videos(
        bag_storage=bag_storage,
        target_fps=args.split_target_fps,
        strict=args.strict,
    )
    print(
        "[1/4] Done. "
        f"Split={split_success}, skipped={split_fail}, target_fps={args.split_target_fps}"
    )

    print("[2/4] Converting MCAP -> mcap2rrd ...")
    mcap_paths, mcap_fail = convert_bag_storage_to_rrd(
        bag_storage=bag_storage,
        output_dir=mcap2rrd_dir,
        strict=args.strict,
    )
    print(f"[2/4] Done. Exported={len(mcap_paths)}, skipped={mcap_fail}, dir={mcap2rrd_dir}")

    removed_rrds = _reset_video2rrd_dir(video2rrd_dir)
    if removed_rrds > 0:
        print(f"[3/4] Cleared existing RRDs in {video2rrd_dir}: removed={removed_rrds}")

    print("[3/4] Converting with video -> video2rrd ...")
    video_paths, video_fail = convert_bag_storage_video_to_rrd(
        bag_storage=bag_storage,
        output_dir=video2rrd_dir,
        dataset_dir=mcap2rrd_dir,
        end_effector=args.end_effector,
        strict=args.strict,
    )
    print(f"[3/4] Done. Exported={len(video_paths)}, skipped={video_fail}, dir={video2rrd_dir}")

    if _reset_lerobot_output_dir(lerobot_output):
        print(f"[4/4] Cleared existing LeRobot output: {lerobot_output}")

    print("[4/4] Converting video2rrd -> LeRobot dataset ...")
    episodes = convert_rrds_to_lerobot(
        input_dir=video2rrd_dir,
        output_root=lerobot_output,
        repo_id=args.repo_id,
        end_effector=args.end_effector,
        task_description=args.task_description,
    )

    from .recompute_stats import DEFAULT_SAMPLE_RATIO, recompute_image_stats_file

    recompute_image_stats_file(
        dataset_root=lerobot_output,
        sample_ratio=DEFAULT_SAMPLE_RATIO,
        output=lerobot_output / "meta" / "stats.json",
        verbose=False,
    )
    print(f"[4/4] Done. Episodes={episodes}, output={lerobot_output}")


if __name__ == "__main__":
    main()
