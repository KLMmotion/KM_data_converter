from __future__ import annotations

import argparse
import re
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

import numpy as np
import rerun as rr

from km_data_converter.video_stream import get_video_stream_samples, pick_video_path
from km_data_converter.video_to_rrd import (
    _align_reader_dataframe_rows,
    _build_vectors_from_columns,
    _infer_vector_size_from_columns,
    _pick_data_columns,
    _read_first_frame_epoch_ns,
    _read_with_index_fallback,
    _state_source_paths,
    _target_dims,
)

PROJECT_ROOT = Path(__file__).resolve().parent
MARVIN_DESCRIPTION_ROOT = PROJECT_ROOT / "Marvin-description-ccs_new"
DEFAULT_XACRO_PATH = MARVIN_DESCRIPTION_ROOT / "urdf" / "marvin_CCS_m6.urdf.xacro"
DEFAULT_OUTPUT_URDF = PROJECT_ROOT / ".generated" / "marvin_CCS_m6.urdf"

XACRO_NS = "http://ros.org/wiki/xacro"
XACRO_TAG_PREFIX = f"{{{XACRO_NS}}}"
SUPPORTED_PACKAGE_NAME = "marvin_description"
SUPPORTED_PACKAGE_URI = f"package://{SUPPORTED_PACKAGE_NAME}/"
FIND_PACKAGE_PATTERN = re.compile(r"\$\(find\s+([^)]+)\)")
VIDEO2RRD_PATTERN = re.compile(r"^video2rrd-(?P<timestamp>.+)\.rrd$")
ARM_JOINT_NAMES = [
    "Joint1_L",
    "Joint2_L",
    "Joint3_L",
    "Joint4_L",
    "Joint5_L",
    "Joint6_L",
    "Joint7_L",
    "Joint1_R",
    "Joint2_R",
    "Joint3_R",
    "Joint4_R",
    "Joint5_R",
    "Joint6_R",
    "Joint7_R",
]


class XacroExpansionError(RuntimeError):
    pass


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Expand the Marvin xacro model and visualize it in Rerun."
    )
    parser.add_argument(
        "--input-rrd",
        type=Path,
        default=None,
        help="Existing video2rrd file to augment with the Marvin URDF and aligned joint transforms.",
    )
    parser.add_argument(
        "--output-rrd",
        type=Path,
        default=None,
        help="Where to save the merged RRD. Defaults next to --input-rrd with a -with-urdf suffix.",
    )
    parser.add_argument(
        "--bag-dir",
        type=Path,
        default=None,
        help="Optional bag directory. If omitted, it is inferred from --input-rrd.",
    )
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        default=None,
        help="Optional mcap2rrd dataset root. If omitted, it is inferred from --input-rrd.",
    )
    parser.add_argument(
        "--xacro",
        type=Path,
        default=DEFAULT_XACRO_PATH,
        help="Path to the Marvin xacro file to expand.",
    )
    parser.add_argument(
        "--output-urdf",
        type=Path,
        default=DEFAULT_OUTPUT_URDF,
        help="Where to write the expanded URDF before sending it to Rerun.",
    )
    parser.add_argument(
        "--application-id",
        default="marvin_urdf_viewer",
        help="Rerun application id.",
    )
    parser.add_argument(
        "--no-spawn",
        action="store_true",
        help="Do not spawn a Rerun viewer automatically.",
    )
    parser.add_argument(
        "--joint",
        action="append",
        default=[],
        metavar="NAME=VALUE",
        help="Optional joint override. Repeat for multiple joints.",
    )
    parser.add_argument(
        "path",
        nargs="?",
        type=Path,
        help="Optional positional path: an input RRD file or a dataset root directory to batch-process.",
    )
    return parser.parse_args(argv)


def _local_name(tag: str) -> str:
    if tag.startswith("{"):
        return tag.split("}", 1)[1]
    return tag


def _resolve_find_substitution(value: str, package_root: Path) -> str:
    def replace(match: re.Match[str]) -> str:
        package_name = match.group(1).strip()
        if package_name != SUPPORTED_PACKAGE_NAME:
            raise XacroExpansionError(
                f"Unsupported package lookup '{package_name}'. Expected '{SUPPORTED_PACKAGE_NAME}'."
            )
        return package_root.resolve().as_posix()

    return FIND_PACKAGE_PATTERN.sub(replace, value)


