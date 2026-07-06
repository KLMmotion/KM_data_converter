from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import sys
import tempfile
from typing import Any

import numpy as np
import rerun as rr
from lerobot.datasets.lerobot_dataset import LeRobotDataset  # type: ignore[import-untyped,import-not-found]

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOCAL_RERUN_EXPORT = PROJECT_ROOT / "examples" / "python" / "rerun_export"
if LOCAL_RERUN_EXPORT.exists():
    sys.path.insert(0, str(LOCAL_RERUN_EXPORT))

EndEffectorMode = str


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert multiple video2rrd files into one LeRobot dataset (one RRD = one episode)."
    )
    parser.add_argument(
        "input_dir_path",
        nargs="?",
        type=Path,
        default=Path(r"C:\Users\willi\Desktop\0326data"),
        help="Optional positional input directory. Equivalent to --input-dir.",
    )
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=None,
        help="Directory containing video2rrd-*.rrd files.",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=None,
        help=(
            "Output root path for LeRobot dataset. If omitted, derives from input path's datasets folder."
        ),
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
            "Optional fixed task description to write for all frames. "
            "If omitted, task text is read from /language_instruction in the RRD."
        ),
    )
    return parser.parse_args(argv)


def _resolve_input_dir(args: argparse.Namespace) -> Path:
    if args.input_dir is not None and args.input_dir_path is not None:
        raise ValueError("Use either positional input directory or --input-dir, not both.")

    if args.input_dir is not None:
        return _normalize_input_dir(args.input_dir)

    if args.input_dir_path is not None:
        return _normalize_input_dir(args.input_dir_path)

    return Path("datasets") / "video2rrd"


def _normalize_input_dir(base: Path) -> Path:
    normalized_parts = [part.lower() for part in base.parts]

    if normalized_parts and normalized_parts[-1] == "video2rrd":
        return base

    if normalized_parts and normalized_parts[-1] == "datasets":
        return base / "video2rrd"

    return base / "datasets" / "video2rrd"


def _infer_datasets_root_from_input(input_dir: Path) -> Path:
    if input_dir.parent.name.lower() == "datasets":
        return input_dir.parent

    if input_dir.name.lower() == "datasets":
        return input_dir

    return input_dir / "datasets"


def _normalize_output_root(base: Path) -> Path:
    normalized_parts = [part.lower() for part in base.parts]

    if normalized_parts and normalized_parts[-1] == "lerobot_datasets":
        return base

    if normalized_parts and normalized_parts[-1] == "lerobot_output":
        return base / "lerobot_datasets"

    if len(normalized_parts) >= 2 and normalized_parts[-2:] == ["lerobot_output", "lerobot_datasets"]:
        return base

    return base / "datasets" / "lerobot_output" / "lerobot_datasets"


def _resolve_output_root(args: argparse.Namespace, input_dir: Path) -> Path:
    if args.output_root is not None:
        return _normalize_output_root(args.output_root)

    datasets_root = _infer_datasets_root_from_input(input_dir)
    return datasets_root / "lerobot_output" / "lerobot_datasets"


def _list_rrd_files(input_dir: Path) -> list[Path]:
    if not input_dir.exists():
        raise FileNotFoundError(f"Input directory does not exist: {input_dir}")
    rrd_files = sorted(input_dir.glob("video2rrd-*.rrd"))
    if not rrd_files:
        raise ValueError(f"No video2rrd-*.rrd files found under: {input_dir}")
    return rrd_files


def build_training_data(
    dataset: Any,
    segment_id: Any,
    end_effector: EndEffectorMode,
    include_language_instruction: bool,
) -> Any:
    state_paths = [
        "/info/eef_left",
        "/info/eef_right",
    ]
    if end_effector == "hand":
        state_paths.extend(
            [
                "/hand_left/joint_states/effort",
                "/hand_left/joint_states/position",
                "/hand_right/joint_states/effort",
                "/hand_right/joint_states/position",
            ]
        )
    else:
        state_paths.extend([
            "/info/gripper_feedback_L",
            "/info/gripper_feedback_R",
        ])

    contents = [
        "/joint_states/effort",
        "/joint_states/position",
        "/joint_states/velocity",
        *state_paths,
        "/video_stream/**",
    ]
    if include_language_instruction:
        contents.append("/language_instruction")

    return (
        dataset.filter_segments(segment_id)
        .filter_contents(contents)
        .reader(index="message_log_time")
    )


def _flatten_numeric(value: Any) -> list[float]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        out: list[float] = []
        for item in value:
            out.extend(_flatten_numeric(item))
        return out
    try:
        return [float(value)]
    except (TypeError, ValueError):
        return []


def _infer_column_vector_dim(table: Any, column: str) -> int:
    values = table[column].to_pylist()
    for value in values:
        flat = _flatten_numeric(value)
        if flat:
            return len(flat)
    return 0


def _first_non_null_value(table: Any, column: str) -> Any:
    for value in table[column].to_pylist():
        if value is not None:
            return value
    return None


