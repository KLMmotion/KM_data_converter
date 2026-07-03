from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from typing import Any

import numpy as np
import pyarrow as pa
import rerun as rr
from lerobot.datasets.lerobot_dataset import LeRobotDataset  # type: ignore[import-untyped,import-not-found]

from .video_stream import VALID_VIDEO_ROLES, load_video_stream_config, resolve_video_stream_entities

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOCAL_RERUN_EXPORT = PROJECT_ROOT / "examples" / "python" / "rerun_export"
if LOCAL_RERUN_EXPORT.exists():
    sys.path.insert(0, str(LOCAL_RERUN_EXPORT))

EndEffectorMode = str
SchemaRole = str

DEFAULT_GRIPPER_ACTION_TOPICS = [
    "/control/joint_cmd_A",
    "/control/joint_cmd_B",
    "eef_left",
    "eef_right",
    "gripper_feedback_L",
    "gripper_feedback_R",
]
DEFAULT_GRIPPER_OBSERVATION_TOPICS = [
    "/joint_states/position_L",
    "/joint_states/position_R",
    "eef_left",
    "eef_right",
    "gripper_feedback_L",
    "gripper_feedback_R",
]
DEFAULT_HAND_ACTION_TOPICS = [
    "/control/joint_cmd_A",
    "/control/joint_cmd_B",
    "eef_left",
    "eef_right",
    "/hand_left/joint_commands/position",
    "/hand_right/joint_commands/position",
]
DEFAULT_HAND_OBSERVATION_TOPICS = [
    "/joint_states/position_L",
    "/joint_states/position_R",
    "eef_left",
    "eef_right",
    "/hand_left/joint_states/position",
    "/hand_right/joint_states/position",
    "/hand_left/joint_states/effort",
    "/hand_right/joint_states/effort",
]
DEFAULT_ACTION_TOPICS = DEFAULT_GRIPPER_ACTION_TOPICS
DEFAULT_OBSERVATION_TOPICS = DEFAULT_GRIPPER_OBSERVATION_TOPICS
FEATURE_DIMS = {
    "/joint_states/effort_L": 7,
    "/joint_states/effort_R": 7,
    "/joint_states/position_L": 7,
    "/joint_states/position_R": 7,
    "/joint_states/velocity_L": 7,
    "/joint_states/velocity_R": 7,
    "/control/joint_cmd_A": 7,
    "/control/joint_cmd_B": 7,
    "eef_left": 7,
    "eef_right": 7,
    "gripper_feedback_L": 1,
    "gripper_feedback_R": 1,
    "/hand_left/joint_commands/position": 20,
    "/hand_right/joint_commands/position": 20,
    "/hand_left/joint_states/position": 20,
    "/hand_right/joint_states/position": 20,
    "/hand_left/joint_states/effort": 20,
    "/hand_right/joint_states/effort": 20,
}
LEGACY_HAND_TOPIC_ALIASES = {
    "hand_left_joint_commands": "/hand_left/joint_commands/position",
    "hand_right_joint_commands": "/hand_right/joint_commands/position",
    "hand_left_joint_states_position": "/hand_left/joint_states/position",
    "hand_right_joint_states_position": "/hand_right/joint_states/position",
    "hand_left_joint_states_effort": "/hand_left/joint_states/effort",
    "hand_right_joint_states_effort": "/hand_right/joint_states/effort",
}
SHIFT_NEXT_ACTION_TOPICS = {"eef_left", "eef_right", "gripper_feedback_L", "gripper_feedback_R"}
SYNTHETIC_ACTION_COLUMN = "/_km/action:Scalars:scalars"
SYNTHETIC_STATE_COLUMN = "/_km/observation_state:Scalars:scalars"


def _parse_topic_csv(value: str | None) -> list[str] | None:
    if value is None:
        return None
    topics = [topic.strip() for topic in value.split(",") if topic.strip()]
    if not topics:
        raise ValueError("Topic override is empty.")
    return topics