def _resolve_include_path(raw_path: str, current_dir: Path, package_root: Path) -> Path:
    resolved = _resolve_find_substitution(raw_path, package_root)
    candidate = Path(resolved)
    if not candidate.is_absolute():
        candidate = (current_dir / candidate).resolve()
    return candidate


def _resolve_asset_path(raw_path: str, package_root: Path) -> str:
    resolved = _resolve_find_substitution(raw_path, package_root)
    if resolved.startswith(SUPPORTED_PACKAGE_URI):
        suffix = resolved[len(SUPPORTED_PACKAGE_URI) :]
        return (package_root / suffix).resolve().as_posix()
    if resolved.startswith("package://"):
        raise XacroExpansionError(
            f"Unsupported package URI '{raw_path}'. Only '{SUPPORTED_PACKAGE_URI}' is supported."
        )

    candidate = Path(resolved)
    if candidate.is_absolute():
        return candidate.resolve().as_posix()
    return resolved


def _collect_macros(root: ET.Element, current_dir: Path, package_root: Path, macros: dict[str, list[ET.Element]]) -> None:
    for child in list(root):
        if child.tag == f"{XACRO_TAG_PREFIX}include":
            filename = child.attrib.get("filename")
            if not filename:
                raise XacroExpansionError("xacro:include is missing the 'filename' attribute.")
            include_path = _resolve_include_path(filename, current_dir, package_root)
            include_root = ET.parse(include_path).getroot()
            _collect_macros(include_root, include_path.parent, package_root, macros)
            continue

        if child.tag == f"{XACRO_TAG_PREFIX}macro":
            macro_name = child.attrib.get("name")
            if not macro_name:
                raise XacroExpansionError("xacro:macro is missing the 'name' attribute.")
            macros[macro_name] = [deepcopy(node) for node in list(child)]
            continue

        _collect_macros(child, current_dir, package_root, macros)


def _expand_macro_calls(root: ET.Element, macros: dict[str, list[ET.Element]]) -> None:
    expanded_children: list[ET.Element] = []

    for child in list(root):
        if child.tag in {f"{XACRO_TAG_PREFIX}include", f"{XACRO_TAG_PREFIX}macro"}:
            continue

        if child.tag.startswith(XACRO_TAG_PREFIX):
            macro_name = _local_name(child.tag)
            if macro_name not in macros:
                raise XacroExpansionError(f"Unsupported xacro element '{macro_name}'.")

            replacements = [deepcopy(node) for node in macros[macro_name]]
            for replacement in replacements:
                _expand_macro_calls(replacement, macros)

            if child.tail and replacements:
                replacements[-1].tail = (replacements[-1].tail or "") + child.tail

            expanded_children.extend(replacements)
            continue

        _expand_macro_calls(child, macros)
        expanded_children.append(child)

    root[:] = expanded_children


def _rewrite_resource_paths(root: ET.Element, package_root: Path) -> None:
    for element in root.iter():
        for attribute_name, attribute_value in list(element.attrib.items()):
            if attribute_name in {"filename", "url"}:
                element.attrib[attribute_name] = _resolve_asset_path(attribute_value, package_root)
            elif "$(find" in attribute_value:
                element.attrib[attribute_name] = _resolve_find_substitution(attribute_value, package_root)


def expand_xacro_to_urdf(source_xacro: Path, output_urdf: Path, package_root: Path) -> Path:
    if not source_xacro.exists():
        raise FileNotFoundError(f"xacro file does not exist: {source_xacro}")
    if not package_root.exists():
        raise FileNotFoundError(f"package root does not exist: {package_root}")

    root = ET.parse(source_xacro).getroot()
    macros: dict[str, list[ET.Element]] = {}
    _collect_macros(root, source_xacro.parent, package_root, macros)
    _expand_macro_calls(root, macros)
    _rewrite_resource_paths(root, package_root)

    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    output_urdf.parent.mkdir(parents=True, exist_ok=True)
    tree.write(output_urdf, encoding="utf-8", xml_declaration=True)
    return output_urdf