def _pick_first_existing(table: Any, candidates: list[str], label: str) -> str:
    for candidate in candidates:
        if candidate in table.column_names:
            return candidate
    raise ValueError(
        f"No usable column found for {label}. Tried: {candidates}. "
        f"Available columns: {table.column_names}"
    )


def _pick_pose_columns_or_scalar(table: Any, path: str) -> list[str]:
    pose_columns = [
        f"{path}:InstancePoses3D:translations",
        f"{path}:InstancePoses3D:quaternions",
    ]
    if all(column in table.column_names for column in pose_columns):
        return pose_columns
    return [_pick_first_existing(table, [f"{path}:Scalars:scalars"], path)]


def _build_state_columns(table: Any, end_effector: EndEffectorMode) -> list[str]:
    if end_effector == "hand":
        return [
            *_pick_pose_columns_or_scalar(table, "/info/eef_left"),
            *_pick_pose_columns_or_scalar(table, "/info/eef_right"),
            _pick_first_existing(table, ["/hand_left/joint_states/effort:Scalars:scalars"], "hand_left_effort"),
            _pick_first_existing(table, ["/hand_left/joint_states/position:Scalars:scalars"], "hand_left_position"),
            _pick_first_existing(table, ["/hand_right/joint_states/effort:Scalars:scalars"], "hand_right_effort"),
            _pick_first_existing(table, ["/hand_right/joint_states/position:Scalars:scalars"], "hand_right_position"),
        ]

    return [
        *_pick_pose_columns_or_scalar(table, "/info/eef_left"),
        *_pick_pose_columns_or_scalar(table, "/info/eef_right"),
        _pick_first_existing(table, ["/info/gripper_feedback_L:Scalars:scalars"], "gripper_feedback_L"),
        _pick_first_existing(table, ["/info/gripper_feedback_R:Scalars:scalars"], "gripper_feedback_R"),
    ]


def validate_and_build_state_columns(table: Any, end_effector: EndEffectorMode) -> list[str]:
    state_columns = _build_state_columns(table, end_effector=end_effector)

    if end_effector == "hand":
        expected_state_dims = {
            "/info/eef_left": 7,
            "/info/eef_right": 7,
            "/hand_left/joint_states/effort": 20,
            "/hand_left/joint_states/position": 20,
            "/hand_right/joint_states/effort": 20,
            "/hand_right/joint_states/position": 20,
        }
    else:
        expected_state_dims = {
            "/info/eef_left": 7,
            "/info/eef_right": 7,
            "/info/gripper_feedback_L": 6,
            "/info/gripper_feedback_R": 6,
        }

    observed_dims = {
        "/info/eef_left": sum(_infer_column_vector_dim(table, c) for c in state_columns if c.startswith("/info/eef_left:")),
        "/info/eef_right": sum(_infer_column_vector_dim(table, c) for c in state_columns if c.startswith("/info/eef_right:")),
        "/info/gripper_feedback_L": sum(
            _infer_column_vector_dim(table, c) for c in state_columns if c.startswith("/info/gripper_feedback_L:")
        ),
        "/info/gripper_feedback_R": sum(
            _infer_column_vector_dim(table, c) for c in state_columns if c.startswith("/info/gripper_feedback_R:")
        ),
        "/hand_left/joint_states/effort": sum(
            _infer_column_vector_dim(table, c) for c in state_columns if c.startswith("/hand_left/joint_states/effort:")
        ),
        "/hand_left/joint_states/position": sum(
            _infer_column_vector_dim(table, c) for c in state_columns if c.startswith("/hand_left/joint_states/position:")
        ),
        "/hand_right/joint_states/effort": sum(
            _infer_column_vector_dim(table, c) for c in state_columns if c.startswith("/hand_right/joint_states/effort:")
        ),
        "/hand_right/joint_states/position": sum(
            _infer_column_vector_dim(table, c) for c in state_columns if c.startswith("/hand_right/joint_states/position:")
        ),
    }

    bad_dims = [path for path, expected_dim in expected_state_dims.items() if observed_dims.get(path, 0) != expected_dim]
    if bad_dims:
        debug_samples = {
            column: _first_non_null_value(table, column)
            for column in state_columns
            if any(column.startswith(f"{path}:") for path in bad_dims)
        }
        raise ValueError(
            "State dimensions do not match expected robot schema for selected end-effector mode. "
            f"Mismatched paths: {bad_dims}. Observed dims: {observed_dims}. "
            f"Sample non-null values: {debug_samples}"
        )

    return state_columns