def _canonical_feature_name(topic: str) -> str:
    if topic in LEGACY_HAND_TOPIC_ALIASES:
        return LEGACY_HAND_TOPIC_ALIASES[topic]
    if topic in FEATURE_DIMS:
        return topic
    for prefix in ("/info/", "/control/"):
        if topic.startswith(prefix):
            short_name = topic[len(prefix):]
            if short_name in FEATURE_DIMS:
                return short_name
    raise ValueError(f"Unsupported LeRobot schema topic: {topic}. Supported topics: {list(FEATURE_DIMS)}")


def _default_schema_for_end_effector(end_effector: EndEffectorMode) -> dict[str, list[str]]:
    if end_effector == "hand":
        return {
            "action": list(DEFAULT_HAND_ACTION_TOPICS),
            "observation": list(DEFAULT_HAND_OBSERVATION_TOPICS),
        }
    return {
        "action": list(DEFAULT_GRIPPER_ACTION_TOPICS),
        "observation": list(DEFAULT_GRIPPER_OBSERVATION_TOPICS),
    }


def _validate_schema_topics(topics: list[str], label: str) -> list[str]:
    canonical = [_canonical_feature_name(topic) for topic in topics]
    if not canonical:
        raise ValueError(f"{label} schema must contain at least one topic.")
    return canonical


def load_lerobot_schema_config(
    config_path: Path | None = None,
    *,
    end_effector: EndEffectorMode = "gripper",
    action_topics: str | None = None,
    observation_topics: str | None = None,
) -> dict[str, list[str]]:
    """Load and validate action/observation topic order for LeRobot vector assembly."""
    config = _default_schema_for_end_effector(end_effector)

    if config_path is not None:
        with config_path.open("r", encoding="utf-8") as file:
            loaded = json.load(file)
        if not isinstance(loaded, dict):
            raise ValueError(f"Schema config must be a JSON object: {config_path}")
        for key in ("action", "observation"):
            value = loaded.get(key)
            if value is not None:
                if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
                    raise ValueError(f"Schema config field '{key}' must be a list of topic strings.")
                config[key] = value

    action_override = _parse_topic_csv(action_topics)
    observation_override = _parse_topic_csv(observation_topics)
    if action_override is not None:
        config["action"] = action_override
    if observation_override is not None:
        config["observation"] = observation_override

    return {
        "action": _validate_schema_topics(config["action"], "action"),
        "observation": _validate_schema_topics(config["observation"], "observation"),
    }


def _schema_source_paths(schema_config: dict[str, list[str]]) -> list[str]:
    paths: list[str] = []
    for raw_topic in [*schema_config["action"], *schema_config["observation"]]:
        topic = _canonical_feature_name(raw_topic)
        if topic.startswith("/joint_states/"):
            base_path = topic.rsplit("_", 1)[0]
            if base_path not in paths:
                paths.append(base_path)
        elif topic in {"/control/joint_cmd_A", "/control/joint_cmd_B"}:
            if topic not in paths:
                paths.append(topic)
        elif topic in {"eef_left", "eef_right", "gripper_feedback_L", "gripper_feedback_R"}:
            for prefix in ("/info", "/control"):
                path = f"{prefix}/{topic}"
                if path not in paths:
                    paths.append(path)
        elif topic.startswith("/hand_"):
            if topic not in paths:
                paths.append(topic)
    return paths


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert multiple video2rrd files into one LeRobot dataset (one RRD = one episode)."
    )
    parser.add_argument(
        "input_dir_path",
        nargs="?",
        type=Path,
        default=None,
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
    parser.add_argument(
        "--lerobot-schema-config",
        type=Path,
        default=None,
        help="JSON file with {'action': [...], 'observation': [...]} topic lists.",
    )
    parser.add_argument(
        "--video-stream-config",
        type=Path,
        default=None,
        help="JSON file with selected 2x2 video grid to camera role mapping.",
    )
    parser.add_argument(
        "--action-topics",
        type=str,
        default=None,
        help="Comma-separated action topic list. Overrides --lerobot-schema-config action.",
    )
    parser.add_argument(
        "--observation-topics",
        type=str,
        default=None,
        help="Comma-separated observation.state topic list. Overrides --lerobot-schema-config observation.",
    )
    parser.add_argument(
        "--legacy-hand-mode",
        action="store_true",
        help="Use the old hand/gripper column schema instead of the configurable 30-dim schema.",
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
    schema_config: dict[str, list[str]] | None = None,
    legacy_hand_mode: bool = False,
) -> Any:
    if legacy_hand_mode:
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
            "/control/joint_cmd_A",
            "/control/joint_cmd_B",
            *state_paths,
            "/video_stream/**",
        ]
    else:
        if schema_config is None:
            schema_config = load_lerobot_schema_config(end_effector=end_effector)
        contents = [*_schema_source_paths(schema_config), "/video_stream/**"]

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
    if isinstance(value, dict):
        if "data" in value:
            return _flatten_numeric(value["data"])
        out: list[float] = []
        for item in value.values():
            out.extend(_flatten_numeric(item))
        return out
    if isinstance(value, np.ndarray):
        if value.dtype == object:
            out: list[float] = []
            for item in value.tolist():
                out.extend(_flatten_numeric(item))
            return out
        return value.astype(np.float32, copy=False).reshape(-1).tolist()
    if isinstance(value, (list, tuple)):
        out: list[float] = []
        for item in value:
            out.extend(_flatten_numeric(item))
        return out
    try:
        return [float(value)]
    except (TypeError, ValueError):
        return []