def _parse_joint_overrides(items: list[str]) -> dict[str, float]:
    overrides: dict[str, float] = {}
    for item in items:
        if "=" not in item:
            raise ValueError(f"Invalid joint override '{item}'. Expected NAME=VALUE.")
        joint_name, raw_value = item.split("=", 1)
        joint_name = joint_name.strip()
        if not joint_name:
            raise ValueError(f"Invalid joint override '{item}'. Joint name is empty.")
        try:
            overrides[joint_name] = float(raw_value)
        except ValueError as exc:
            raise ValueError(
                f"Invalid joint override '{item}'. VALUE must be a float."
            ) from exc
    return overrides


def _infer_paths_from_input_rrd(input_rrd: Path) -> tuple[str, Path, Path]:
    match = VIDEO2RRD_PATTERN.match(input_rrd.name)
    if not match:
        raise ValueError(
            f"Cannot infer bag timestamp from '{input_rrd.name}'. Expected video2rrd-<timestamp>.rrd"
        )

    timestamp = match.group("timestamp")
    datasets_root = input_rrd.parent.parent
    bag_storage_root = datasets_root.parent
    bag_dir = bag_storage_root / f"my_bag-{timestamp}"
    dataset_dir = datasets_root / "mcap2rrd"
    return timestamp, bag_dir, dataset_dir


def _resolve_output_rrd_path(input_rrd: Path, output_rrd: Path | None) -> Path:
    if output_rrd is not None:
        return output_rrd
    return input_rrd.with_name(f"{input_rrd.stem}-with-urdf.rrd")


def _load_aligned_joint_positions(bag_dir: Path, dataset_dir: Path) -> tuple[np.ndarray, np.ndarray]:
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
    left_eye_video = video_paths[0]
    _, _, video_sample_ts_ns = get_video_stream_samples(left_eye_video)
    video_sample_stamp_ns = first_frame_epoch_ns + video_sample_ts_ns
    video_sample_timestamps = video_sample_stamp_ns.astype("datetime64[ns]")

    server = rr.server.Server(datasets={"data": sample_data_path})
    client = rr.catalog.CatalogClient(server.url())
    dataset = client.get_dataset(name="data")

    path_reader, index_name = _read_with_index_fallback(
        dataset,
        ["/joint_states/position"],
        video_sample_timestamps,
    )
    path_df = path_reader.to_arrow_table().to_pandas()
    path_df = _align_reader_dataframe_rows(path_df, video_sample_timestamps, index_name)

    selected_columns = _pick_data_columns(
        list(path_df.columns),
        "/joint_states/position",
        end_effector="gripper",
    )
    inferred_dim = _infer_vector_size_from_columns(path_df, selected_columns)
    if inferred_dim < len(ARM_JOINT_NAMES):
        raise ValueError(
            f"/joint_states/position only has {inferred_dim} values, expected at least {len(ARM_JOINT_NAMES)}."
        )

    joint_positions = _build_vectors_from_columns(
        path_df,
        selected_columns,
        vector_size=inferred_dim,
    )[:, : len(ARM_JOINT_NAMES)]
    return video_sample_timestamps, joint_positions


def _load_video2rrd_content(
    bag_dir: Path,
    dataset_dir: Path,
    end_effector: str = "gripper",
) -> tuple[np.ndarray, dict[str, dict[str, object]], dict[str, np.ndarray]]:
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

    timestamps = np.asarray(camera_streams["left_eye"]["timestamps"]).astype("datetime64[ns]")
    for camera_name, stream in camera_streams.items():
        camera_timestamps = np.asarray(stream["timestamps"]).astype("datetime64[ns]")
        if len(camera_timestamps) != len(timestamps):
            raise ValueError(
                "Length mismatch across camera streams: "
                f"left_eye={len(timestamps)} vs {camera_name}={len(camera_timestamps)}"
            )

    server = rr.server.Server(datasets={"data": sample_data_path})
    client = rr.catalog.CatalogClient(server.url())
    dataset = client.get_dataset(name="data")

    source_paths = _state_source_paths(end_effector)
    target_dims = _target_dims(end_effector)
    joint_values_by_path: dict[str, np.ndarray] = {}

    for path in source_paths:
        path_reader, index_name = _read_with_index_fallback(dataset, [path], timestamps)
        path_df = path_reader.to_arrow_table().to_pandas()
        path_df = _align_reader_dataframe_rows(path_df, timestamps, index_name)

        selected_columns = _pick_data_columns(list(path_df.columns), path, end_effector=end_effector)
        if all(path_df[column_name].isnull().all() for column_name in selected_columns):
            raise ValueError(f"Columns '{selected_columns}' for '{path}' contain only null values.")

        inferred_dim = _infer_vector_size_from_columns(path_df, selected_columns)
        export_dim = max(inferred_dim, target_dims.get(path, inferred_dim))
        joint_values_by_path[path] = _build_vectors_from_columns(
            path_df,
            selected_columns,
            vector_size=export_dim,
        )

    return timestamps, camera_streams, joint_values_by_path