def infer_fps_from_rrd(dataset: Any, segment_id: Any) -> int:
    segment_data = dataset.filter_segments(segment_id).filter_contents(["/video_stream/left_eye/current_frame"]).reader(
        index="message_log_time"
    )
    arrow_table = segment_data.to_arrow_table()
    timestamp_col = arrow_table["message_log_time"].to_numpy()
    if len(timestamp_col) < 2:
        raise ValueError("Not enough video timestamps to infer FPS.")

    ns = timestamp_col.astype("datetime64[ns]").astype("int64")
    diffs = ns[1:] - ns[:-1]
    diffs = diffs[diffs > 0]
    if len(diffs) == 0:
        raise ValueError("Invalid video timestamps for FPS inference.")

    median_dt_ns = int(np.median(diffs))
    fps = 1e9 / float(median_dt_ns)
    return int(round(fps))


def convert_rrds_to_lerobot(
    input_dir: Path,
    output_root: Path,
    repo_id: str,
    end_effector: EndEffectorMode,
    task_description: str | None = None,
) -> int:
    from rerun_export.lerobot.converter import convert_dataframe_to_episode  # type: ignore[import-not-found]
    from rerun_export.lerobot.feature_inference import infer_features  # type: ignore[import-not-found]
    from rerun_export.lerobot.types import LeRobotConversionConfig, VideoSpec  # type: ignore[import-not-found]

    rrd_files = _list_rrd_files(input_dir)

    instructions = "/language_instruction:TextDocument:text"
    use_manual_task_description = task_description is not None
    task_column = "" if use_manual_task_description else instructions
    task_default = task_description if use_manual_task_description else "task"
    videos = [
        VideoSpec(key="left_eye", path="/video_stream/left_eye/current_frame", video_format="h264"),
        VideoSpec(key="right_eye", path="/video_stream/right_eye/current_frame", video_format="h264"),
        VideoSpec(key="left_wrist", path="/video_stream/left_wrist/current_frame", video_format="h264"),
        VideoSpec(key="right_wrist", path="/video_stream/right_wrist/current_frame", video_format="h264"),
    ]

    config: Any = None
    features = None
    lerobot_dataset = None
    episode_index = 0

    for rrd_file in rrd_files:
        with tempfile.TemporaryDirectory(prefix="video2rrd_single_") as tmp_dir:
            tmp_dataset_dir = Path(tmp_dir)
            tmp_rrd = tmp_dataset_dir / rrd_file.name

            try:
                os.link(rrd_file, tmp_rrd)
            except OSError:
                shutil.copy2(rrd_file, tmp_rrd)

            server = rr.server.Server(datasets={"robot_dataset": tmp_dataset_dir})
            client = server.client()
            dataset = client.get_dataset(name="robot_dataset")
            segment_ids = dataset.segment_ids()
            if not segment_ids:
                print(f"Skipping {rrd_file.name}: no segments found")
                continue

            raw_segment_id = segment_ids[-1]
            segment_data = build_training_data(
                dataset,
                raw_segment_id,
                end_effector=end_effector,
                include_language_instruction=not use_manual_task_description,
            )

            if config is None:
                auto_fps = infer_fps_from_rrd(dataset, raw_segment_id)
                test_arrow = segment_data.to_arrow_table()
                state_columns = validate_and_build_state_columns(test_arrow, end_effector=end_effector)

                config = LeRobotConversionConfig(
                    fps=auto_fps,
                    index_column="message_log_time",
                    action=(
                        "/joint_states/effort:Scalars:scalars,"
                        "/joint_states/position:Scalars:scalars,"
                        "/joint_states/velocity:Scalars:scalars"
                    ),
                    state=",".join(state_columns),
                    task=task_column,
                    videos=videos,
                    task_default=task_default,
                )

                features = infer_features(table=test_arrow, config=config)
                lerobot_dataset = LeRobotDataset.create(
                    repo_id=repo_id,
                    fps=config.fps,
                    features=features,
                    root=output_root,
                    use_videos=config.use_videos,
                )
                lerobot_dataset.meta.update_chunk_settings(
                    data_files_size_in_mb=1,
                    # Keep video chunks tiny so each episode is written to its own mp4 file.
                    video_files_size_in_mb=0.001,
                )

            if config is None or features is None or lerobot_dataset is None:
                raise RuntimeError("Failed to initialize LeRobot conversion config/dataset.")

            print(f"Exporting episode {episode_index} from {rrd_file.name} segment {raw_segment_id}")
            convert_dataframe_to_episode(
                df=segment_data,
                config=config,
                lerobot_dataset=lerobot_dataset,
                segment_id=episode_index,
                features=features,
            )
            episode_index += 1

    if lerobot_dataset is None:
        raise RuntimeError("No valid segments found in input RRD files.")

    lerobot_dataset.finalize()
    return episode_index


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)
    input_dir = _resolve_input_dir(args)
    output_root = _resolve_output_root(args, input_dir)

    episode_count = convert_rrds_to_lerobot(
        input_dir=input_dir,
        output_root=output_root,
        repo_id=args.repo_id,
        end_effector=args.end_effector,
        task_description=args.task_description,
    )
    print(f"Finalized dataset with {episode_count} episodes at: {output_root}")


if __name__ == "__main__":
    main()