def _pick_optional_column(table: Any, candidates: list[str]) -> str | None:
    for candidate in candidates:
        if candidate in table.column_names:
            return candidate
    return None


def split_joint_state_vector(values: list[float], topic: str) -> list[float]:
    """Split a 14-dim joint state vector into the configured left/right 7-dim source."""
    if len(values) < 14:
        base_topic = topic.rsplit("_", 1)[0]
        raise ValueError(f"Topic {base_topic} must contain 14 values to build {topic}, got {len(values)}.")
    if topic.endswith("_L"):
        return values[:7]
    if topic.endswith("_R"):
        return values[7:14]
    raise ValueError(f"Topic is not a split joint state source: {topic}")


def _extract_column_vectors(table: Any, column_names: list[str], topic: str) -> np.ndarray:
    rows: list[list[float]] = []
    columns = [table[column_name].to_pylist() for column_name in column_names]
    for row_values in zip(*columns, strict=False):
        values: list[float] = []
        for value in row_values:
            values.extend(_flatten_numeric(value))
        if not values:
            raise ValueError(f"Topic {topic} has an empty value in the aligned RRD table.")
        rows.append(values)
    return np.asarray(rows, dtype=np.float32)


def _topic_candidates(topic: str, role: SchemaRole) -> list[tuple[str, list[str]]]:
    if topic.startswith("/joint_states/"):
        base_path = topic.rsplit("_", 1)[0]
        return [(base_path, [f"{base_path}:Scalars:scalars"])]
    if topic in {"/control/joint_cmd_A", "/control/joint_cmd_B"}:
        return [(topic, [f"{topic}:Scalars:scalars"])]
    if topic.startswith("eef_"):
        ordered_paths = [f"/control/{topic}", f"/info/{topic}"] if role == "action" else [f"/info/{topic}", f"/control/{topic}"]
        return [
            (
                path,
                [
                    f"{path}:Scalars:scalars",
                    f"{path}:InstancePoses3D:translations",
                    f"{path}:InstancePoses3D:quaternions",
                ],
            )
            for path in ordered_paths
        ]
    if topic.startswith("gripper_feedback_"):
        ordered_paths = [f"/control/{topic}", f"/info/{topic}"] if role == "action" else [f"/info/{topic}", f"/control/{topic}"]
        return [(path, [f"{path}:Scalars:scalars"]) for path in ordered_paths]
    hand_paths = {
        "/hand_left/joint_commands/position": [
            "/hand_left/joint_commands/position:Scalars:scalars",
            "/hand_left/joint_commands:Scalars:scalars",
        ],
        "/hand_right/joint_commands/position": [
            "/hand_right/joint_commands/position:Scalars:scalars",
            "/hand_right/joint_commands:Scalars:scalars",
        ],
        "/hand_left/joint_states/position": ["/hand_left/joint_states/position:Scalars:scalars"],
        "/hand_right/joint_states/position": ["/hand_right/joint_states/position:Scalars:scalars"],
        "/hand_left/joint_states/effort": ["/hand_left/joint_states/effort:Scalars:scalars"],
        "/hand_right/joint_states/effort": ["/hand_right/joint_states/effort:Scalars:scalars"],
    }
    if topic in hand_paths:
        return [(topic, hand_paths[topic])]
    raise ValueError(f"Unsupported topic: {topic}")


