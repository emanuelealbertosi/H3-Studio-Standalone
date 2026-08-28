from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
import zipfile
from email.parser import Parser
from pathlib import Path, PurePosixPath


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_EXCLUDED_PREFIXES = (
    "ComfyUI/models/",
    "ComfyUI/input/",
    "ComfyUI/output/",
    "ComfyUI/temp/",
    "ComfyUI/user/",
)
EXCLUDED_PARTS = {".git", "__pycache__", "node_modules"}
EXCLUDED_SUFFIXES = {".pyc", ".pyo", ".log", ".sqlite", ".lock"}
EXCLUDED_FILES = {
    ".installed-manifest.json",
    "ComfyUI/extra_model_paths.yaml",
}

GITHUB_RELEASE_ASSET_LIMIT_BYTES = 2 * 1024**3
TORCH_ARCHIVE_PREFIX = "python_embeded/Lib/site-packages/torch/"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a deterministic H3 Studio embedded-engine ZIP and manifest."
    )
    parser.add_argument("--source-root", default=str(PROJECT_ROOT / "engine" / "runtime"))
    parser.add_argument("--output-directory", default=str(PROJECT_ROOT / "engine" / "_artifacts"))
    parser.add_argument("--base-manifest", default=str(PROJECT_ROOT / "engine" / "manifest.json"))
    parser.add_argument("--components-lock", default=str(PROJECT_ROOT / "engine" / "components.lock.json"))
    parser.add_argument(
        "--python-license-lock",
        default=str(PROJECT_ROOT / "engine" / "python-package-licenses.lock.json"),
    )
    parser.add_argument("--engine-version")
    parser.add_argument("--source-date-epoch", type=int, default=1787875200)
    parser.add_argument("--compression", choices=("stored", "fastest", "optimal"), default="fastest")
    parser.add_argument("--artifact-url")
    parser.add_argument("--artifact-base-url")
    parser.add_argument("--github-release", action="store_true")
    parser.add_argument("--release", action="store_true")
    parser.add_argument("--allow-incomplete-notices", action="store_true")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def resolved_child(root: Path, candidate: Path) -> Path:
    root = root.resolve()
    candidate = candidate.resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"Unsafe path outside project: {candidate}") from exc
    return candidate


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def stable_json(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def should_exclude(relative: str, prefixes: tuple[str, ...]) -> bool:
    normalized = relative.replace("\\", "/")
    if normalized in EXCLUDED_FILES:
        return True
    if any(normalized.startswith(prefix) for prefix in prefixes):
        return True
    path = PurePosixPath(normalized)
    if any(part in EXCLUDED_PARTS for part in path.parts):
        return True
    return path.suffix.lower() in EXCLUDED_SUFFIXES


def collect_payload(source_root: Path, prefixes: tuple[str, ...]) -> list[tuple[str, Path]]:
    payload: list[tuple[str, Path]] = []
    for path in source_root.rglob("*"):
        if path.is_symlink():
            raise ValueError(f"Symlinks/reparse points are not supported: {path}")
        if not path.is_file():
            continue
        relative = path.relative_to(source_root).as_posix()
        if not should_exclude(relative, prefixes):
            payload.append((relative, path))
    payload.sort(key=lambda item: item[0].casefold())
    return payload


def apply_workspace_overlays(
    payload: list[tuple[str, Path]],
    overlays: list[tuple[str, Path]],
) -> list[tuple[str, Path]]:
    entries = dict(payload)
    for runtime_path, workspace_root in overlays:
        prefix = runtime_path.rstrip("/") + "/"
        entries = {name: path for name, path in entries.items() if not name.startswith(prefix)}
        for path in workspace_root.rglob("*"):
            if path.is_symlink():
                raise ValueError(f"Symlinks/reparse points are not supported: {path}")
            if not path.is_file():
                continue
            relative = path.relative_to(workspace_root).as_posix()
            if not should_exclude(relative, ()):
                entries[prefix + relative] = path
    return sorted(entries.items(), key=lambda item: item[0].casefold())


def directory_digest(root: Path) -> str:
    digest = hashlib.sha256()
    records: list[tuple[str, Path]] = []
    for path in root.rglob("*"):
        if path.is_file():
            relative = path.relative_to(root).as_posix()
            if not should_exclude(relative, ()):
                records.append((relative, path))
    for relative, path in sorted(records, key=lambda item: item[0].casefold()):
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(sha256_file(path).encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest()


def git_state() -> tuple[str, bool]:
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=PROJECT_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    status = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=normal"],
        cwd=PROJECT_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    return head, bool(status)


def validate_components(
    source_root: Path,
    lock: dict,
    repo_head: str,
    repo_dirty: bool,
) -> tuple[list[dict], list[str], list[tuple[str, Path]]]:
    if lock.get("schemaVersion") != 1:
        raise ValueError("Unsupported components lock schemaVersion")
    components = []
    unresolved = []
    overlays = []
    locked_node_names = set()
    for item in lock.get("components", []):
        component = dict(item)
        runtime_path = source_root / component["runtimePath"]
        if not runtime_path.exists():
            raise ValueError(f"Locked component missing from runtime: {component['id']}")
        if component["runtimePath"].startswith("ComfyUI/custom_nodes/"):
            locked_node_names.add(Path(component["runtimePath"]).name.casefold())
        for metadata_field in ("licensePath", "licenseEvidencePath"):
            metadata_path = component.get(metadata_field)
            if isinstance(metadata_path, str) and metadata_path.startswith("project:"):
                candidate = resolved_child(
                    PROJECT_ROOT,
                    PROJECT_ROOT / metadata_path.split(":", 1)[1],
                )
            elif metadata_path:
                candidate = resolved_child(source_root, source_root / metadata_path)
            else:
                candidate = None
            if candidate is not None and not candidate.is_file():
                raise ValueError(
                    f"Component {metadata_field} missing for {component['id']}: {candidate}"
                )
        if component.get("licenseStatus") == "unresolved" or component.get("license") == "NOASSERTION":
            unresolved.append(component["id"])
        source = component.get("source", "")
        if source.startswith("workspace:"):
            workspace_root = PROJECT_ROOT / source.split(":", 1)[1]
            if not workspace_root.is_dir():
                raise ValueError(f"Workspace source missing for {component['id']}: {workspace_root}")
            runtime_digest = directory_digest(runtime_path)
            workspace_digest = directory_digest(workspace_root)
            overlays.append((component["runtimePath"], workspace_root))
            component["version"] = f"{repo_head}+dirty" if repo_dirty else repo_head
            component["treeSha256"] = workspace_digest
            component["runtimeTreeSha256"] = runtime_digest
            component["workspaceOverlayApplied"] = runtime_digest != workspace_digest
        components.append(component)

    custom_root = source_root / "ComfyUI" / "custom_nodes"
    detected = {
        entry.name.casefold()
        for entry in custom_root.iterdir()
        if entry.is_dir() and entry.name not in EXCLUDED_PARTS and not entry.name.startswith(".")
    }
    unlocked = sorted(detected - locked_node_names)
    missing = sorted(locked_node_names - detected)
    if unlocked:
        raise ValueError(f"Runtime contains unlocked custom nodes: {', '.join(unlocked)}")
    if missing:
        raise ValueError(f"Lock contains custom nodes absent from runtime: {', '.join(missing)}")
    return components, unresolved, overlays


def read_python_packages(source_root: Path, license_lock: dict) -> tuple[list[dict], list[str]]:
    if license_lock.get("schemaVersion") != 1:
        raise ValueError("Unsupported Python package license lock schemaVersion")
    overrides = {}
    for item in license_lock.get("packages", []):
        key = (item["name"].casefold(), item["version"])
        if key in overrides:
            raise ValueError(f"Duplicate Python package license override: {item['name']}=={item['version']}")
        overrides[key] = item
    applied_overrides = set()
    site_packages = source_root / "python_embeded" / "Lib" / "site-packages"
    packages = []
    unresolved = []
    for dist_info in sorted(site_packages.glob("*.dist-info"), key=lambda item: item.name.casefold()):
        metadata_path = dist_info / "METADATA"
        if not metadata_path.is_file():
            continue
        metadata = Parser().parsestr(metadata_path.read_text(encoding="utf-8", errors="replace"))
        name = metadata.get("Name") or dist_info.name
        version = metadata.get("Version") or "unknown"
        license_value = metadata.get("License-Expression") or metadata.get("License")
        if not license_value or license_value.strip().upper() in {"UNKNOWN", "NONE"}:
            classifiers = [
                value.removeprefix("License :: ").strip()
                for value in metadata.get_all("Classifier", [])
                if value.startswith("License :: ")
            ]
            license_value = " | ".join(classifiers) if classifiers else "NOASSERTION"
        license_files = sorted(
            path.relative_to(source_root).as_posix()
            for path in dist_info.rglob("*")
            if path.is_file() and (
                "license" in path.name.casefold()
                or path.name.casefold().startswith(("copying", "notice"))
            )
        )
        record = {
            "name": name,
            "version": version,
            "license": license_value.strip(),
            "licenseFiles": license_files,
            "metadataPath": metadata_path.relative_to(source_root).as_posix(),
        }
        override_key = (name.casefold(), version)
        override = overrides.get(override_key)
        if override is not None:
            evidence_path = source_root / override["evidencePath"]
            if not evidence_path.is_file():
                raise ValueError(
                    f"Python package license evidence missing for {name}=={version}: {evidence_path}"
                )
            evidence_relative = evidence_path.relative_to(source_root).as_posix()
            record.update({
                "license": override["license"],
                "licenseFiles": sorted(set([*license_files, evidence_relative])),
                "licenseEvidence": override["evidencePath"],
                "source": override.get("source"),
                "licenseUrl": override.get("licenseUrl"),
                "note": override.get("note"),
            })
            applied_overrides.add(override_key)
        if record["license"] == "NOASSERTION" and not record["licenseFiles"]:
            unresolved.append(f"{name}=={version}")
        packages.append(record)
    unused_overrides = sorted(set(overrides) - applied_overrides)
    if unused_overrides:
        preview = ", ".join(f"{name}=={version}" for name, version in unused_overrides)
        raise ValueError(f"Python package license overrides do not match the runtime: {preview}")
    packages.sort(key=lambda item: (item["name"].casefold(), item["version"]))
    return packages, unresolved


def component_license_files(components: list[dict]) -> dict[str, bytes]:
    files = {}
    for component in components:
        component_id = component["id"]
        if Path(component_id).name != component_id:
            raise ValueError(f"Unsafe component id for license archive path: {component_id}")
        for metadata_field in ("licensePath", "licenseEvidencePath"):
            metadata_path = component.get(metadata_field)
            if not isinstance(metadata_path, str) or not metadata_path.startswith("project:"):
                continue
            source = resolved_child(
                PROJECT_ROOT,
                PROJECT_ROOT / metadata_path.split(":", 1)[1],
            )
            archive_path = f"LICENSES/{component_id}/{source.name}"
            data = source.read_bytes()
            if archive_path in files and files[archive_path] != data:
                raise ValueError(f"Conflicting component license archive path: {archive_path}")
            files[archive_path] = data
    return files


def build_notices(engine_version: str, components: list[dict], packages: list[dict]) -> str:
    lines = [
        "H3 Studio Standalone - Third-Party Notices",
        "=" * 43,
        "",
        f"Embedded engine version: {engine_version}",
        "Model weights are not included in this archive.",
        "",
        "Runtime components",
        "------------------",
    ]
    for component in components:
        lines.extend(
            [
                f"- {component['id']} {component['version']}",
                f"  Source: {component['source']}",
                f"  License: {component['license']} ({component['licenseStatus']})",
                f"  License file: {component.get('licensePath') or 'MISSING'}",
                f"  Evidence: {component.get('licenseEvidenceUrl') or component.get('licenseEvidencePath') or 'packaged metadata'}",
                f"  Note: {component.get('licenseNote') or 'none'}",
            ]
        )
    lines.extend(
        [
            "",
            "Python packages",
            "---------------",
            f"{len(packages)} installed Python distributions are listed in python-packages.sbom.json.",
            "Their METADATA and packaged license files remain in python_embeded/Lib/site-packages.",
            "",
        ]
    )
    return "\n".join(lines)


def zip_settings(name: str) -> tuple[int, int | None]:
    if name == "stored":
        return zipfile.ZIP_STORED, None
    if name == "optimal":
        return zipfile.ZIP_DEFLATED, 9
    return zipfile.ZIP_DEFLATED, 1


def write_archive(
    archive_path: Path,
    payload: list[tuple[str, Path]],
    virtual: dict[str, bytes],
    epoch: int,
    compression_name: str,
) -> None:
    compression, level = zip_settings(compression_name)
    fixed_time = time.gmtime(max(epoch, 315532800))[:6]
    options = {"compression": compression, "allowZip64": True}
    if level is not None:
        options["compresslevel"] = level
    records: list[tuple[str, Path | bytes]] = [*payload, *virtual.items()]
    records.sort(key=lambda item: item[0].casefold())
    print(
        f"Packing {len(records)} entries into {archive_path.name} "
        f"with {compression_name} compression...",
        flush=True,
    )
    with zipfile.ZipFile(archive_path, mode="w", **options) as archive:
        for index, (relative, source) in enumerate(records, start=1):
            if index == 1 or index % 2000 == 0 or index == len(records):
                print(f"  [{index}/{len(records)}] {relative}", flush=True)
            info = zipfile.ZipInfo(relative, date_time=fixed_time)
            info.compress_type = compression
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            if isinstance(source, bytes):
                archive.writestr(info, source, compress_type=compression, compresslevel=level)
                continue
            with source.open("rb") as input_file, archive.open(info, "w", force_zip64=True) as output_file:
                for block in iter(lambda: input_file.read(4 * 1024 * 1024), b""):
                    output_file.write(block)


def main() -> int:
    args = parse_args()
    source_root = resolved_child(PROJECT_ROOT, Path(args.source_root))
    output_directory = resolved_child(PROJECT_ROOT, Path(args.output_directory))
    base_manifest_path = resolved_child(PROJECT_ROOT, Path(args.base_manifest))
    lock_path = resolved_child(PROJECT_ROOT, Path(args.components_lock))
    python_license_lock_path = resolved_child(PROJECT_ROOT, Path(args.python_license_lock))
    base_manifest = load_json(base_manifest_path)
    lock = load_json(lock_path)
    python_license_lock = load_json(python_license_lock_path)
    repo_head, repo_dirty = git_state()
    engine_version = args.engine_version or base_manifest["engineVersion"]
    for required in ("python_embeded/python.exe", "ComfyUI/main.py"):
        if not (source_root / required).is_file():
            raise ValueError(f"Runtime entrypoint missing: {required}")

    prefixes = tuple(base_manifest.get("excludedArchivePrefixes", DEFAULT_EXCLUDED_PREFIXES))
    payload = collect_payload(source_root, prefixes)
    components, unresolved_components, overlays = validate_components(
        source_root,
        lock,
        repo_head,
        repo_dirty,
    )
    payload = apply_workspace_overlays(payload, overlays)
    packages, unresolved_packages = read_python_packages(source_root, python_license_lock)
    incomplete = [*unresolved_components, *unresolved_packages]
    if incomplete and (args.release or not args.allow_incomplete_notices):
        preview = ", ".join(incomplete[:12])
        raise ValueError(
            f"License metadata incomplete for {len(incomplete)} entries: {preview}. "
            "Resolve them or use --allow-incomplete-notices for a development artifact."
        )
    if args.release and args.github_release:
        if not args.artifact_base_url:
            raise ValueError("GitHub release builds require --artifact-base-url")
        if not args.artifact_base_url.startswith("https://"):
            raise ValueError("Release artifact base URL must use HTTPS")
    elif args.release:
        if not args.artifact_url:
            raise ValueError("--release requires an immutable --artifact-url")
        if not args.artifact_url.startswith("https://"):
            raise ValueError("Release artifact URL must use HTTPS")
    if args.release and repo_dirty:
        raise ValueError("Release builds require a clean Git working tree")

    payload_bytes = sum(path.stat().st_size for _, path in payload)
    inventory = {
        "schemaVersion": 1,
        "engineVersion": engine_version,
        "components": components,
        "unresolvedLicenses": unresolved_components,
    }
    sbom = {
        "schemaVersion": 1,
        "format": "h3-studio-python-packages",
        "packages": packages,
        "unresolvedLicenses": unresolved_packages,
    }
    build_info = {
        "schemaVersion": 1,
        "engineVersion": engine_version,
        "distribution": base_manifest["distribution"],
        "sourceCommit": repo_head,
        "sourceDirty": repo_dirty,
        "sourceDateEpoch": args.source_date_epoch,
        "payloadFileCount": len(payload),
        "payloadBytes": payload_bytes,
        "excludedArchivePrefixes": prefixes,
        "modelsIncluded": False,
    }
    virtual = {
        "BUILD-INFO.json": stable_json(build_info),
        "component-inventory.json": stable_json(inventory),
        "python-packages.sbom.json": stable_json(sbom),
        "THIRD_PARTY_NOTICES.txt": build_notices(engine_version, components, packages).encode("utf-8"),
        "LICENSES/H3-Studio/LICENSE": (PROJECT_ROOT / "LICENSE").read_bytes(),
        "LICENSES/H3-Studio/NOTICE": (PROJECT_ROOT / "NOTICE").read_bytes(),
    }
    virtual.update(component_license_files(components))
    output_directory.mkdir(parents=True, exist_ok=True)
    report_path = output_directory / "build-report.json"
    report = {
        **build_info,
        "status": "validated" if args.validate_only else "pending",
        "sourceRoot": str(source_root),
        "unresolvedLicenseCount": len(incomplete),
        "unresolvedLicenses": incomplete,
        "artifactLayout": "github-release" if args.github_release else "single",
    }
    if args.validate_only:
        report_path.write_bytes(stable_json(report))
        print(json.dumps(report, ensure_ascii=False))
        return 0

    artifact_stem = f"h3-engine-{engine_version}-windows-nvidia-x64"
    if args.github_release:
        core_payload = [item for item in payload if not item[0].startswith(TORCH_ARCHIVE_PREFIX)]
        torch_payload = [item for item in payload if item[0].startswith(TORCH_ARCHIVE_PREFIX)]
        if not core_payload or not torch_payload:
            raise ValueError("GitHub release layout requires non-empty core and torch payloads")
        artifact_specs = [
            ("engine-runtime-core", f"{artifact_stem}-core.zip", core_payload, virtual),
            ("engine-runtime-torch", f"{artifact_stem}-torch.zip", torch_payload, {}),
        ]
    else:
        artifact_specs = [
            ("engine-runtime", f"{artifact_stem}.zip", payload, virtual),
        ]

    artifact_paths = [output_directory / name for _, name, _, _ in artifact_specs]
    existing = [path for path in artifact_paths if path.exists()]
    if existing and not args.force:
        names = ", ".join(str(path) for path in existing)
        raise ValueError(f"Artifact already exists: {names}; use --force")
    for path in existing:
        path.unlink()

    built_artifacts = []
    for artifact_id, artifact_name, part_payload, part_virtual in artifact_specs:
        artifact_path = output_directory / artifact_name
        write_archive(
            artifact_path,
            part_payload,
            part_virtual,
            args.source_date_epoch,
            args.compression,
        )
        artifact_size = artifact_path.stat().st_size
        if args.github_release and artifact_size >= GITHUB_RELEASE_ASSET_LIMIT_BYTES:
            raise ValueError(
                f"GitHub release asset exceeds the 2 GiB limit: {artifact_name} "
                f"({artifact_size} bytes)"
            )
        artifact_hash = sha256_file(artifact_path)
        if args.release and args.github_release:
            artifact_source = f"{args.artifact_base_url.rstrip('/')}/{artifact_name}"
        elif args.release:
            artifact_source = args.artifact_url
        else:
            artifact_source = str(artifact_path)
        built_artifacts.append(
            {
                "id": artifact_id,
                "fileName": artifact_name,
                "urls": [artifact_source],
                "sha256": artifact_hash,
                "sizeBytes": artifact_size,
                "archiveType": "zip",
                "artifactPath": str(artifact_path),
            }
        )

    manifest_digest = hashlib.sha256(
        "".join(
            f"{item['id']}:{item['sha256']}\n" for item in built_artifacts
        ).encode("ascii")
    ).hexdigest()
    generated_manifest = {
        **base_manifest,
        "manifestVersion": f"{engine_version}+{manifest_digest[:12]}",
        "releaseState": "published" if args.release else "unpublished",
        "engineVersion": engine_version,
        "installedSizeBytes": payload_bytes + sum(len(value) for value in virtual.values()),
        "requiredFiles": [
            "python_embeded/python.exe",
            "ComfyUI/main.py",
            "ComfyUI/extra_model_paths.yaml",
            "THIRD_PARTY_NOTICES.txt",
            "component-inventory.json",
            "python-packages.sbom.json",
        ],
        "artifacts": [
            {
                key: value
                for key, value in item.items()
                if key != "artifactPath"
            }
            for item in built_artifacts
        ],
        "components": components,
        "publication": {
            "blockedReason": None if args.release else "Development artifact; not published.",
            "unresolvedLicenseCount": len(incomplete),
        },
    }
    manifest_path = output_directory / "manifest.json"
    manifest_path.write_bytes(stable_json(generated_manifest))
    report.update(
        {
            "status": "built",
            "artifacts": built_artifacts,
            "manifestPath": str(manifest_path),
        }
    )
    if len(built_artifacts) == 1:
        report.update(
            {
                "artifactPath": built_artifacts[0]["artifactPath"],
                "artifactBytes": built_artifacts[0]["sizeBytes"],
                "artifactSha256": built_artifacts[0]["sha256"],
            }
        )
    report_path.write_bytes(stable_json(report))
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"artifact builder: {error}", file=sys.stderr)
        raise SystemExit(1)