def _log_video2rrd_content(
    rec: rr.RecordingStream,
    timestamps: np.ndarray,
    camera_streams: dict[str, dict[str, object]],
    joint_values_by_path: dict[str, np.ndarray],
) -> None:
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

    for path, joint_values in joint_values_by_path.items():
        rec.send_columns(
            path,
            indexes=[time_column],
            columns=[*rr.Scalars.columns(scalars=joint_values)],
        )


def _log_aligned_joint_transforms(
    rec: rr.RecordingStream,
    urdf_path: Path,
    timestamps: np.ndarray,
    joint_positions: np.ndarray,
) -> list[str]:
    urdf_tree = rr.urdf.UrdfTree.from_file_path(str(urdf_path), entity_path_prefix=None)
    joints_by_name = {joint.name: joint for joint in urdf_tree.joints()}
    missing_joints = [joint_name for joint_name in ARM_JOINT_NAMES if joint_name not in joints_by_name]
    if missing_joints:
        raise ValueError(f"URDF is missing expected arm joints: {missing_joints}")

    for timestamp, joint_row in zip(timestamps, joint_positions, strict=True):
        rec.set_time("message_log_time", timestamp=timestamp)
        for joint_name, joint_value in zip(ARM_JOINT_NAMES, joint_row, strict=True):
            rec.log("transforms", joints_by_name[joint_name].compute_transform(float(joint_value)))

    return ARM_JOINT_NAMES


def _log_joint_overrides(rec: rr.RecordingStream, urdf_path: Path, joint_overrides: dict[str, float]) -> list[str]:
    urdf_tree = rr.urdf.UrdfTree.from_file_path(str(urdf_path), entity_path_prefix=None)
    joints = list(urdf_tree.joints())
    joints_by_name = {joint.name: joint for joint in joints}

    unknown_joints = sorted(set(joint_overrides) - set(joints_by_name))
    if unknown_joints:
        available = ", ".join(sorted(joints_by_name))
        unknown = ", ".join(unknown_joints)
        raise ValueError(f"Unknown joint(s): {unknown}. Available joints: {available}")

    for joint_name, joint_value in joint_overrides.items():
        rec.log("transforms", joints_by_name[joint_name].compute_transform(joint_value))

    return [joint.name for joint in joints]


def visualize_urdf(
    xacro_path: Path,
    output_urdf: Path,
    application_id: str,
    spawn: bool,
    joint_overrides: dict[str, float],
) -> Path:
    expanded_urdf = expand_xacro_to_urdf(
        source_xacro=xacro_path.resolve(),
        output_urdf=output_urdf.resolve(),
        package_root=MARVIN_DESCRIPTION_ROOT.resolve(),
    )

    with rr.RecordingStream(application_id=application_id) as rec:
        if spawn:
            rec.spawn()

        rec.log_file_from_path(str(expanded_urdf), static=True)
        rec.flush()

        joint_names = _log_joint_overrides(rec, expanded_urdf, joint_overrides)

    print(f"Expanded URDF: {expanded_urdf}")
    print(f"Loaded {len(joint_names)} joints into Rerun.")
    if joint_overrides:
        print(f"Applied overrides: {joint_overrides}")
    print("Available joints:")
    for joint_name in joint_names:
        print(f"  - {joint_name}")

    return expanded_urdf