def extract_topic_vector(table: Any, topic: str, role: SchemaRole) -> np.ndarray:
    """Extract one configured topic as an N x dim float32 array from the aligned RRD table."""
    topic = _canonical_feature_name(topic)

    if topic.startswith("/joint_states/"):
        base_path, candidates = _topic_candidates(topic, role)[0]
        column = _pick_optional_column(table, candidates)
        if column is None:
            raise ValueError(f"Missing topic {base_path} required for configured source {topic}.")
        rows = []
        for value in table[column].to_pylist():
            rows.append(split_joint_state_vector(_flatten_numeric(value), topic))
        return validate_feature_dims(topic, np.asarray(rows, dtype=np.float32))

    if topic in {"/control/joint_cmd_A", "/control/joint_cmd_B"}:
        column = _pick_optional_column(table, [f"{topic}:Scalars:scalars"])
        if column is None:
            raise ValueError(f"Missing topic {topic}.")
        values = _extract_column_vectors(table, [column], topic)
        return validate_feature_dims(topic, values[:, : FEATURE_DIMS[topic]])

    if topic.startswith("/hand_"):
        for path, candidates in _topic_candidates(topic, role):
            column = _pick_optional_column(table, candidates)
            if column is not None:
                values = _extract_column_vectors(table, [column], path)
                return validate_feature_dims(topic, values[:, : FEATURE_DIMS[topic]])
        attempted = [path for path, _ in _topic_candidates(topic, role)]
        raise ValueError(f"Missing topic {topic} for {role}. Tried RRD entities: {attempted}.")

    for path, candidates in _topic_candidates(topic, role):
        scalar_column = _pick_optional_column(table, [candidate for candidate in candidates if candidate.endswith(":Scalars:scalars")])
        if scalar_column is not None:
            values = _extract_column_vectors(table, [scalar_column], path)
            if topic.startswith("gripper_feedback_"):
                return validate_feature_dims(topic, values[:, :1])
            return validate_feature_dims(topic, values[:, : FEATURE_DIMS[topic]])

        pose_columns = [
            f"{path}:InstancePoses3D:translations",
            f"{path}:InstancePoses3D:quaternions",
        ]
        if all(column in table.column_names for column in pose_columns):
            values = _extract_column_vectors(table, pose_columns, path)
            return validate_feature_dims(topic, values[:, : FEATURE_DIMS[topic]])

    attempted = [path for path, _ in _topic_candidates(topic, role)]
    raise ValueError(f"Missing topic {topic} for {role}. Tried RRD entities: {attempted}.")


def shift_next_frame_with_last_copy(vectors: np.ndarray) -> np.ndarray:
    """Shift vectors to t+1, keeping single-frame episodes safe and copying the final shifted frame."""
    if len(vectors) <= 1:
        return vectors.copy()
    shifted = np.empty_like(vectors)
    shifted[:-1] = vectors[1:]
    shifted[-1] = shifted[-2]
    return shifted


def validate_feature_dims(topic: str, values: np.ndarray) -> np.ndarray:
    """Ensure an extracted topic has the configured width before concatenation."""
    expected_dim = FEATURE_DIMS[_canonical_feature_name(topic)]
    if values.ndim != 2:
        raise ValueError(f"Topic {topic} must be a 2D vector array, got shape {values.shape}.")
    if values.shape[1] != expected_dim:
        raise ValueError(f"Topic {topic} has dim {values.shape[1]} but expected {expected_dim}.")
    return values.astype(np.float32, copy=False)


