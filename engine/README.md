# H3 Studio embedded engine

This directory is the installation target for the private rendering runtime.
Runtime binaries, generated artifacts, models and generated data are deliberately
not committed to Git.

Expected development layout:

```text
engine/
  manifest.json
  components.lock.json
  python-package-licenses.lock.json
  runtime/
    python_embeded/python.exe
    ComfyUI/main.py
  _artifacts/
```

During development, `INSTALL_STANDALONE_ENGINE.bat` imports a known-good
Windows portable installation with an atomic staging step. It copies Python,
the ComfyUI core and only the custom nodes required by the bundled workflows;
it reuses `extra_model_paths.yaml`, so model weights are not duplicated.

`BUILD_STANDALONE_ENGINE_ARTIFACT.bat` validates the pinned component inventory,
applies project-maintained node overlays and builds a deterministic ZIP with
SHA-256, build provenance, Python SBOM and third-party notices. For example:

```bat
BUILD_STANDALONE_ENGINE_ARTIFACT.bat --validate-only --allow-incomplete-notices
BUILD_STANDALONE_ENGINE_ARTIFACT.bat --allow-incomplete-notices --compression fastest --force
```

The public bootstrap is `INSTALL_H3_STUDIO_STANDALONE.bat`; it uses pinned,
checksummed artifacts, resumable downloads, isolated staging and recoverable
backups. A fresh install generates model paths for the project `models`
directory; an update preserves the existing `extra_model_paths.yaml`.

The tracked manifest remains intentionally unpublished until the dedicated
standalone repository exists, the remaining upstream license is resolved and a
vetted immutable release archive has been uploaded. See
`docs/STANDALONE-BOOTSTRAP.md` for the manifest contract and release gate.

H3 Studio starts the engine on loopback, verifies a private identity endpoint,
owns its process and stores input, output and logs under `data/`. Users never
need to open the ComfyUI web interface. A different listener on the configured
port is treated as a conflict and is never adopted or terminated.

`START_H3_STUDIO_STANDALONE.bat` launches one supervisor console. Closing it
with Ctrl+C terminates the web process, bridge and the embedded engine process
tree together.
