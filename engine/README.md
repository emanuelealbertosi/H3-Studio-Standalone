# H3 Studio embedded engine

This directory is the installation target for the private rendering runtime.
Runtime binaries, Python packages, models and generated data are deliberately
not committed to Git.

Expected development layout:

```text
engine/
  runtime/
    python_embeded/python.exe
    ComfyUI/main.py
```

During development, `INSTALL_STANDALONE_ENGINE.bat` imports a known-good
Windows portable installation with an atomic staging step. It copies Python,
the ComfyUI core and only the custom nodes required by the bundled workflows;
it reuses `extra_model_paths.yaml`, so model weights are not duplicated. The
public release installer will instead use pinned, checksummed artifacts.

H3 Studio starts the engine on loopback, verifies a private identity endpoint,
owns its process and stores input, output and logs under `data/`. Users never
need to open the ComfyUI web interface. A different listener on the configured
port is treated as a conflict and is never adopted or terminated.

`START_H3_STUDIO_STANDALONE.bat` launches one supervisor console. Closing it
with Ctrl+C terminates the web process, bridge and the embedded engine process
tree together.