def build_feature_vector(table: Any, topics: list[str], role: SchemaRole) -> np.ndarray:
    """Build the configured action or observation.state vector in user-selected order."""
    parts: list[np.ndarray] = []
    for topic in topics:
        canonical_topic = _canonical_feature_name(topic)
        values = extract_topic_vector(table, canonical_topic, role)
        if role == "action" and canonical_topic in SHIFT_NEXT_ACTION_TOPICS:
            values = shift_next_frame_with_last_copy(values)
        parts.append(values)

    if not parts:
        raise ValueError(f"No topics configured for {role}.")

    row_counts = {part.shape[0] for part in parts}
    if len(row_counts) != 1:
        raise ValueError(f"Configured {role} topics produced inconsistent row counts: {sorted(row_counts)}")
    return np.concatenate(parts, axis=1).astype(np.float32, copy=False)


def _vector_column(values: np.ndarray) -> pa.Array:
    return pa.array([row.tolist() for row in values], type=pa.list_(pa.float32()))


def _datafusion_dataframe_from_arrow_table(table: pa.Table) -> Any:
    import datafusion as dfn  # type: ignore[import-not-found]

    ctx = dfn.SessionContext()
    for method_name in ("from_arrow_table", "from_arrow", "create_dataframe"):
        method = getattr(ctx, method_name, None)
        if method is None:
            continue
        try:
            if method_name == "create_dataframe":
                return method(table.to_batches())
            return method(table)
        except TypeError:
            try:
                return method("schema_enriched", table)
            except TypeError:
                continue
    raise RuntimeError("Installed datafusion package cannot build a dataframe from a PyArrow table.")


def add_schema_vector_columns(segment_data: Any, schema_config: dict[str, list[str]]) -> tuple[Any, pa.Table]:
    """Materialize the aligned RRD reader, append schema vectors, and return a DataFusion dataframe."""
    table = segment_data.to_arrow_table()
    action_values = build_feature_vector(table, schema_config["action"], "action")
    state_values = build_feature_vector(table, schema_config["observation"], "observation")
    table = table.append_column(SYNTHETIC_ACTION_COLUMN, _vector_column(action_values))
    table = table.append_column(SYNTHETIC_STATE_COLUMN, _vector_column(state_values))
    return _datafusion_dataframe_from_arrow_table(table), table


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


def _build_action_columns(table: Any) -> list[str]:
    return [
        _pick_first_existing(table, ["/joint_states/effort:Scalars:scalars"], "joint_effort"),
        _pick_first_existing(table, ["/joint_states/position:Scalars:scalars"], "joint_position"),
        _pick_first_existing(table, ["/joint_states/velocity:Scalars:scalars"], "joint_velocity"),
        _pick_first_existing(table, ["/control/joint_cmd_A:Scalars:scalars"], "control_joint_cmd_A"),
        _pick_first_existing(table, ["/control/joint_cmd_B:Scalars:scalars"], "control_joint_cmd_B"),
    ]


def validate_and_build_action_columns(table: Any) -> list[str]:
    action_columns = _build_action_columns(table)
    expected_control_dims = {
        "/control/joint_cmd_A": 7,
        "/control/joint_cmd_B": 7,
    }

    observed_control_dims = {
        path: sum(_infer_column_vector_dim(table, column) for column in action_columns if column.startswith(f"{path}:"))
        for path in expected_control_dims
    }

    bad_dims = [
        path for path, expected_dim in expected_control_dims.items() if observed_control_dims.get(path, 0) != expected_dim
    ]
    if bad_dims:
        debug_samples = {
            column: _first_non_null_value(table, column)
            for column in action_columns
            if any(column.startswith(f"{path}:") for path in bad_dims)
        }
        raise ValueError(
            "Control joint command dimensions do not match expected action schema. "
            f"Mismatched paths: {bad_dims}. Observed dims: {observed_control_dims}. "
            f"Sample non-null values: {debug_samples}"
        )

    return action_columns


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


def _video_path_for_role(role: str) -> str:
    return f"/video_stream/{role}/current_frame"


def _rrd_has_video_stream(dataset: Any, segment_id: Any, role: str) -> bool:
    path = _video_path_for_role(role)
    try:
        schema = dataset.filter_segments(segment_id).filter_contents([path]).schema()
        for descriptor in schema.component_columns():
            if str(descriptor.name).startswith(f"{path}:"):
                return True
    except Exception:
        return False
    return False


