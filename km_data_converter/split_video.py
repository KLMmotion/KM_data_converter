from __future__ import annotations

import argparse
from pathlib import Path

import cv2


def _build_inner_slice(size: int, start_ratio: float, end_ratio: float) -> slice:
    """Build a safe inner slice after trimming both sides by ratio."""
    start = int(size * start_ratio)
    end = size - int(size * end_ratio)

    # Ensure at least one pixel remains even for small inputs.
    start = max(0, min(start, size - 1))
    end = max(start + 1, min(end, size))
    return slice(start, end)


def split_cameras_video(video_path: Path, target_fps: float = 10.0) -> bool:
    """Split a 2x2 tiled cameras.mp4 and crop each camera with fixed margins."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"[ERROR] Cannot open: {video_path}")
        return False

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    src_fps = cap.get(cv2.CAP_PROP_FPS)
    src_fps = src_fps if src_fps and src_fps > 0 else 30.0

    if width < 2 or height < 2:
        print(f"[ERROR] Invalid size {width}x{height}: {video_path}")
        cap.release()
        return False

    if target_fps <= 0:
        print(f"[ERROR] target_fps must be > 0, got {target_fps}")
        cap.release()
        return False

    output_fps = min(target_fps, src_fps)
    half_w = width // 2
    half_h = height // 2

    out_dir = video_path.parent
    outputs = {
        "left_eye.mp4": (slice(0, half_h), slice(0, half_w)),
        "right_eye.mp4": (slice(0, half_h), slice(half_w, width)),
        "left_wrist.mp4": (slice(half_h, height), slice(0, half_w)),
        "right_wrist.mp4": (slice(half_h, height), slice(half_w, width)),
    }
    # crop_margins = {
    #     "left_eye.mp4": {"top": 0.30, "bottom": 0.30, "left": 0.28, "right": 0.28},
    #     "right_eye.mp4": {"top": 0.30, "bottom": 0.30, "left": 0.28, "right": 0.28},
    #     "left_wrist.mp4": {"top": 0.15, "bottom": 0.15, "left": 0.15, "right": 0.15},
    #     "right_wrist.mp4": {"top": 0.15, "bottom": 0.15, "left": 0.15, "right": 0.15},
    # }
    # inner_slices: dict[str, tuple[slice, slice]] = {}

    # for name, margins in crop_margins.items():
    #     inner_rows = _build_inner_slice(half_h, margins["top"], margins["bottom"])
    #     inner_cols = _build_inner_slice(half_w, margins["left"], margins["right"])
    #     inner_slices[name] = (inner_rows, inner_cols)

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writers: dict[str, cv2.VideoWriter] = {}

    sample_interval = 1.0 / output_fps
    next_output_time = 0.0
    frame_index = 0
    written_count = 0

    try:
        for name in outputs:
            # inner_rows, inner_cols = inner_slices[name]
            # out_h = inner_rows.stop - inner_rows.start
            # out_w = inner_cols.stop - inner_cols.start
            out_h = half_h
            out_w = half_w
            out_path = out_dir / name
            writer = cv2.VideoWriter(str(out_path), fourcc, output_fps, (out_w, out_h))
            if not writer.isOpened():
                print(f"[ERROR] Cannot create writer: {out_path}")
                return False
            writers[name] = writer

        while True:
            ok, frame = cap.read()
            if not ok:
                break

            current_time = frame_index / src_fps
            if current_time + 1e-9 >= next_output_time:
                for name, (rows, cols) in outputs.items():
                    crop = frame[rows, cols]
                    # inner_rows, inner_cols = inner_slices[name]
                    # crop = crop[inner_rows, inner_cols]
                    writers[name].write(crop)

                written_count += 1
                next_output_time += sample_interval

            frame_index += 1

        print(
            f"[OK] {video_path} -> read {frame_index} frames, "
            f"wrote {written_count} frames at {output_fps:.2f} fps"
        )
        return True

    finally:
        cap.release()
        for writer in writers.values():
            writer.release()


def find_cameras_videos(root: Path) -> list[Path]:
    """Find files named cameras.mp4 under BAG_STORAGE/**/video/."""
    return sorted(root.glob("**/video/cameras.mp4"))


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Split tiled cameras.mp4 into four camera videos.")
    parser.add_argument(
        "bag_storage_path",
        nargs="?",
        type=Path,
        help="Optional positional BAG_STORAGE path. Equivalent to --bag-storage.",
    )
    parser.add_argument(
        "--bag-storage",
        type=Path,
        default=None,
        help="Directory containing many my_bag-* folders.",
    )
    parser.add_argument(
        "--target-fps",
        type=float,
        default=10.0,
        help="Target FPS for split output videos.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Fail on first split failure.",
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


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)
    bag_storage = _resolve_bag_storage(args)

    if not bag_storage.exists():
        cwd = Path.cwd()
        raise FileNotFoundError(
            "Folder not found: "
            f"{bag_storage}. Current working directory is: {cwd}. "
            "Use an absolute path, e.g. --bag-storage C:\\Users\\willi\\Desktop\\BAG_STORAGE"
        )

    videos = find_cameras_videos(bag_storage)
    if not videos:
        raise ValueError(f"No cameras.mp4 found under: {bag_storage}")

    print(f"[INFO] Found {len(videos)} cameras.mp4 files")
    success_count = 0
    fail_count = 0
    for video_path in videos:
        if split_cameras_video(video_path, target_fps=args.target_fps):
            success_count += 1
        else:
            fail_count += 1
            if args.strict:
                raise RuntimeError(f"Failed to split video: {video_path}")

    print(f"[DONE] Success {success_count}/{len(videos)}, skipped={fail_count}")


if __name__ == "__main__":
    main()
