from __future__ import annotations

from pathlib import Path
from typing import Any
import json
import fractions

import av
import numpy as np

KEYFRAME_INTERVAL_SECONDS = 1.5
VALID_VIDEO_GRIDS = ("top_left", "top_right", "bottom_left", "bottom_right")
VALID_VIDEO_ROLES = ("left_eye", "right_eye", "left_wrist", "right_wrist")
DEFAULT_VIDEO_STREAMS = [
    {"grid": "top_left", "role": "left_eye"},
    {"grid": "top_right", "role": "left_wrist"},
    {"grid": "bottom_left", "role": "right_wrist"},
    {"grid": "bottom_right", "role": "right_eye"},
]


def get_default_video_stream_config() -> dict[str, list[dict[str, str]]]:
    return {"video_streams": [dict(item) for item in DEFAULT_VIDEO_STREAMS]}


def validate_video_stream_config(config: Any) -> dict[str, list[dict[str, str]]]:
    if not isinstance(config, dict):
        raise ValueError("Video stream config must be a JSON object.")

    streams = config.get("video_streams")
    if not isinstance(streams, list):
        raise ValueError("Video stream config field 'video_streams' must be a list.")
    if not streams:
        raise ValueError("Video stream config must select at least 1 video stream.")

    seen_grids: set[str] = set()
    seen_roles: set[str] = set()
    normalized: list[dict[str, str]] = []

    for index, item in enumerate(streams):
        if not isinstance(item, dict):
            raise ValueError(f"Video stream entry at index {index} must be an object.")

        grid = item.get("grid")
        role = item.get("role")
        if not isinstance(grid, str) or not grid:
            raise ValueError(f"Video stream entry at index {index} has invalid grid: {grid!r}")
        if not isinstance(role, str) or not role:
            raise ValueError(f"Video stream entry at index {index} has invalid role: {role!r}")

        if grid not in VALID_VIDEO_GRIDS:
            raise ValueError(f"Invalid video grid '{grid}'. Supported grids: {list(VALID_VIDEO_GRIDS)}")
        if role not in VALID_VIDEO_ROLES:
            raise ValueError(f"Invalid video role '{role}'. Supported roles: {list(VALID_VIDEO_ROLES)}")
        if grid in seen_grids:
            raise ValueError(f"Duplicate video grid '{grid}' in video stream config.")
        if role in seen_roles:
            raise ValueError(f"Duplicate video role '{role}' in video stream config.")

        seen_grids.add(grid)
        seen_roles.add(role)
        normalized.append({"grid": grid, "role": role})

    return {"video_streams": normalized}


def load_video_stream_config(config_path: Path | None = None) -> dict[str, list[dict[str, str]]]:
    if config_path is None:
        return get_default_video_stream_config()

    with config_path.open("r", encoding="utf-8") as file:
        loaded = json.load(file)
    return validate_video_stream_config(loaded)


def resolve_video_stream_entities(
    video_stream_config: dict[str, list[dict[str, str]]] | None = None,
) -> list[dict[str, str]]:
    config = validate_video_stream_config(
        get_default_video_stream_config() if video_stream_config is None else video_stream_config
    )
    return [dict(item) for item in config["video_streams"]]


def pick_video_path(
    video_dir: Path,
    video_stream_config: dict[str, list[dict[str, str]]] | None = None,
) -> list[Path]:
    paths = [video_dir / f"{item['role']}.mp4" for item in resolve_video_stream_entities(video_stream_config)]
    for path in paths:
        if not path.is_file():
            raise FileNotFoundError(f"Expected video file not found: {path}")
    return paths


def get_video_stream_samples(video_path: Path) -> tuple[str, list[bytes], np.ndarray]:
    video_samples: list[bytes] = []
    sample_times_ns: list[int] = []

    with av.open(str(video_path), mode="r") as container:
        if not container.streams.video:
            raise ValueError(f"No video stream found in file: {video_path}")

        video_stream = container.streams.video[0]

        codec = av.CodecContext.create("libx264", "w")
        codec.width = video_stream.width
        codec.height = video_stream.height
        codec.pix_fmt = "yuv420p"

        if video_stream.average_rate is not None:
            fps = video_stream.average_rate
        else:
            fps = fractions.Fraction(30, 1)

        keyframe_interval = max(1, int(round(float(fps) * KEYFRAME_INTERVAL_SECONDS)))
        codec.framerate = fps
        codec.time_base = fractions.Fraction(1, int(fps))
        codec.gop_size = keyframe_interval
        codec.max_b_frames = 0
        codec.options = {
            "preset": "veryfast",
            "tune": "zerolatency",
            "bf": "0",
            "g": str(keyframe_interval),
            "keyint_min": str(keyframe_interval),
            "sc_threshold": "0",
            "x264-params": f"keyint={keyframe_interval}:min-keyint={keyframe_interval}:scenecut=0",
        }
        codec.open()

        # encode_index = 0

        for frame in container.decode(video=0):
            if frame.format.name != "yuv420p":
                frame = frame.reformat(format="yuv420p")

            # frame.pts = encode_index
            t_ns = frame.pts * frame.time_base * 1e9
            frame.time_base = codec.time_base
            # encode_index += 1

            for packet in codec.encode(frame):
                packet_bytes = bytes(packet)
                if not packet_bytes:
                    continue

                video_samples.append(packet_bytes)

                # if packet.pts is not None and packet.time_base is not None:
                #     ts_ns = int(
                #         packet.pts
                #         * packet.time_base.numerator
                #         * 1_000_000_000
                #         // packet.time_base.denominator
                #     )
                # else:
                #     ts_ns = len(sample_times_ns) * int(1_000_000_000 / float(fps))

            sample_times_ns.append(t_ns)

        # for packet in codec.encode(None):
        #     packet_bytes = bytes(packet)
        #     if not packet_bytes:
        #         continue

        #     video_samples.append(packet_bytes)

        #     if packet.pts is not None and packet.time_base is not None:
        #         ts_ns = int(
        #             packet.pts
        #             * packet.time_base.numerator
        #             * 1_000_000_000
        #             // packet.time_base.denominator
        #         )
        #     else:
        #         ts_ns = len(sample_times_ns) * int(1_000_000_000 / float(fps))

        #     sample_times_ns.append(ts_ns)

        return "h264", video_samples, np.array(sample_times_ns, dtype=np.int64)