def infer_video_roles_from_rrd(dataset: Any, segment_id: Any) -> list[str]:
    roles = [role for role in VALID_VIDEO_ROLES if _rrd_has_video_stream(dataset, segment_id, role)]
    if not roles:
        raise ValueError("No video streams found in RRD under /video_stream/<role>/current_frame.")
    return roles


def resolve_lerobot_video_roles(
    video_stream_config: dict[str, list[dict[str, str]]] | None,
    dataset: Any | None = None,
    segment_id: Any | None = None,
) -> list[str]:
    if video_stream_config is not None:
        return [item["role"] for item in resolve_video_stream_entities(video_stream_config)]
    if dataset is None or segment_id is None:
        return [item["role"] for item in resolve_video_stream_entities(None)]
    return infer_video_roles_from_rrd(dataset, segment_id)


def build_lerobot_video_specs(video_roles: list[str], video_spec_type: Any) -> list[Any]:
    return [
        video_spec_type(key=role, path=_video_path_for_role(role), video_format="h264")
        for role in video_roles
    ]


def infer_fps_from_rrd(dataset: Any, segment_id: Any, video_role: str) -> int:
    segment_data = dataset.filter_segments(segment_id).filter_contents([_video_path_for_role(video_role)]).reader(
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
    lerobot_schema_config: Path | None = None,
    video_stream_config: dict[str, list[dict[str, str]]] | None = None,
    action_topics: str | None = None,
    observation_topics: str | None = None,
    legacy_hand_mode: bool = False,
) -> int:
    from rerun_export.lerobot.converter import convert_dataframe_to_episode  # type: ignore[import-not-found]
    from rerun_export.lerobot.feature_inference import infer_features  # type: ignore[import-not-found]
    from rerun_export.lerobot.types import LeRobotConversionConfig, VideoSpec  # type: ignore[import-not-found]

    rrd_files = _list_rrd_files(input_dir)
    schema_config = None if legacy_hand_mode else load_lerobot_schema_config(
        lerobot_schema_config,
        end_effector=end_effector,
        action_topics=action_topics,
        observation_topics=observation_topics,
    )

    instructions = "/language_instruction:TextDocument:text"
    use_manual_task_description = task_description is not None
    task_column = "" if use_manual_task_description else instructions
    task_default = task_description if use_manual_task_description else "task"
    video_roles = resolve_lerobot_video_roles(video_stream_config) if video_stream_config is not None else None

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
            if video_roles is None:
                video_roles = resolve_lerobot_video_roles(None, dataset=dataset, segment_id=raw_segment_id)
            videos = build_lerobot_video_specs(video_roles, VideoSpec)
            segment_data = build_training_data(
                dataset,
                raw_segment_id,
                end_effector=end_effector,
                include_language_instruction=not use_manual_task_description,
                schema_config=schema_config,
                legacy_hand_mode=legacy_hand_mode,
            )

            schema_arrow = None
            if not legacy_hand_mode:
                segment_data, schema_arrow = add_schema_vector_columns(
                    segment_data,
                    schema_config or load_lerobot_schema_config(end_effector=end_effector),
                )

            if config is None:
                auto_fps = infer_fps_from_rrd(dataset, raw_segment_id, video_roles[0])
                test_arrow = schema_arrow if schema_arrow is not None else segment_data.to_arrow_table()
                if legacy_hand_mode:
                    action_columns = validate_and_build_action_columns(test_arrow)
                    state_columns = validate_and_build_state_columns(test_arrow, end_effector=end_effector)
                else:
                    action_columns = [SYNTHETIC_ACTION_COLUMN]
                    state_columns = [SYNTHETIC_STATE_COLUMN]

                config = LeRobotConversionConfig(
                    fps=auto_fps,
                    index_column="message_log_time",
                    action=",".join(action_columns),
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
        lerobot_schema_config=args.lerobot_schema_config,
        video_stream_config=load_video_stream_config(args.video_stream_config) if args.video_stream_config else None,
        action_topics=args.action_topics,
        observation_topics=args.observation_topics,
        legacy_hand_mode=args.legacy_hand_mode,
    )
    print(f"Finalized dataset with {episode_count} episodes at: {output_root}")


if __name__ == "__main__":
    main()
