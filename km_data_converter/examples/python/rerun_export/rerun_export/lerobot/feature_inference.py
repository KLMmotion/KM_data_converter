"""Feature shape inference for LeRobot datasets."""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from rerun_export.lerobot.video_processing import infer_video_shape_from_table

if TYPE_CHECKING:
    import pyarrow as pa

    from rerun_export.lerobot.types import FeatureSpec, LeRobotConversionConfig


def _infer_vector_dim_from_columns(*, table: pa.Table, columns: list[str], label: str) -> int:
    for column in columns:
        if column not in table.column_names:
            raise ValueError(f"{label.capitalize()} column '{column}' not found in table. Available columns: {table.column_names}")

    if not columns:
        raise ValueError(f"No {label} columns configured.")

    column_values = [table[column].to_pylist() for column in columns]
    num_rows = len(column_values[0])

    for row_idx in range(num_rows):
        parts: list[np.ndarray] = []
        missing_value = False

        for column, values in zip(columns, column_values, strict=True):
            value = values[row_idx]
            if value is None:
                missing_value = True
                break

            array = np.asarray(value).flatten()
            if not np.can_cast(array.dtype, np.float32, "same_kind"):
                raise ValueError(
                    f"{label.capitalize()} data in column '{column}' has dtype '{array.dtype}' "
                    "which cannot be safely cast to float32"
                )
            parts.append(array.astype(np.float32, copy=False))

        if missing_value:
            continue

        if parts:
            return int(sum(part.size for part in parts))

    columns_desc = ", ".join(columns)
    raise ValueError(f"Could not infer {label} dimension: no row has non-null values for all columns [{columns_desc}]")


def infer_features(
    *,
    table: pa.Table,
    config: LeRobotConversionConfig,
) -> dict[str, FeatureSpec]:
    """
    Infer feature specifications from a pre-queried PyArrow table.

    Args:
        table: PyArrow table containing all necessary columns (action, state, video samples)
        config: Conversion configuration

    Returns:
        Dictionary mapping feature names to their specifications

    Raises:
        ValueError: If features cannot be inferred or names don't match dimensions

    """
    features: dict[str, FeatureSpec] = {}

    # Infer action dimension (supports comma-separated action columns)
    action_columns = config.action_columns()
    action_dim = _infer_vector_dim_from_columns(table=table, columns=action_columns, label="action")
    if config.action_names is not None and len(config.action_names) != action_dim:
        raise ValueError("Action names length does not match inferred action dimension.")
    features["action"] = {"dtype": "float32", "shape": (action_dim,), "names": config.action_names}

    # Infer state dimension (supports comma-separated state columns)
    state_columns = config.state_columns()
    state_dim = _infer_vector_dim_from_columns(table=table, columns=state_columns, label="state")
    if config.state_names is not None and len(config.state_names) != state_dim:
        raise ValueError("State names length does not match inferred state dimension.")
    features["observation.state"] = {"dtype": "float32", "shape": (state_dim,), "names": config.state_names}

    # Infer video shapes
    for spec in config.videos:
        sample_column = f"{spec['path']}:VideoStream:sample"
        video_format = spec.get("video_format", "h264")

        try:
            shape = infer_video_shape_from_table(
                table=table,
                sample_column=sample_column,
                index_column=config.index_column,
                video_format=video_format,
            )
        except ValueError as e:
            raise ValueError(f"Could not infer video shape for '{spec['path']}' (column '{sample_column}'): {e}") from e

        feature_key = f"observation.images.{spec['key']}"
        features[feature_key] = {
            "dtype": "video" if config.use_videos else "image",
            "shape": shape,
            "names": ["height", "width", "channels"],
        }

    return features
