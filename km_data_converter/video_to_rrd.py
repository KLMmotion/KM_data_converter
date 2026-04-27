from __future__ import annotations

import argparse
from pathlib import Path
import re

import numpy as np
import pandas as pd
import rerun as rr
import yaml

from .video_stream import get_video_stream_samples, pick_video_path

EndEffectorMode = str

CONTROL_JOINT_CMD_PATHS = {
    "/control/joint_cmd_A",
    "/control/joint_cmd_B",
}


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Align sensor data with video for each BAG_STORAGE/my_bag-* and export per-episode RRDs."
    )
    parser.add_argument(
        "bag_storage_path",
        nargs="?",
        type=Path,
        # default=Path(r"C:\Users\willi\Desktop\0327data"),
        help="Optional positional BAG_STORAGE path. Equivalent to --bag-storage.",
    )
    parser.add_argument(
        "--bag-storage",
        type=Path,
        default=None,
        help="Directory containing many my_bag-* folders.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help=(
            "Output directory for per-episode video-enriched RRD files. "
            "If omitted, defaults to <bag_storage>/datasets/video2rrd. "
            "If provided as a root path, datasets/video2rrd is appended automatically."
        ),
    )
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        default=None,
        help=(
            "Directory for mcap2rrd source dataset. If omitted, tries "
            "<bag_storage>/datasets/mcap2rrd first, then ./datasets/mcap2rrd. "
            "If provided as a root path, datasets/mcap2rrd is appended automatically."
        ),
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Fail on first missing/bad bag. Default behavior skips bad bags.",
    )
    parser.add_argument(
        "--end-effector",
        choices=["gripper", "hand"],
        default="gripper",
        help="Select robot end-effector state source: gripper (default) or hand.",
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


def _normalize_dataset_dir(base: Path) -> Path:
    normalized_parts = [part.lower() for part in base.parts]

    if len(normalized_parts) >= 2 and normalized_parts[-2:] == ["datasets", "mcap2rrd"]:
        return base
    if normalized_parts and normalized_parts[-1] == "mcap2rrd":
        return base

    return base / "datasets" / "mcap2rrd"


def _normalize_output_dir(base: Path) -> Path:
    normalized_parts = [part.lower() for part in base.parts]

    if len(normalized_parts) >= 2 and normalized_parts[-2:] == ["datasets", "video2rrd"]:
        return base
    if normalized_parts and normalized_parts[-1] == "video2rrd":
        return base

    return base / "datasets" / "video2rrd"


def _resolve_dataset_dir(args: argparse.Namespace, bag_storage: Path) -> Path:
    if args.dataset_dir is not None:
        return _normalize_dataset_dir(args.dataset_dir)

    return bag_storage / "datasets" / "mcap2rrd"


def _resolve_output_dir(args: argparse.Namespace, bag_storage: Path) -> Path:
    if args.output_dir is not None:
        return _normalize_output_dir(args.output_dir)

    return bag_storage / "datasets" / "video2rrd"


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


def _read_first_frame_epoch_ns(camera_yaml_path: Path) -> int:
    with camera_yaml_path.open("r", encoding="utf-8") as file:
        camera_first_frame = yaml.safe_load(file) or {}

    first_frame_time = camera_first_frame.get("first_frame_time", {})
    first_frame_epoch_ns = first_frame_time.get("epoch_ns")
    if first_frame_epoch_ns is None:
        raise ValueError("first_frame_time.epoch_ns is missing in video/cameras_first_frame.yaml")
    return int(first_frame_epoch_ns)


def _pick_data_columns(columns: list[str], path: str, end_effector: EndEffectorMode) -> list[str]:
    preferences: dict[str, list[str]] = {
        "/joint_states/effort": ["/joint_states/effort:Scalars:scalars"],
        "/joint_states/position": ["/joint_states/position:Scalars:scalars"],
        "/joint_states/velocity": ["/joint_states/velocity:Scalars:scalars"],
        "/control/joint_cmd_A": [
            "/control/joint_cmd_A:marvin_msgs.msg.Jointcmd:message",
            "/control/joint_cmd_A:Scalars:scalars",
        ],
        "/control/joint_cmd_B": [
            "/control/joint_cmd_B:marvin_msgs.msg.Jointcmd:message",
            "/control/joint_cmd_B:Scalars:scalars",
        ],
        "/info/eef_left": [
            "/info/eef_left:InstancePoses3D:translations",
            "/info/eef_left:InstancePoses3D:quaternions",
            "/info/eef_left:Scalars:scalars",
        ],
        "/info/eef_right": [
            "/info/eef_right:InstancePoses3D:translations",
            "/info/eef_right:InstancePoses3D:quaternions",
            "/info/eef_right:Scalars:scalars",
        ],   
        "/info/gripper_feedback_L": [
            "/info/gripper_feedback_L:std_msgs.msg.Float32MultiArray:message",
            "/info/gripper_feedback_L:Scalars:scalars",
        ],
        "/info/gripper_feedback_R": [
            "/info/gripper_feedback_R:std_msgs.msg.Float32MultiArray:message",
            "/info/gripper_feedback_R:Scalars:scalars",
        ],
        "/hand_left/joint_states/effort": ["/hand_left/joint_states/effort:Scalars:scalars"],
        "/hand_left/joint_states/position": ["/hand_left/joint_states/position:Scalars:scalars"],
        "/hand_right/joint_states/effort": ["/hand_right/joint_states/effort:Scalars:scalars"],
        "/hand_right/joint_states/position": ["/hand_right/joint_states/position:Scalars:scalars"],
    }

    chosen = [name for name in preferences.get(path, []) if name in columns]
    if chosen:
        if path.startswith("/info/eef_") and len(chosen) >= 2:
            return chosen[:2]
        return [chosen[0]]

    prefixed = [name for name in columns if name.startswith(f"{path}:") and "Mcap" not in name]
    if prefixed:
        return [prefixed[0]]

    raise KeyError(
        f"Cannot find data column under '{path}' for end-effector mode '{end_effector}'. "
        f"Available columns: {columns}"
    )


def _list_dynamic_component_columns(dataset, path: str) -> list[str]:
    component_columns: list[str] = []
    for descriptor in dataset.filter_contents([path]).schema().component_columns():
        column_name = str(descriptor.name)
        if not column_name.startswith(f"{path}:"):
            continue
        if ":Mcap" in column_name:
            continue
        component_columns.append(column_name)
    return component_columns


def _state_source_paths(end_effector: EndEffectorMode) -> list[str]:
    base = [
        "/joint_states/effort",
        "/joint_states/position",
        "/joint_states/velocity",
        "/control/joint_cmd_A",
        "/control/joint_cmd_B",
        "/info/eef_left",
        "/info/eef_right",
    ]

    if end_effector == "hand":
        return [
            *base,
            "/hand_left/joint_states/effort",
            "/hand_left/joint_states/position",
            "/hand_right/joint_states/effort",
            "/hand_right/joint_states/position",
        ]

    return [
        *base,
        "/info/gripper_feedback_L",
        "/info/gripper_feedback_R",
    ]


def _target_dims(end_effector: EndEffectorMode) -> dict[str, int]:
    control_dims = {
        "/control/joint_cmd_A": 7,
        "/control/joint_cmd_B": 7,
    }

    if end_effector == "hand":
        return {
            **control_dims,
            "/info/eef_left": 7,
            "/info/eef_right": 7,
            "/hand_left/joint_states/effort": 20,
            "/hand_left/joint_states/position": 20,
            "/hand_right/joint_states/effort": 20,
            "/hand_right/joint_states/position": 20,
        }

    return {
        **control_dims,
        "/info/eef_left": 7,
        "/info/eef_right": 7,
        "/info/gripper_feedback_L": 6,
        "/info/gripper_feedback_R": 6,
    }


def _flatten_numeric_values(value) -> list[float]:
    if value is None:
        return []

    if isinstance(value, dict):
        if "data" in value:
            return _flatten_numeric_values(value["data"])
        result: list[float] = []
        for dict_value in value.values():
            result.extend(_flatten_numeric_values(dict_value))
        return result

    if isinstance(value, np.ndarray):
        if value.dtype == object:
            result: list[float] = []
            for item in value.tolist():
                result.extend(_flatten_numeric_values(item))
            return result
        return value.astype(np.float32, copy=False).reshape(-1).tolist()

    if isinstance(value, (list, tuple)):
        result: list[float] = []
        for item in value:
            result.extend(_flatten_numeric_values(item))
        return result

    if isinstance(value, str):
        number_tokens = re.findall(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?", value)
        return [float(token) for token in number_tokens]

    try:
        return [float(value)]
    except (TypeError, ValueError):
        return []


def _extract_joint_cmd_positions(value) -> list[float]:
    if value is None:
        return []

    if isinstance(value, dict):
        if "positions" in value:
            return _flatten_numeric_values(value["positions"])
        if "data" in value:
            positions = _extract_joint_cmd_positions(value["data"])
            if positions:
                return positions
        for dict_value in value.values():
            positions = _extract_joint_cmd_positions(dict_value)
            if positions:
                return positions
        return []

    if isinstance(value, np.ndarray):
        if value.dtype == object:
            for item in value.tolist():
                positions = _extract_joint_cmd_positions(item)
                if positions:
                    return positions
            return []
        return _flatten_numeric_values(value)

    if isinstance(value, (list, tuple)):
        if value and all(not isinstance(item, (dict, list, tuple, np.ndarray, str)) for item in value):
            return _flatten_numeric_values(value)
        for item in value:
            positions = _extract_joint_cmd_positions(item)
            if positions:
                return positions
        return []

    if isinstance(value, str):
        positions_match = re.search(r"positions['\"]?\s*[:=]\s*\[([^\]]*)\]", value)
        if positions_match:
            return _flatten_numeric_values(positions_match.group(1))
        return _flatten_numeric_values(value)

    return []


def _extract_numeric_values_for_path(path: str, value) -> list[float]:
    if path in CONTROL_JOINT_CMD_PATHS:
        positions = _extract_joint_cmd_positions(value)
        if positions:
            return positions
        return []

    return _flatten_numeric_values(value)


def _infer_vector_size_from_columns(df, column_names: list[str], path: str) -> int:
    max_size = 0
    for row_values in zip(*(df[column_name] for column_name in column_names), strict=False):
        flat_values: list[float] = []
        for value in row_values:
            flat_values.extend(_extract_numeric_values_for_path(path, value))
        max_size = max(max_size, len(flat_values))

    if path in CONTROL_JOINT_CMD_PATHS and max_size == 0:
        raise ValueError(f"Could not parse positions from control joint command topic '{path}'.")

    return max(1, max_size)


def _fill_missing_vectors_with_nearest(
    vectors: list[np.ndarray | None],
    vector_size: int,
    path: str,
) -> np.ndarray:
    valid_indices = [index for index, vector in enumerate(vectors) if vector is not None]
    if not valid_indices:
        raise ValueError(f"Could not find any valid values to fill control joint command topic '{path}'.")

    valid_index_array = np.asarray(valid_indices, dtype=np.int64)
    filled_vectors: list[np.ndarray] = []

    for index, vector in enumerate(vectors):
        if vector is not None:
            filled_vectors.append(vector)
            continue

        insertion_index = int(np.searchsorted(valid_index_array, index))
        candidate_indices: list[int] = []

        if insertion_index > 0:
            candidate_indices.append(int(valid_index_array[insertion_index - 1]))
        if insertion_index < len(valid_index_array):
            candidate_indices.append(int(valid_index_array[insertion_index]))

        nearest_index = min(candidate_indices, key=lambda candidate: (abs(candidate - index), candidate))
        nearest_vector = vectors[nearest_index]
        if nearest_vector is None:
            raise ValueError(f"Nearest fill failed for control joint command topic '{path}' at row {index}.")

        filled_vectors.append(nearest_vector.copy())

    return np.stack(filled_vectors, axis=0)


def _build_vectors_from_columns(df, column_names: list[str], vector_size: int, path: str) -> np.ndarray:
    vectors: list[np.ndarray | None] = []
    for row_values in zip(*(df[column_name] for column_name in column_names), strict=False):
        flat_values: list[float] = []
        for value in row_values:
            flat_values.extend(_extract_numeric_values_for_path(path, value))

        arr = np.array(flat_values, dtype=np.float32)
        if arr.size == 0 and path in CONTROL_JOINT_CMD_PATHS:
            vectors.append(None)
            continue

        vec = np.zeros(vector_size, dtype=np.float32)
        if arr.size > 0:
            copy_size = min(arr.size, vector_size)
            vec[:copy_size] = arr[:copy_size]
        vectors.append(vec)

    if path in CONTROL_JOINT_CMD_PATHS:
        return _fill_missing_vectors_with_nearest(vectors, vector_size=vector_size, path=path)

    return np.stack(vectors, axis=0)


def _extract_available_timeline_indexes(dataset) -> list[str]:
    index_names: list[str] = []
    for descriptor in dataset.schema().index_columns():
        if descriptor.is_static:
            continue
        index_names.append(str(descriptor.name))
    return index_names


def _pick_reader_index(available_indexes: list[str]) -> str:
    preferred_order = ["message_log_time", "message_publish_time", "ros2_timestamp"]
    for candidate in preferred_order:
        if candidate in available_indexes:
            return candidate

    if available_indexes:
        return available_indexes[0]

    raise ValueError("No timeline indexes found in dataset schema.")


def _read_with_index_fallback(dataset, source_paths: list[str], video_sample_timestamps):
    filtered_dataset = dataset.filter_contents(source_paths)
    available_indexes = _extract_available_timeline_indexes(filtered_dataset)
    reader_index = _pick_reader_index(available_indexes)
    reader = filtered_dataset.reader(
        index=reader_index,
        using_index_values=video_sample_timestamps,
        fill_latest_at=True,
    )
    return reader, reader_index


def _align_reader_dataframe_rows(
    df: pd.DataFrame,
    expected_timestamps: np.ndarray,
    index_name: str,
) -> pd.DataFrame:
    expected_count = len(expected_timestamps)
    if len(df) == expected_count:
        return df.reset_index(drop=True)

    if index_name in df.columns:
        normalized = df.copy()
        normalized[index_name] = pd.to_datetime(normalized[index_name], errors="coerce")
        normalized = normalized.dropna(subset=[index_name]).sort_values(index_name)

        if len(normalized) > expected_count:
            normalized = normalized.groupby(index_name, as_index=False).last()

        expected_df = pd.DataFrame({index_name: pd.to_datetime(expected_timestamps)})
        aligned = expected_df.merge(normalized, on=index_name, how="left")
        aligned = aligned.ffill().bfill()
        return aligned.reset_index(drop=True)

    if expected_count > 0 and len(df) % expected_count == 0:
        repeat_factor = len(df) // expected_count
        collapsed = df.iloc[::repeat_factor].reset_index(drop=True)
        if len(collapsed) == expected_count:
            return collapsed

    raise ValueError(
        "Reader result row count cannot be aligned to video timestamps: "
        f"rows={len(df)}, expected={expected_count}, index='{index_name}'"
    )


def convert_bag_video_to_rrd(
    bag_dir: Path,
    output_rrd_path: Path,
    dataset_dir: Path,
    end_effector: EndEffectorMode,
) -> Path:
    sample_data_path = dataset_dir / "mcap_to_rrd" / bag_dir.name
    video_dir = bag_dir / "video"
    camera_yaml_path = video_dir / "cameras_first_frame.yaml"

    if not sample_data_path.exists():
        raise FileNotFoundError(f"Missing dataset folder: {sample_data_path}")
    if not video_dir.exists():
        raise FileNotFoundError(f"Missing video folder: {video_dir}")
    if not camera_yaml_path.exists():
        raise FileNotFoundError(f"Missing camera yaml: {camera_yaml_path}")

    first_frame_epoch_ns = _read_first_frame_epoch_ns(camera_yaml_path)
    video_paths = pick_video_path(video_dir)

    camera_names = ["left_eye", "right_eye", "left_wrist", "right_wrist"]
    if len(video_paths) != len(camera_names):
        raise ValueError(f"Expected {len(camera_names)} camera videos, got {len(video_paths)}: {video_paths}")

    camera_streams: dict[str, dict[str, object]] = {}
    for camera_name, video_path in zip(camera_names, video_paths, strict=False):
        video_codec, video_samples, video_sample_ts_ns = get_video_stream_samples(video_path)
        video_sample_stamp_ns = first_frame_epoch_ns + video_sample_ts_ns
        video_sample_timestamps = video_sample_stamp_ns.astype("datetime64[ns]")

        camera_streams[camera_name] = {
            "path": video_path,
            "codec": video_codec,
            "samples": video_samples,
            "timestamps": video_sample_timestamps,
        }

    video_sample_timestamps = np.asarray(camera_streams["left_eye"]["timestamps"])

    for camera_name, stream in camera_streams.items():
        camera_timestamps = np.asarray(stream["timestamps"])
        if len(camera_timestamps) != len(video_sample_timestamps):
            raise ValueError(
                "Length mismatch across camera streams: "
                f"left_eye={len(video_sample_timestamps)} vs {camera_name}={len(camera_timestamps)}"
            )

    server = rr.server.Server(datasets={"data": sample_data_path})
    client = rr.catalog.CatalogClient(server.url())
    dataset = client.get_dataset(name="data")

    source_paths = _state_source_paths(end_effector)
    target_dims = _target_dims(end_effector)

    path_frames: dict[str, pd.DataFrame] = {}
    joint_columns: dict[str, list[str]] = {}
    zero_filled_paths: set[str] = set()

    for path in source_paths:
        available_columns = _list_dynamic_component_columns(dataset, path)
        try:
            selected_columns = _pick_data_columns(available_columns, path, end_effector=end_effector)
        except KeyError:
            if path in CONTROL_JOINT_CMD_PATHS:
                zero_filled_paths.add(path)
                print(
                    f"[WARN] {bag_dir.name}: no dynamic samples for {path}; "
                    f"filling {target_dims[path]} zeros per frame."
                )
                continue
            raise

        path_reader, index_name = _read_with_index_fallback(dataset, [path], video_sample_timestamps)
        path_df = path_reader.select(index_name, *selected_columns).to_arrow_table().to_pandas()
        path_df = _align_reader_dataframe_rows(path_df, video_sample_timestamps, index_name)

        if all(path_df[column_name].isnull().all() for column_name in selected_columns):
            if path in CONTROL_JOINT_CMD_PATHS:
                zero_filled_paths.add(path)
                print(
                    f"[WARN] {bag_dir.name}: aligned samples for {path} are all null; "
                    f"filling {target_dims[path]} zeros per frame."
                )
                continue
            raise ValueError(f"Columns '{selected_columns}' for '{path}' contain only null values.")

        path_frames[path] = path_df
        joint_columns[path] = selected_columns

    timestamps = np.asarray(video_sample_timestamps).astype("datetime64[ns]")

    joint_values_by_path: dict[str, np.ndarray] = {}
    for path, column_names in joint_columns.items():
        path_df = path_frames[path]
        inferred_dim = _infer_vector_size_from_columns(path_df, column_names, path=path)
        export_dim = max(inferred_dim, target_dims.get(path, inferred_dim))
        joint_values_by_path[path] = _build_vectors_from_columns(
            path_df,
            column_names,
            vector_size=export_dim,
            path=path,
        )

    for path in zero_filled_paths:
        joint_values_by_path[path] = np.zeros((len(timestamps), target_dims[path]), dtype=np.float32)

    rec = rr.RecordingStream(application_id="joint_states_all_export")
    time_column = rr.TimeColumn("message_log_time", timestamp=timestamps)

    for camera_name, stream in camera_streams.items():
        stream_samples = stream["samples"]
        stream_codec = stream["codec"]

        rec.send_columns(
            f"/video_stream/{camera_name}/current_frame",
            indexes=[time_column],
            columns=[
                *rr.VideoStream.columns(
                    codec=[stream_codec] * len(stream_samples),
                    sample=stream_samples,
                )
            ],
        )

    for path in source_paths:
        rec.send_columns(
            path,
            indexes=[time_column],
            columns=[*rr.Scalars.columns(scalars=joint_values_by_path[path])],
        )

    output_rrd_path.parent.mkdir(parents=True, exist_ok=True)
    rec.save(str(output_rrd_path))
    return output_rrd_path


def convert_bag_storage_video_to_rrd(
    bag_storage: Path,
    output_dir: Path,
    dataset_dir: Path,
    end_effector: EndEffectorMode,
    strict: bool = False,
) -> tuple[list[Path], int]:
    bag_dirs = _list_bag_dirs(bag_storage)
    output_dir.mkdir(parents=True, exist_ok=True)

    exported_paths: list[Path] = []
    fail_count = 0

    for bag_dir in bag_dirs:
        output_rrd_path = output_dir / f"video2rrd-{_bag_timestamp(bag_dir)}.rrd"
        try:
            exported_paths.append(
                convert_bag_video_to_rrd(
                    bag_dir,
                    output_rrd_path,
                    dataset_dir=dataset_dir,
                    end_effector=end_effector,
                )
            )
        except Exception as exc:
            fail_count += 1
            print(f"[ERROR] {bag_dir.name}: {exc}")
            if strict:
                raise

    if not exported_paths:
        raise RuntimeError("No bag was successfully exported into video2rrd.")

    return exported_paths, fail_count


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)
    bag_storage = _resolve_bag_storage(args)
    dataset_dir = _resolve_dataset_dir(args, bag_storage)
    output_dir = _resolve_output_dir(args, bag_storage)

    exported_paths, fail_count = convert_bag_storage_video_to_rrd(
        bag_storage=bag_storage,
        output_dir=output_dir,
        dataset_dir=dataset_dir,
        end_effector=args.end_effector,
        strict=args.strict,
    )
    print(f"Saved video-enriched RRDs in: {output_dir}")
    print(f"Using source mcap2rrd dataset dir: {dataset_dir}")
    print(f"Episodes exported: {len(exported_paths)}, skipped: {fail_count}")


if __name__ == "__main__":
    main()
