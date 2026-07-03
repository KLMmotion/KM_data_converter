from __future__ import annotations

import argparse
from fractions import Fraction
from pathlib import Path

import av
import cv2

from .video_stream import load_video_stream_config, resolve_video_stream_entities

KEYFRAME_INTERVAL_SECONDS = 1.5


def _build_inner_slice(size: int, start_ratio: float, end_ratio: float) -> slice:
    """Build a safe inner slice after trimming both sides by ratio."""
    start = int(size * start_ratio)
    end = size - int(size * end_ratio)

    # Ensure at least one pixel remains even for small inputs.
    start = max(0, min(start, size - 1))
    end = max(start + 1, min(end, size))
    return slice(start, end)


def _fps_fraction(fps: float) -> Fraction:
    return Fraction(str(round(fps, 6))).limit_denominator(1000)


def _keyframe_interval(fps: float) -> int:
    return max(1, int(round(fps * KEYFRAME_INTERVAL_SECONDS)))


def _open_h264_writer(out_path: Path, fps: float, width: int, height: int) -> tuple[av.container.OutputContainer, av.VideoStream]:
    container = av.open(str(out_path), mode="w", format="mp4")
    stream = container.add_stream("libx264", rate=_fps_fraction(fps))
    assert type(stream) is av.VideoStream

    keyframe_interval = _keyframe_interval(fps)
    stream.width = width
    stream.height = height
    stream.pix_fmt = "yuv420p"
    stream.codec_context.gop_size = keyframe_interval
    stream.codec_context.max_b_frames = 0
    stream.codec_context.options = {
        "preset": "veryfast",
        "tune": "zerolatency",
        "x264-params": f"keyint={keyframe_interval}:min-keyint={keyframe_interval}:scenecut=0",
    }
    return container, stream


def _write_h264_frame(writer: tuple[av.container.OutputContainer, av.VideoStream], frame_bgr) -> None:
    container, stream = writer
    frame = av.VideoFrame.from_ndarray(frame_bgr, format="bgr24")
    frame = frame.reformat(format="yuv420p")
    for packet in stream.encode(frame):
        container.mux(packet)


def _close_h264_writer(writer: tuple[av.container.OutputContainer, av.VideoStream]) -> None:
    container, stream = writer
    for packet in stream.encode(None):
        container.mux(packet)
    container.close()


def _grid_slices(width: int, height: int) -> dict[str, tuple[slice, slice]]:
    half_w = width // 2
    half_h = height // 2
    return {
        "top_left": (slice(0, half_h), slice(0, half_w)),
        "top_right": (slice(0, half_h), slice(half_w, width)),
        "bottom_left": (slice(half_h, height), slice(0, half_w)),
        "bottom_right": (slice(half_h, height), slice(half_w, width)),
    }


def _safe_h264_size(size: int) -> int:
    if size < 2:
        raise ValueError(f"Video quadrant is too small for h264 output: {size}px")
    if size % 2 == 0:
        return size
    return size - 1


def split_stitched_video_by_config(
    video_path: Path,
    target_fps: float = 10.0,
    video_stream_config: dict[str, list[dict[str, str]]] | None = None,
) -> bool:
    """Split a 2x2 tiled cameras.mp4 according to the selected grid-to-role mapping."""
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

    out_dir = video_path.parent
    grid_slices = _grid_slices(width, height)
    outputs = {
        f"{item['role']}.mp4": grid_slices[item["grid"]]
        for item in resolve_video_stream_entities(video_stream_config)
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

    writers: dict[str, tuple[av.container.OutputContainer, av.VideoStream]] = {}

    sample_interval = 1.0 / output_fps
    next_output_time = 0.0
    frame_index = 0
    written_count = 0

    try:
        for name, (rows, cols) in outputs.items():
            # inner_rows, inner_cols = inner_slices[name]
            # out_h = inner_rows.stop - inner_rows.start
            # out_w = inner_cols.stop - inner_cols.start
            out_h = _safe_h264_size(rows.stop - rows.start)
            out_w = _safe_h264_size(cols.stop - cols.start)
            out_path = out_dir / name
            writers[name] = _open_h264_writer(out_path, output_fps, out_w, out_h)

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
                    out_h = writers[name][1].height
                    out_w = writers[name][1].width
                    crop = crop[:out_h, :out_w]
                    _write_h264_frame(writers[name], crop)

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
            _close_h264_writer(writer)


def split_cameras_video(
    video_path: Path,
    target_fps: float = 10.0,
    video_stream_config: dict[str, list[dict[str, str]]] | None = None,
) -> bool:
    return split_stitched_video_by_config(
        video_path,
        target_fps=target_fps,
        video_stream_config=video_stream_config,
    )


def find_cameras_videos(root: Path) -> list[Path]:
    """Find files named cameras.mp4 under BAG_STORAGE/**/video/."""
    return sorted(root.glob("**/video/cameras.mp4"))


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Split tiled cameras.mp4 into configured camera videos.")
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
        "--video-stream-config",
        type=Path,
        default=None,
        help="JSON file with selected 2x2 video grid to camera role mapping.",
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

    video_stream_config = load_video_stream_config(args.video_stream_config)
    print(f"[INFO] Found {len(videos)} cameras.mp4 files")
    success_count = 0
    fail_count = 0
    for video_path in videos:
        if split_cameras_video(
            video_path,
            target_fps=args.target_fps,
            video_stream_config=video_stream_config,
        ):
            success_count += 1
        else:
            fail_count += 1
            if args.strict:
                raise RuntimeError(f"Failed to split video: {video_path}")

    print(f"[DONE] Success {success_count}/{len(videos)}, skipped={fail_count}")


if __name__ == "__main__":
    main()
