from __future__ import annotations

from pathlib import Path
import fractions

import av
import numpy as np


def pick_video_path(video_dir: Path) -> list[Path]:
    left_eye = video_dir / "left_eye.mp4"
    right_eye = video_dir / "right_eye.mp4"
    left_wrist = video_dir / "left_wrist.mp4"
    right_wrist = video_dir / "right_wrist.mp4"
    for path in [left_eye, right_eye, left_wrist, right_wrist]:
        if not path.is_file():
            raise FileNotFoundError(f"Expected video file not found: {path}")
    return [left_eye, right_eye, left_wrist, right_wrist]


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

        codec.framerate = fps
        codec.time_base = fractions.Fraction(1, int(fps))
        codec.options = {
            "preset": "veryfast",
            "tune": "zerolatency",
            "bf": "0",
            "g": "30",
        }
        codec.open()

        # encode_index = 0

        for frame in container.decode(video=0):
            if frame.format.name != "yuv420p":
                frame = frame.reformat(format="yuv420p")

            # frame.pts = encode_index
            t_ns = frame.pts * frame.time_base * 1e9 + 1e8
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