def augment_rrd_with_urdf(
    input_rrd: Path,
    output_rrd: Path,
    xacro_path: Path,
    output_urdf: Path,
    application_id: str,
    spawn: bool,
    bag_dir: Path | None,
    dataset_dir: Path | None,
) -> Path:
    input_rrd = input_rrd.resolve()
    if not input_rrd.exists():
        raise FileNotFoundError(f"Input RRD does not exist: {input_rrd}")

    _, inferred_bag_dir, inferred_dataset_dir = _infer_paths_from_input_rrd(input_rrd)
    resolved_bag_dir = (bag_dir or inferred_bag_dir).resolve()
    resolved_dataset_dir = (dataset_dir or inferred_dataset_dir).resolve()
    resolved_output_rrd = output_rrd.resolve()

    expanded_urdf = expand_xacro_to_urdf(
        source_xacro=xacro_path.resolve(),
        output_urdf=output_urdf.resolve(),
        package_root=MARVIN_DESCRIPTION_ROOT.resolve(),
    )
    timestamps, camera_streams, joint_values_by_path = _load_video2rrd_content(
        resolved_bag_dir,
        resolved_dataset_dir,
    )
    _, joint_positions = _load_aligned_joint_positions(resolved_bag_dir, resolved_dataset_dir)

    with rr.RecordingStream(application_id=application_id) as rec:
        if spawn:
            rec.spawn()

        _log_video2rrd_content(rec, timestamps, camera_streams, joint_values_by_path)
        rec.log_file_from_path(str(expanded_urdf), static=True)
        rec.flush()

        logged_joint_names = _log_aligned_joint_transforms(rec, expanded_urdf, timestamps, joint_positions)

        resolved_output_rrd.parent.mkdir(parents=True, exist_ok=True)
        rec.save(str(resolved_output_rrd))

    print(f"Input RRD: {input_rrd}")
    print(f"Expanded URDF: {expanded_urdf}")
    print(f"Output RRD: {resolved_output_rrd}")
    print(f"Aligned {len(timestamps)} frames on message_log_time.")
    print(f"Logged URDF transforms for joints: {', '.join(logged_joint_names)}")
    return resolved_output_rrd


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)
    # If a positional path is provided, allow shorthand batch processing.
    if getattr(args, "path", None) is not None:
        p = args.path
        if not p.exists():
            raise FileNotFoundError(f"Path does not exist: {p}")

        # If directory: find video2rrd files and process each (default no-spawn for batch)
        if p.is_dir():
            video_dir = p / "datasets" / "video2rrd"
            if not video_dir.exists():
                raise FileNotFoundError(f"Expected datasets/video2rrd under: {p}")

            for in_rrd in sorted(video_dir.glob("video2rrd-*.rrd")):
                out_rrd = in_rrd.with_name(in_rrd.stem + "-urdf.rrd")
                print(f"Processing {in_rrd} -> {out_rrd}")
                try:
                    augment_rrd_with_urdf(
                        input_rrd=in_rrd,
                        output_rrd=out_rrd,
                        xacro_path=args.xacro,
                        output_urdf=args.output_urdf,
                        application_id=args.application_id,
                        spawn=False,
                        bag_dir=args.bag_dir,
                        dataset_dir=args.dataset_dir,
                    )
                except Exception as e:
                    print(f"Failed processing {in_rrd}: {e}")
            return

        # If a file was provided as positional argument, treat it as input_rrd (single-file shorthand)
        if p.is_file():
            augment_rrd_with_urdf(
                input_rrd=p,
                output_rrd=_resolve_output_rrd_path(p, args.output_rrd),
                xacro_path=args.xacro,
                output_urdf=args.output_urdf,
                application_id=args.application_id,
                spawn=not args.no_spawn,
                bag_dir=args.bag_dir,
                dataset_dir=args.dataset_dir,
            )
            return

    if args.input_rrd is not None:
        augment_rrd_with_urdf(
            input_rrd=args.input_rrd,
            output_rrd=_resolve_output_rrd_path(args.input_rrd, args.output_rrd),
            xacro_path=args.xacro,
            output_urdf=args.output_urdf,
            application_id=args.application_id,
            spawn=not args.no_spawn,
            bag_dir=args.bag_dir,
            dataset_dir=args.dataset_dir,
        )
        return

    joint_overrides = _parse_joint_overrides(args.joint)
    visualize_urdf(
        xacro_path=args.xacro,
        output_urdf=args.output_urdf,
        application_id=args.application_id,
        spawn=not args.no_spawn,
        joint_overrides=joint_overrides,
    )


if __name__ == "__main__":
    main()
