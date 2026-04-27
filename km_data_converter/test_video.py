from __future__ import annotations

from pathlib import Path
import argparse
import math

import cv2


def inspect_video_opencv(path: Path) -> tuple[float, int, float]:
	cap = cv2.VideoCapture(str(path))
	if not cap.isOpened():
		raise RuntimeError(f"Cannot open video: {path}")

	fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
	frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
	cap.release()

	duration = 0.0
	if fps > 0 and frame_count > 0:
		duration = frame_count / fps
	return fps, frame_count, duration


def inspect_videos_in_dir(dir_path: Path, extensions=None, decode_fallback: bool = True) -> None:
	if extensions is None:
		extensions = [".mp4", ".mkv", ".avi", ".mov", ".webm"]

	files = sorted([p for p in dir_path.iterdir() if p.suffix.lower() in extensions and p.is_file()])
	if not files:
		print(f"No video files found under: {dir_path}")
		return

	for path in files:
		try:
			fps, frames, duration = inspect_video_opencv(path)

			# If OpenCV failed to provide sensible values, optionally try a decode fallback
			if (fps <= 0 or frames <= 0) and decode_fallback:
				try:
					import av

					with av.open(str(path)) as container:
						streams = [s for s in container.streams if s.type == "video"]
						if streams:
							vs = streams[0]
							if vs.average_rate is not None:
								fps = float(vs.average_rate)
							if getattr(vs, "frames", None):
								frames = int(vs.frames)

						# duration in seconds: container.duration is in ns for newer pyav, else fallback
						dur = None
						if getattr(container, "duration", None) is not None:
							# container.duration may be in seconds*1e9
							try:
								dur = float(container.duration) / 1e9
							except Exception:
								dur = None

						if dur is None and fps > 0 and frames > 0:
							dur = frames / fps

						if dur is not None:
							duration = dur
						else:
							# last resort: decode to count frames (could be slow)
							count = 0
							for _ in container.decode(video=0):
								count += 1
							frames = count
							duration = frames / fps if fps > 0 else 0.0

				except Exception:
					# keep whatever we have
					pass

			# Nicely format
			duration_str = f"{duration:.3f}s" if duration and not math.isinf(duration) else "unknown"
			fps_str = f"{fps:.3f}" if fps and fps > 0 else "unknown"
			print(f"{path.name}: fps={fps_str}, frames={frames}, duration={duration_str}")

		except Exception as e:
			print(f"[ERROR] {path.name}: {e}")


def _parse_args(argv=None):
	parser = argparse.ArgumentParser(description="Inspect videos in a directory and report fps, frames and duration.")
	parser.add_argument("dir", type=Path, help="Directory containing video files.")
	parser.add_argument("--no-fallback", dest="decode_fallback", action="store_false", help="Disable PyAV fallback/decode when OpenCV returns invalid values.")
	return parser.parse_args(argv)


def main(argv=None):
	args = _parse_args(argv)
	inspect_videos_in_dir(args.dir, decode_fallback=args.decode_fallback)


if __name__ == "__main__":
	main()
