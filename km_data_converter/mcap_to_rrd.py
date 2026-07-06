from __future__ import annotations

import argparse
from pathlib import Path

import rerun as rr


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export each BAG_STORAGE/my_bag-* episode to its own RRD file."
    )
    parser.add_argument(
        "bag_storage_path",
        nargs="?",
        type=Path,
        default=Path(r"C:\Users\willi\Desktop\0327data"),
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
            "Output root for mcap2rrd files. "
            "If not ending with datasets/mcap2rrd, the command appends datasets/mcap2rrd automatically."
        ),
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Fail on first missing/bad bag. Default behavior skips bad bags.",
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


def _resolve_output_dir(args: argparse.Namespace, bag_storage: Path) -> Path:
    # Default behavior: write under bag_storage/datasets/mcap2rrd
    base = args.output_dir if args.output_dir is not None else bag_storage
    normalized_parts = [part.lower() for part in base.parts]

    if len(normalized_parts) >= 2 and normalized_parts[-2:] == ["datasets", "mcap2rrd"]:
        return base

    if normalized_parts and normalized_parts[-1] == "mcap2rrd":
        return base

    return base / "datasets" / "mcap2rrd"


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


def _mcap_path_for_bag(bag_dir: Path) -> Path:
    mcap_path = bag_dir / "data" / "data_0.mcap"
    if not mcap_path.exists():
        raise FileNotFoundError(f"Missing MCAP file: {mcap_path}")
    return mcap_path


def convert_bag_storage_to_rrd(
    bag_storage: Path,
    output_dir: Path,
    strict: bool = False,
) -> tuple[list[Path], int]:
    bag_dirs = _list_bag_dirs(bag_storage)
    output_dir.mkdir(parents=True, exist_ok=True)

    exported_paths: list[Path] = []
    fail_count = 0

    for bag_dir in bag_dirs:
        try:
            mcap_path = _mcap_path_for_bag(bag_dir)
            output_rrd_path = output_dir / "mcap_to_rrd" / bag_dir.name / "mcap2rrd.rrd"
            output_rrd_path.parent.mkdir(parents=True, exist_ok=True)
            rr.init(f"bag_storage_{bag_dir.name}", spawn=False)
            rr.log_file_from_path(str(mcap_path))
            rr.save(str(output_rrd_path))

            exported_paths.append(output_rrd_path)
            print(f"Exported: {bag_dir.name} -> {output_rrd_path}")
        except Exception as exc:
            fail_count += 1
            print(f"[ERROR] {bag_dir.name}: {exc}")
            if strict:
                raise

    if not exported_paths:
        raise RuntimeError("No bag was successfully exported. Nothing to save.")

    return exported_paths, fail_count


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)
    bag_storage = _resolve_bag_storage(args)
    output_dir = _resolve_output_dir(args, bag_storage)

    exported_paths, fail_count = convert_bag_storage_to_rrd(
        bag_storage=bag_storage,
        output_dir=output_dir,
        strict=args.strict,
    )

    print(f"Saved per-episode RRDs in: {output_dir}")
    print(f"Episodes exported: {len(exported_paths)}, skipped: {fail_count}")


if __name__ == "__main__":
    main()
