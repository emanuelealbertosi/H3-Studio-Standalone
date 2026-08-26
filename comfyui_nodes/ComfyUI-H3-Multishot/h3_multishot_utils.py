# -*- coding: utf-8 -*-
"""H3 multishot utilities - JoyEcho-style single-script prompting for the
MiniMax H3 chained workflow. One node, no dependencies.

Accepts the same script formats the JoyEcho stack uses:
  - JSON: {"prompts": ["shot 1 ...", "shot 2 ...", "shot 3 ..."]}
  - plain text with --- separators between shots
Feeds up to 4 shot prompts as separate STRING outputs. Missing shots fall
back to the previous shot's prompt so a 2-shot script still runs a 3-shot
graph without erroring.
"""
import json
import math
import re

from . import h3_multishot_refs as h3_refs



def _repair_json(text):
    """Parse JSON, auto-closing unterminated brackets/quotes.

    Long multi-prompt scripts get truncated or lose their final brace all the
    time (a 4,500-char script with the closing '}' missing is not a typo the
    author can see). Returns (data, note): data is None on real failure and
    note carries the error; note is a description when a repair was applied,
    or "" when the text parsed clean.
    """
    try:
        return json.loads(text), ""
    except json.JSONDecodeError as e:
        first_err = str(e)   # bind now; Python clears the except-name on exit

    # walk the text tracking string state, then close what is still open
    stack, in_str, esc = [], False, False
    for ch in text:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "{[":
            stack.append(ch)
        elif ch in "}]":
            if stack and ((ch == "}" and stack[-1] == "{") or
                          (ch == "]" and stack[-1] == "[")):
                stack.pop()

    candidate = text.rstrip()
    fixes = []
    if in_str:
        candidate += '"'
        fixes.append("closed an open string")
    if candidate.endswith(","):
        candidate = candidate[:-1]
        fixes.append("dropped a trailing comma")
    # trailing comma before a closer, e.g.  ["a","b",]  or  {"k":1,}
    cleaned = re.sub(r",(\s*[\]}])", r"\1", candidate)
    if cleaned != candidate:
        candidate = cleaned
        fixes.append("removed comma(s) before a closing bracket")
    for opener in reversed(stack):
        candidate += "}" if opener == "{" else "]"
    if stack:
        fixes.append("added " + "".join("}" if o == "{" else "]"
                                        for o in reversed(stack)))
    if not fixes:
        return None, first_err
    try:
        return json.loads(candidate), ", ".join(fixes)
    except json.JSONDecodeError as e:
        return None, str(e)



def _xfade_audio(parts, sr, ms=40):
    """Concatenate shot audio with a short equal-power crossfade at each seam.

    Each shot is sampled independently, so its waveform starts and ends at a
    hard boundary. Butt-joining them puts a step discontinuity in the signal at
    every seam, which reads as a click and as "spliced clips" to a listener.
    A ~40ms equal-power fade removes the step without audibly shortening
    anything.
    """
    import torch
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    n = max(1, int(sr * ms / 1000.0))
    out = parts[0]
    for nxt in parts[1:]:
        k = min(n, out.shape[-1], nxt.shape[-1])
        if k < 8:                      # too short to fade; butt-join
            out = torch.cat([out, nxt], dim=-1)
            continue
        t = torch.linspace(0, 1, k, dtype=out.dtype, device=out.device)
        fade_out = torch.cos(t * 3.14159265 / 2)   # equal power
        fade_in = torch.sin(t * 3.14159265 / 2)
        head, tail = out[..., :-k], out[..., -k:]
        seam = tail * fade_out + nxt[..., :k] * fade_in
        out = torch.cat([head, seam, nxt[..., k:]], dim=-1)
    return out


class _MasterFrameStore:
    """Accumulate decoded IMAGE frames either in RAM or in a temp mmap.

    The mmap path preserves the public IMAGE output: downstream core
    CreateVideo/SaveVideo nodes iterate it frame-by-frame, while old pages can
    be reclaimed by Windows instead of every completed shot remaining as an
    ordinary resident tensor. The backing file follows the tensor lifetime
    and otherwise lives only in ComfyUI's temp directory.
    """

    def __init__(self, torch_module, stream_to_disk, capacity, width, height):
        self.torch = torch_module
        self.stream_to_disk = bool(stream_to_disk)
        self.capacity = int(capacity)
        self.expected_width = int(width)
        self.expected_height = int(height)
        self.count = 0
        self.parts = []
        self._array = None
        self._path = None
        self._keep_file = False

        if not self.stream_to_disk:
            return

        import os
        import shutil
        import uuid
        import folder_paths

        self._dir = os.path.join(folder_paths.get_temp_directory(),
                                 "h3_multishot_stream")
        os.makedirs(self._dir, exist_ok=True)
        self._path = os.path.join(
            self._dir, f"h3_frames_{uuid.uuid4().hex}.f32")

        # H3 video decode emits RGB float32 IMAGE tensors. Check the estimated
        # full allocation before spending minutes on shot 1. A small margin is
        # required for audio, container output and filesystem bookkeeping.
        estimated = (self.capacity * self.expected_height
                     * self.expected_width * 3 * 4)
        margin = max(2 * 1024 ** 3, estimated // 10)
        free = shutil.disk_usage(self._dir).free
        if free < estimated + margin:
            raise RuntimeError(
                "H3 low-RAM stream needs %.1f GB temporary disk space plus "
                "%.1f GB safety margin, but only %.1f GB is free in %s." % (
                    estimated / 1024 ** 3, margin / 1024 ** 3,
                    free / 1024 ** 3, self._dir))
        print("[H3Multishot] LOW RAM stream enabled: reserving up to %.1f GB "
              "in %s" % (estimated / 1024 ** 3, self._path), flush=True)

    def _open(self, frames):
        if self._array is not None:
            return
        import numpy as np

        if frames.ndim != 4:
            raise ValueError("H3 decoded frames must be BHWC, got shape %s"
                             % (tuple(frames.shape),))
        _, height, width, channels = frames.shape
        if channels not in (3, 4):
            raise ValueError(
                "H3 decoded IMAGE output must have 3 or 4 channels, got %d"
                % channels)
        self._array = np.memmap(
            self._path, mode="w+", dtype=np.float32,
            shape=(self.capacity, height, width, channels))

    def append(self, frames):
        cpu = frames.detach().to(device="cpu")
        if not self.stream_to_disk:
            self.parts.append(cpu)
            self.count += cpu.shape[0]
            return

        self._open(cpu)
        end = self.count + cpu.shape[0]
        if end > self.capacity:
            raise RuntimeError(
                "H3 low-RAM stream received %d frames, exceeding its %d-frame "
                "buffer. This indicates an unexpected VAE frame-count change."
                % (end, self.capacity))
        expected_shape = self._array.shape[1:]
        if tuple(cpu.shape[1:]) != tuple(expected_shape):
            raise RuntimeError(
                "H3 low-RAM stream frame shape changed from %s to %s between "
                "shots." % (tuple(expected_shape), tuple(cpu.shape[1:])))
        if cpu.dtype != self.torch.float32:
            cpu = cpu.float()
        self._array[self.count:end] = cpu.numpy()
        self._array.flush()
        self.count = end

    def blend_tail(self, matching_frames):
        """Linearly blend generated context into the delivered video tail.

        Motion Context generates a prefix that should match the end of the
        previous clip. Hard-trimming that prefix avoids duplicate frames but
        can still leave a visible decode seam. Blend the matching prefix over
        the stored source-side tail without changing the final frame count.
        """
        incoming = matching_frames.detach().to(device="cpu")
        k = min(int(self.count), int(incoming.shape[0]))
        if k < 1:
            return 0
        incoming = incoming[-k:]

        if self.stream_to_disk:
            import numpy as np

            previous = self.torch.from_numpy(
                np.asarray(self._array[self.count - k:self.count])).clone()
        else:
            remaining = k
            chunks = []
            for part in reversed(self.parts):
                take = min(remaining, int(part.shape[0]))
                if take:
                    chunks.append(part[-take:])
                    remaining -= take
                if remaining == 0:
                    break
            previous = self.torch.cat(list(reversed(chunks)), dim=0)

        incoming = incoming.to(dtype=previous.dtype)
        alpha = self.torch.linspace(
            0.0, 1.0, k + 2, dtype=previous.dtype)[1:-1]
        alpha = alpha.reshape(k, 1, 1, 1)
        blended = previous * (1.0 - alpha) + incoming * alpha

        if self.stream_to_disk:
            self._array[self.count - k:self.count] = blended.numpy()
            self._array.flush()
        else:
            remaining = k
            cursor = k
            for part in reversed(self.parts):
                take = min(remaining, int(part.shape[0]))
                if take:
                    part[-take:] = blended[cursor - take:cursor]
                    cursor -= take
                    remaining -= take
                if remaining == 0:
                    break
        return k

    @staticmethod
    def _release(array, path):
        import os
        try:
            array.flush()
            array._mmap.close()
        except Exception:
            pass
        try:
            os.remove(path)
        except OSError:
            pass

    def finish(self):
        if not self.stream_to_disk:
            return self.torch.cat(self.parts, dim=0)

        import weakref
        self._array.flush()
        view = self._array[:self.count]
        master = self.torch.from_numpy(view)
        # Keep the mapping alive exactly as long as ComfyUI keeps the IMAGE
        # output cached, then reclaim the potentially very large temp file.
        weakref.finalize(master, self._release, self._array, self._path)
        self._keep_file = True
        print("[H3Multishot] master frames are disk-backed: %s" % self._path,
              flush=True)
        return master

    def __del__(self):
        # Interrupted/OOM renders must not strand a multi-GB partial file.
        if (self.stream_to_disk and not self._keep_file
                and self._array is not None and self._path):
            self._release(self._array, self._path)


def _parse_script(text):
    """JoyEcho script -> list of shot prompts. JSON {"prompts": [...]} or
    plain text with --- separators. Malformed JSON fails LOUD."""
    text = (text or "").strip()
    shots = []
    if text.startswith("{") or text.startswith("["):
        data, repaired = _repair_json(text)
        if data is None:
            raise ValueError(
                f"H3 script looks like JSON but does not parse ({repaired}). "
                f"Auto-repair of unclosed brackets/quotes was attempted and "
                f"failed. Common cause: a doubled {{ on the first lines, or a "
                f"missing comma between prompts. Fix the script or use plain "
                f"prompts separated by --- lines.")
        if repaired:
            print(f"[H3Multishot] script JSON was incomplete; auto-repaired "
                  f"({repaired}). Consider fixing the source.", flush=True)
        if isinstance(data, dict):
            shots = [str(p) for p in data.get("prompts", [])]
        elif isinstance(data, list):
            shots = [str(p) for p in data]
    if not shots:
        shots = [b.strip().replace('\\"', '"')
                 for b in re.split(r"(?m)^---\s*$", text) if b.strip()]
    if not shots:
        shots = [text]
    return shots


class H3ScriptSplit:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"script": ("STRING", {
            "multiline": True, "dynamicPrompts": False,
            "default": "Shot 1 prompt goes here.\n---\n"
                       "Shot 2 prompt goes here.\n---\n"
                       "Shot 3 prompt goes here.",
            "tooltip": "One prompt per shot, separated by --- on its own "
                       "line. (JSON {\"prompts\": [...]} also accepted, for "
                       "generated scripts.)"}),
            "shot_count": ("INT", {
                "default": 0, "min": 0, "max": 3,
                "tooltip": "This workflow ALWAYS renders 3 segments and "
                           "joins them (~30s master). 0 = count from the "
                           "script. 3 = three scenes. 2 = the third segment "
                           "continues scene 2. 1 = one scene sustained for "
                           "the full 30s. Scripts with >3 prompts: extras "
                           "are dropped (see console)."}),
        }}

    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "INT")
    RETURN_NAMES = ("shot_1", "shot_2", "shot_3", "shot_4", "shot_count")
    FUNCTION = "split"
    CATEGORY = "conditioning/minimax"

    def split(self, script, shot_count=0):
        shots = _parse_script(script)
        if shot_count and shot_count > 0:
            if len(shots) > shot_count:
                print(f"[H3ScriptSplit] shot_count={shot_count}: dropping "
                      f"{len(shots) - shot_count} extra script shot(s).",
                      flush=True)
                shots = shots[:shot_count]
            while len(shots) < shot_count:
                shots.append(shots[-1])
        n = len(shots)
        if n < 3:
            print(f"[H3ScriptSplit] script has {n} shot(s); a 3-shot graph "
                  f"will render the last prompt {3 - n} extra time(s) as a "
                  f"continuation.", flush=True)
        elif n > 3:
            print(f"[H3ScriptSplit] script has {n} shots; a 3-shot graph "
                  f"DROPS shot(s) 4+. Trim the script or wait for the "
                  f"dynamic-count workflow.", flush=True)
        while len(shots) < 4:
            shots.append(shots[-1])
        return (shots[0], shots[1], shots[2], shots[3], n)


# ---------------------------------------------------------------------------
# AUTO ACTIVATION RESERVE
#
# VRAM has two tenants with opposite tolerance for being remote. WEIGHTS
# stream well: sequential, known order, prefetched behind ~50s of compute per
# step, so 20GB offloaded costs well under a second. The ALLOCATOR POOL
# (activations) does not stream: it is random-access and re-touched all step,
# and when it does not fit, the driver evicts blind mid-step. Measured on a
# 3090: starving the pool by ~3GB = 533 s/it vs 99 s/it. Measured on a 5090:
# 168W at "99% utilisation" - a card waiting, not computing.
#
# So the correct split is reserve >= pool, and stream whatever weights do not
# fit - overshooting is nearly free, undershooting is 5-10x. The pool scales
# with the render shape, which is why any hand-set number (a GB figure, a
# memory_usage_factor) is correct for exactly one resolution and a trap at
# every other: LOWER the resolution with a fixed factor and the reserve
# shrinks below the pool - the render gets SLOWER, the opposite of what any
# person expects.
#
# This engine removes the knob:
#   - memory_required(input_shape) is overridden with a function of the
#     ACTUAL shape comfy passes at load time - never a constant.
#   - Unmeasured shapes reserve 60% of currently-free VRAM: generous enough
#     to be cliff-proof at any resolution, and only slightly slower than
#     optimal (a few more GB of weights stream).
#   - Our samplers measure the true allocator peak of every run and cache it
#     per (GPU, model, shape-cells) in the user dir. From the second run at
#     a shape, the reserve is measured * 1.25 - per machine, no telemetry to
#     read, no number to know.
# ---------------------------------------------------------------------------

_AUTO_FLOOR = 8 * 1024**3          # never reserve less: workspaces + margin
# First-run fraction of free VRAM. Deliberately HIGH: over-reserving merely
# streams more weights (<1s/step behind 50-100s of compute), while
# under-reserving is the 5-10x cliff. 0.60 was calibrated on a 32GB card and
# proved WRONG on a 24GB one: 60% of the 3090's 21.9GB free = 13.2GB against
# a ~17.5GB pool -> max_reserved 25.06GB on a 24GB card -> 492 s/it. At 0.88
# the same card reserves 19.3GB and streams the difference. Measurement then
# tightens DOWN from the safe side.
_AUTO_FRACTION = 0.88              # unmeasured shapes: fraction of free VRAM
_AUTO_WEIGHT_NUCLEUS = 2 * 1024**3  # always leave a little room for weights
_AUTO_MARGIN = 1.25                # measured pool -> reserve headroom
_auto_cache = None                 # lazy {key: pool_bytes}
_auto_last = {"key": None, "model": None}   # what the next sampling run is
_auto_session = {}                 # key -> reserve pinned for this session
_auto_ctx = {"refsig": ""}         # conditioning that lengthens the sequence


def _auto_cache_path():
    try:
        import folder_paths
        base = folder_paths.get_user_directory()
    except Exception:
        import os
        base = os.path.dirname(os.path.abspath(__file__))
    import os
    return os.path.join(base, "h3_auto_reserve.json")


def _auto_cache_load():
    global _auto_cache
    if _auto_cache is None:
        import io as _io, os
        _auto_cache = {}
        p = _auto_cache_path()
        if os.path.isfile(p):
            try:
                _auto_cache = json.load(_io.open(p, encoding="utf-8"))
            except Exception:
                _auto_cache = {}
    return _auto_cache


def _auto_cache_store(key, pool_bytes):
    cache = _auto_cache_load()
    prev = cache.get(key, 0)
    # keep the largest pool ever seen for the shape; shrinking on a lucky
    # run risks the cliff on the next unlucky one
    if pool_bytes <= prev:
        return
    cache[key] = int(pool_bytes)
    try:
        import io as _io
        _io.open(_auto_cache_path(), "w", encoding="utf-8").write(
            json.dumps(cache, indent=1))
    except Exception as e:
        print(f"[H3AutoReserve] cache write failed ({e}) - measurements "
              f"will not persist across restarts", flush=True)


def _auto_key(model_name, cells):
    try:
        import torch
        dev = torch.cuda.get_device_name(0)
    except Exception:
        dev = "cpu"
    import os
    stem = os.path.splitext(os.path.basename(model_name))[0]
    # Reference rows lengthen the packed sequence without changing the target
    # latent shape, so `cells` alone cannot tell a ref run from a plain one -
    # replaying a plain measurement on a ref run under-reserves and thrashes.
    # Empty for plain runs, so cache entries written before refs existed hit.
    return f"{dev}|{stem}|{cells}{_auto_ctx['refsig']}"


def _install_auto_reserve(patcher, model_name):
    """Shape-aware memory_required on the BaseModel (clone-safe)."""

    def memory_required(input_shape, *args, **kwargs):
        cells = 1
        try:
            for d in list(input_shape)[1:]:
                cells *= int(d)
        except Exception:
            cells = 0
        key = _auto_key(model_name, cells)
        _auto_last["key"] = key
        # comfy (and DynamicVRAM) call memory_required repeatedly - per load
        # AND per sampling step. The answer must be STABLE for a shape:
        # recomputing "60% of free" as free shrinks is a feedback loop
        # (reserving memory reduces free, which reduces the next answer).
        # Pin the first computation per (model, shape) for the session;
        # a fresh measurement invalidates the pin.
        pinned = _auto_session.get(key)
        if pinned is not None:
            return pinned
        measured = _auto_cache_load().get(key)
        try:
            import comfy.model_management as mm
            free = mm.get_free_memory(mm.get_torch_device())
        except Exception:
            free = 24 * 1024**3
        # A reserve larger than the currently free VRAM is not useful: on
        # DynamicVRAM it can force an impossible streaming plan and make a
        # later identical clip fail although the previous one succeeded.
        ceiling = max(int(free - _AUTO_WEIGHT_NUCLEUS), _AUTO_FLOOR)
        if measured:
            wanted = max(int(measured * _AUTO_MARGIN), _AUTO_FLOOR)
            reserve = min(wanted, ceiling)
            how = (f"measured pool {measured/2**30:.1f} GB x {_AUTO_MARGIN}, "
                   f"capped to free VRAM - {_AUTO_WEIGHT_NUCLEUS/2**30:.0f} GB")
        else:
            reserve = max(int(min(free * _AUTO_FRACTION,
                                  free - _AUTO_WEIGHT_NUCLEUS)),
                          _AUTO_FLOOR)
            reserve = min(reserve, ceiling)
            how = f"first run at this shape: {_AUTO_FRACTION:.0%} of free"
        _auto_session[key] = reserve
        print(f"[H3AutoReserve] shape cells={cells}: reserving "
              f"{reserve/2**30:.1f} GB ({how})", flush=True)
        return reserve

    patcher.model.memory_required = memory_required
    patcher.memory_required = memory_required
    _auto_last["model"] = model_name


def _auto_measure_begin():
    """Call right before sampling: snapshot the allocator."""
    try:
        import torch
        torch.cuda.reset_peak_memory_stats()
        return torch.cuda.memory_reserved()
    except Exception:
        return None


def _auto_measure_end(before, patcher=None):
    """Call right after sampling: cache the pool this shape really used.

    The DiT loads INSIDE the sampling call, so the raw reserved delta counts
    resident weights as pool - subtract what the patcher actually has loaded
    or the cache learns a number ~10-20GB too big and auto never tightens.
    """
    if before is None or _auto_last["key"] is None:
        return
    try:
        import torch
        peak = torch.cuda.max_memory_reserved()
        loaded = 0
        try:
            loaded = int(patcher.loaded_size()) if patcher is not None else 0
        except Exception:
            try:
                loaded = int(getattr(patcher.model,
                                     "model_loaded_weight_memory", 0))
            except Exception:
                loaded = 0
        pool = peak - before - loaded
        if pool > 512 * 1024**2:            # ignore no-op runs
            _auto_cache_store(_auto_last["key"], pool)
            _auto_session.pop(_auto_last["key"], None)   # re-pin from measured
            print(f"[H3AutoReserve] measured pool {pool/2**30:.1f} GB for "
                  f"this shape (peak {peak/2**30:.1f} - weights "
                  f"{loaded/2**30:.1f}) - next run requests "
                  f"{max(pool*_AUTO_MARGIN, _AUTO_FLOOR)/2**30:.1f} GB before the free-VRAM cap",
                  flush=True)
    except Exception:
        pass


class H3ModelLoaderAny:
    """One dropdown, both formats: .safetensors loads through comfy core,
    .gguf routes through ComfyUI-GGUF (patched for minimax_h3). Keeps the
    published workflow at exactly one loader node."""

    @classmethod
    def INPUT_TYPES(cls):
        import folder_paths
        import os
        files = folder_paths.get_filename_list("diffusion_models")
        gguf = []
        for d in folder_paths.get_folder_paths("diffusion_models"):
            if not os.path.isdir(d):
                continue
            # RECURSIVE: .gguf is not in supported_pt_extensions so
            # get_filename_list never returns it, and a flat listdir misses
            # anything filed under diffusion_models/gguf/.
            for root, _dirs, fs in os.walk(d):
                for f in fs:
                    if f.lower().endswith(".gguf"):
                        gguf.append(os.path.relpath(os.path.join(root, f), d))
        names = sorted(set(files) | set(gguf))
        return {"required": {"model_name": (names, {
            "tooltip": "safetensors or GGUF - loader routes automatically."})},
            "optional": {"activation_reserve_gb": ("FLOAT", {
                "default": 0.0, "min": 0.0, "max": 128.0, "step": 0.5,
                "tooltip": "0 = AUTO (recommended). The pack sizes the "
                "activation reserve for the actual render shape, measures the "
                "real peak each run, and tightens itself per machine - lower "
                "resolutions get faster automatically. Set a number only to "
                "pin the reserve by hand; that number is for ONE resolution "
                "and the wrong number is 5-10x slower, not a little slower."})}}

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "load"
    CATEGORY = "loaders/minimax"

    def load(self, model_name, activation_reserve_gb=0.0):
        out = self._load_inner(model_name)
        patcher = out[0]
        if activation_reserve_gb and activation_reserve_gb > 0:
            _cap = int(activation_reserve_gb * (1024 ** 3))
            # Must live on the inner BaseModel, not the ModelPatcher: LoRA
            # stacks and guiders clone() the patcher before sampling and an
            # instance attribute does not survive the clone, silently
            # restoring comfy's estimate. Clones share this BaseModel.
            patcher.model.memory_required = lambda *a, _c=_cap, **k: _c
            patcher.memory_required = lambda *a, _c=_cap, **k: _c
            print(f"[H3ModelLoader] activation reserve PINNED at "
                  f"{activation_reserve_gb:.1f} GB (manual - correct for one "
                  f"resolution only; 0 = auto adapts to any)", flush=True)
        else:
            _install_auto_reserve(patcher, model_name)
        return out

    def _load_inner(self, model_name):
        import folder_paths
        if model_name.lower().endswith(".gguf"):
            # resolve the live UnetLoaderGGUF from the global registry -
            # custom node packages load under mangled module names, so the
            # registry is the only stable handle.
            import nodes as core_nodes
            cls = core_nodes.NODE_CLASS_MAPPINGS.get("UnetLoaderGGUF")
            if cls is None:
                raise RuntimeError(
                    "ComfyUI-GGUF not loaded - install/enable it and restart.")
            # ComfyUI-GGUF rejects unknown architectures before reading any
            # tensor, and upstream does not know minimax_h3. Import-time
            # patching covers the packaged install; re-assert here in case
            # ComfyUI-GGUF loaded after us. The relative import only exists
            # in the packaged install - LOOSE-FILE installs (this file
            # dropped straight into custom_nodes/) have no parent package,
            # so fall back to doing the patch inline.
            try:
                from .h3_gguf_arch import ensure_minimax_arch
                ensure_minimax_arch()
            except ImportError:
                import sys as _sys
                for _m in list(_sys.modules.values()):
                    try:
                        if (_m is not None
                                and isinstance(getattr(_m, "IMG_ARCH_LIST",
                                                       None), set)
                                and hasattr(_m, "TXT_ARCH_LIST")):
                            if "minimax_h3" not in _m.IMG_ARCH_LIST:
                                _m.IMG_ARCH_LIST.add("minimax_h3")
                                print("[H3ModelLoader] taught ComfyUI-GGUF "
                                      "the 'minimax_h3' architecture (in "
                                      "memory, loose-file fallback)",
                                      flush=True)
                            break
                    except Exception:
                        continue
            return cls().load_unet(model_name)
        import comfy.sd
        path = folder_paths.get_full_path_or_raise("diffusion_models", model_name)
        return (comfy.sd.load_diffusion_model(path),)


def _sampler_names():
    """From core, so the list cannot rot out of step with ComfyUI."""
    try:
        import comfy.samplers
        return list(comfy.samplers.KSampler.SAMPLERS)
    except Exception:
        return ["res_multistep", "euler", "dpmpp_2m"]


def _scheduler_names():
    try:
        import comfy.samplers
        return list(comfy.samplers.KSampler.SCHEDULERS)
    except Exception:
        return ["simple", "normal", "beta"]


class H3ClipLoaderAny:
    """One dropdown for text encoders, both formats: .safetensors through
    comfy core CLIPLoader, .gguf through ComfyUI-GGUF's CLIPLoaderGGUF
    (which auto-pairs a matching -mmproj sidecar for vision)."""

    @classmethod
    def INPUT_TYPES(cls):
        import os
        import folder_paths
        files = set(folder_paths.get_filename_list("text_encoders"))
        for d in folder_paths.get_folder_paths("text_encoders"):
            if not os.path.isdir(d):
                continue
            # RECURSIVE, same reason as the model loader above.
            for root, _dirs, fs in os.walk(d):
                for f in fs:
                    if f.lower().endswith(".gguf") and "mmproj" not in f.lower():
                        files.add(os.path.relpath(os.path.join(root, f), d))
        import nodes as core_nodes
        types = core_nodes.CLIPLoader.INPUT_TYPES()["required"]["type"]
        return {"required": {
            "clip_name": (sorted(files), {
                "tooltip": "safetensors or GGUF - routed automatically. GGUF "
                           "encoders auto-pair their -mmproj vision sidecar."}),
            "type": types,
        }}

    RETURN_TYPES = ("CLIP",)
    FUNCTION = "load"
    CATEGORY = "loaders/minimax"

    # llama.cpp/qwen2vl-era names -> the H3 encoder's exact visual.* layout
    # (established 2026-08-04 against the official int8 file). Ordered, and
    # chosen so no rule can re-hit another rule's output.
    _VISION_FIXES = [
        ("visual.merger.ln_q.", "visual.merger.norm."),
        ("attn_qkv.", "attn.qkv."),
        ("mlp.up_proj.", "mlp.linear_fc1."),
        ("mlp.down_proj.", "mlp.linear_fc2."),
        (".fc1.", ".linear_fc1."),
        (".fc2.", ".linear_fc2."),
        ("v.position_embd.weight", "visual.pos_embed.weight"),
    ]

    def load(self, clip_name, type):
        import re
        import sys
        import nodes as core_nodes
        if not clip_name.lower().endswith(".gguf"):
            return core_nodes.CLIPLoader().load_clip(clip_name, type=type)

        gg_cls = core_nodes.NODE_CLASS_MAPPINGS.get("CLIPLoaderGGUF")
        if gg_cls is None:
            raise RuntimeError(
                "ComfyUI-GGUF not loaded - install/enable it and restart.")
        gg = sys.modules[gg_cls.__module__]
        # gguf_mmproj_loader lives in their loader module, which nodes.py
        # does not re-export - resolve it from where gguf_clip_loader is
        # actually defined.
        gg_loader = sys.modules[gg.gguf_clip_loader.__module__]

        import folder_paths
        import comfy.sd
        import comfy.model_management
        clip_path = folder_paths.get_full_path("clip", clip_name)

        # --- text side: their mapper, then truncate to the official H3
        # shape (Qwen3-VL-32B cut to 50 layers; no final norm, no lm_head).
        sd = gg.gguf_clip_loader(clip_path)
        drop = re.compile(r"model\.layers\.(5[0-9]|6[0-9])\.")
        sd = {k: v for k, v in sd.items()
              if not drop.match(k) and k not in ("model.norm.weight",
                                                 "lm_head.weight")}

        # --- vision side: their sidecar loader, then correct the names to
        # H3's layout (their map is qwen2vl-era: wrong merger keys, missing
        # deepstack and qkv rules).
        vsd = gg_loader.gguf_mmproj_loader(clip_path)
        if not vsd:
            raise RuntimeError(
                f"No -mmproj sidecar found next to '{clip_name}'. The H3 "
                f"encoder NEEDS its vision tower (image refs / chaining) - "
                f"keep the mmproj file in the same folder.")
        # merger mlp indices -> linear_fc1/2 by ascending index
        idxs = sorted({m.group(1) for k in vsd
                       for m in [re.match(r"visual\.merger\.mlp\.(\d+)\.", k)]
                       if m})
        # deepstack mergers: llama.cpp indexes them by the vision layer they
        # tap (8/16/24), the H3 encoder by list position (0/1/2) - remap
        # ascending, and sort NUMERICALLY (lexically 16 < 8).
        ds = sorted({int(m.group(1)) for k in vsd
                     for m in [re.match(r"v\.deepstack\.(\d+)\.", k)]
                     if m})
        fixed = {}
        for k, v in vsd.items():
            for i, name in zip(idxs, ("linear_fc1", "linear_fc2")):
                k = k.replace(f"visual.merger.mlp.{i}.",
                              f"visual.merger.{name}.")
            for pos, layer in enumerate(ds):
                k = k.replace(f"v.deepstack.{layer}.",
                              f"visual.deepstack_merger_list.{pos}.")
            for a, b in self._VISION_FIXES:
                k = k.replace(a, b)
            fixed[k] = v
        sd.update(fixed)

        clip = comfy.sd.load_text_encoder_state_dicts(
            clip_type=getattr(comfy.sd.CLIPType, type.upper(),
                              comfy.sd.CLIPType.STABLE_DIFFUSION),
            state_dicts=[sd],
            model_options={
                "custom_operations": gg.GGMLOps,
                "initial_device":
                    comfy.model_management.text_encoder_offload_device(),
            },
            embedding_directory=folder_paths.get_folder_paths("embeddings"),
        )
        clip.patcher = gg.GGUFModelPatcher.clone(clip.patcher)
        return (clip,)


class H3AudioTrimStart:
    """Trim N seconds off the FRONT of an audio clip. Exists so the multishot
    master can drop each chained shot's duplicated first frame (1/24s) from
    video AND audio together, keeping lip sync exact across seams."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "audio": ("AUDIO",),
            "seconds": ("FLOAT", {"default": 0.04167, "min": 0.0, "max": 10.0,
                                  "step": 0.00001}),
        }}

    RETURN_TYPES = ("AUDIO",)
    FUNCTION = "trim"
    CATEGORY = "audio"

    def trim(self, audio, seconds):
        sr = audio["sample_rate"]
        wav = audio["waveform"]
        n = int(round(seconds * sr))
        return ({"sample_rate": sr, "waveform": wav[..., n:]},)


_REF_IMAGE_TIP = (
    "IDENTITY ANCHOR carried into EVERY shot as a reference image. Unlike "
    "start_image (which becomes the first FRAME of shot 1 and then survives "
    "only by being chained forward), a reference is re-read at every step of "
    "every shot, so the identity does not drift down the chain. Bind it in "
    "each shot's prompt by its marker: ref_image_0 is <Picture 1>, "
    "ref_image_1 is <Picture 2>, and so on - the node prints the full marker "
    "map at the start of the render. NOTE: reference rows were trained on the "
    "ref2va checkpoint; fl2va was not trained with them.")


class H3MultishotSampler:
    """The whole multishot pipeline in one node: parse script, loop shots,
    chain each shot's last frame into the next shot's first_frame, seam-trim,
    and return master frames + master audio. shot_count is REAL here: N shots
    means N sampled shots, no wasted execution.

    JoyEcho architecture applied to H3: multishot complexity lives inside the
    node so the canvas stays legible."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",),
            "clip": ("CLIP",),
            "video_vae": ("VAE",),
            "audio_vae": ("VAE",),
            "script": ("STRING", {
                "multiline": True, "dynamicPrompts": False,
                "default": "Shot 1 prompt goes here.\n---\n"
                           "Shot 2 prompt goes here.\n---\n"
                           "Shot 3 prompt goes here.",
                "tooltip": "One prompt per shot, separated by --- on its own "
                           "line. JSON {\"prompts\": [...]} also accepted."}),
            "shot_count": ("INT", {
                "default": 0, "min": 0, "max": 8,
                "tooltip": "0 = one shot per script prompt. 1-8 forces the "
                           "count: extra prompts drop, missing ones continue "
                           "the last prompt. Every shot renders - this is "
                           "the real thing here."}),
            "width": ("INT", {"default": 768, "min": 32, "max": 4096,
                              "step": 32}),
            "height": ("INT", {"default": 1344, "min": 32, "max": 4096,
                               "step": 32}),
            "frames_per_shot": ("INT", {
                "default": 243, "min": 5, "max": 719, "step": 17,
                "tooltip": "Frames at 24fps on H3's 17k+5 grid (243 = ~10.1s;"
                           " 362 = trained max ~15.1s; 719 = experimental "
                           "~30s single pass; beyond 362 is untrained)."}),
            "seed": ("INT", {"default": 0, "min": 0,
                             "max": 0xffffffffffffffff,
                             "control_after_generate": True}),
            "steps": ("INT", {"default": 20, "min": 1, "max": 50}),
            "seed_per_shot": ("BOOLEAN", {
                "default": True, "label_on": "vary per shot",
                "label_off": "same seed every shot",
                "tooltip": "Leave ON. Measured: varying the seed per shot holds the "
                           "face across the chain; using one seed for every shot "
                           "made BOTH the face and the voice drift. Identity "
                           "lives in the conditioning, not the seed."}),
        },
        "optional": {
            "start_image": ("IMAGE", {
                "tooltip": "Optional first frame (I2V). Shot 1 starts from this "
                           "image; later shots continue chaining from the "
                           "previous shot's last frame as usual. Leave "
                           "unconnected for pure text-to-video."}),
            "voice_ref": ("AUDIO", {
                "tooltip": "Optional VOICE ANCHOR carried into EVERY shot as a "
                           "reference audio (<Audio 1>). Feed a clean solo "
                           "line of the character - e.g. a slice of stage A's "
                           "output - and the voice is PINNED across the chain "
                           "instead of re-performed from text (verified: "
                           "control drifted, voice-ref held). Bind it in each "
                           "shot's prompt: 'Her voice is the voice in "
                           "<Audio 1>.' Works with keyframe chaining via the "
                           "refs+keyframes merge patch. NOTE: verified on the "
                           "ref2va checkpoint; fl2va was not trained with "
                           "reference rows, so wire the ref2va model when "
                           "using this."}),
            "sampler_name": (_sampler_names(), {
                "default": "res_multistep",
                "tooltip": "Sampling algorithm. res_multistep is the default "
                           "and what every measurement in the docs used."}),
            "scheduler": (_scheduler_names(), {
                "default": "simple",
                "tooltip": "Sigma schedule. simple is the default and what "
                           "the docs measured."}),
            "ref_image_0": ("IMAGE", {"tooltip": _REF_IMAGE_TIP}),
            "ref_image_1": ("IMAGE", {"tooltip": _REF_IMAGE_TIP}),
            "ref_image_2": ("IMAGE", {"tooltip": _REF_IMAGE_TIP}),
            "ref_image_3": ("IMAGE", {"tooltip": _REF_IMAGE_TIP}),
            "ref_audio_0": ("AUDIO", {
                "tooltip": "Extra standalone reference audio, after voice_ref. "
                           "A reference-video soundtrack consumes an <Audio j> "
                           "slot first, matching the native reference node."}),
            "ref_audio_1": ("AUDIO", {"tooltip": "Another standalone reference audio."}),
            "ref_video_0": ("IMAGE", {
                "tooltip": "Reference VIDEO (a batch of frames at 24 fps, "
                           "2-15s) bound to <Video 1>. Expensive: its rows ride "
                           "every sampling step for every shot - a 5s ref video "
                           "costs far more sequence than four ref images. On 16 "
                           "GB, start without it."}),
            "ref_video_audio_0": ("AUDIO", {
                "tooltip": "Soundtrack of ref_video_0. Gets its own <Audio j> "
                           "label emitted just before <Video 1>."}),
            "ref_image_size": (["match", "max"], {
                "default": "match",
                "tooltip": "Reference image sizing. 'match' scales each ref "
                           "(down only, keeping aspect) to the generation's "
                           "pixel area; 'max' uses the 2048px short edge for "
                           "best identity fidelity. Reference tokens ride "
                           "through every step of every shot, so 'max' can be "
                           "several times slower and is what to drop first if "
                           "the render OOMs."}),
            "stream_to_disk": ("BOOLEAN", {
                "default": False,
                "label_on": "LOW RAM - disk backed",
                "label_off": "FAST - keep frames in RAM",
                "tooltip": "OFF preserves the original behaviour. ON writes "
                           "each decoded shot into a temporary memory-mapped "
                           "file and returns a disk-backed IMAGE batch. Use for "
                           "long masters (for example 6 x 10s) so completed "
                           "shots do not accumulate in RAM. CreateVideo and "
                           "SaveVideo remain connected exactly as before."}),
            "ref_image_4": ("IMAGE", {"tooltip": _REF_IMAGE_TIP}),
            "ref_image_5": ("IMAGE", {"tooltip": _REF_IMAGE_TIP}),
            "ref_image_6": ("IMAGE", {"tooltip": _REF_IMAGE_TIP}),
            "ref_image_7": ("IMAGE", {"tooltip": _REF_IMAGE_TIP}),
            "ref_image_8": ("IMAGE", {"tooltip": _REF_IMAGE_TIP}),
        }}

    RETURN_TYPES = ("IMAGE", "AUDIO", "INT")
    RETURN_NAMES = ("master_frames", "master_audio", "shots_rendered")
    FUNCTION = "run"
    CATEGORY = "sampling/minimax"

    def run(self, model, clip, video_vae, audio_vae, script, shot_count,
            width, height, frames_per_shot, seed, steps,
            seed_per_shot=False, start_image=None, voice_ref=None,
            sampler_name="res_multistep", scheduler="simple",
            ref_image_0=None, ref_image_1=None, ref_image_2=None,
            ref_image_3=None, ref_audio_0=None, ref_audio_1=None,
            ref_video_0=None, ref_video_audio_0=None,
            ref_image_size="match", stream_to_disk=False,
            ref_image_4=None, ref_image_5=None, ref_image_6=None,
            ref_image_7=None, ref_image_8=None):
        import torch
        import node_helpers
        from comfy_extras import nodes_custom_sampler as ncs
        from comfy_extras import nodes_minimax_h3 as mmh3
        from comfy_extras.nodes_audio import vae_decode_audio

        # --- references: encode ONCE, ride in EVERY shot's conditioning -------
        # The whole point of the reference path: start_image only reaches shot 1
        # and then survives by being chained frame-to-frame, so identity drifts
        # on the far shots. Reference rows are re-read at every step of every
        # shot, so shot 3 sees the same anchor shot 1 did. Encoding is done once
        # here and the blocks are reused verbatim - on 16 GB, re-encoding per
        # shot would be pure waste.
        bank = h3_refs.build_ref_bank(
            video_vae, audio_vae, width, height, frames_per_shot,
            ref_image_size,
            ref_images=(ref_image_0, ref_image_1, ref_image_2, ref_image_3,
                        ref_image_4, ref_image_5, ref_image_6, ref_image_7,
                        ref_image_8),
            voice_ref=voice_ref,
            ref_audios=(ref_audio_0, ref_audio_1),
            ref_video=ref_video_0,
            ref_video_audio=ref_video_audio_0)
        _auto_ctx["refsig"] = ""
        if bank:
            print(bank.marker_map(), flush=True)
            print(f"[H3Refs] {len(bank.blocks)} reference block(s) add "
                  f"~{h3_refs.estimated_extra_rows(bank)} packed rows to every "
                  f"step of every shot.", flush=True)
            if not bank.legacy_voice_only:
                print("[H3Refs] chain frames are payload keyframes and do not "
                      "consume <Picture i> markers; bindings stay identical "
                      "on every shot.", flush=True)

        shots = _parse_script(script)
        n = shot_count if shot_count > 0 else len(shots)
        if len(shots) > n:
            print(f"[H3Multishot] dropping {len(shots) - n} extra script "
                  f"prompt(s) (shot_count={n}).", flush=True)
            shots = shots[:n]
        while len(shots) < n:
            print(f"[H3Multishot] shot {len(shots) + 1} continues the last "
                  f"prompt (script had fewer prompts than shot_count).",
                  flush=True)
            shots.append(shots[-1])

        sigmas = ncs.BasicScheduler().get_sigmas(model, scheduler, steps, 1.0)[0]
        sampler = ncs.KSamplerSelect().get_sampler(sampler_name)[0]

        frame_store = _MasterFrameStore(
            torch, stream_to_disk, n * frames_per_shot, width, height)
        audio_parts = []
        sr = None
        prev_last = None
        if start_image is not None:
            # I2V: seed the chain so shot 1 uses the supplied frame as its
            # keyframe, exactly the way later shots use the previous shot's
            # last frame. No seam trim on shot 1 - that frame is wanted.
            prev_last = start_image[:1]
            print("[H3Multishot] I2V: shot 1 starts from the supplied image.",
                  flush=True)
        for si, prompt in enumerate(shots):
            shot_bank, prompt, _active_pictures = (
                h3_refs.prepare_shot_bank(bank, prompt))
            print(f"[H3Multishot] shot {si + 1}/{n} "
                  f"({frames_per_shot}f @ {width}x{height})...", flush=True)
            latent, frame_count = mmh3._empty_av_latent(
                width, height, frames_per_shot)
            images, keyframes = [], []
            if prev_last is not None:
                img = mmh3._resize(prev_last[:1], width, height, "disabled")
                images.append(img)
                keyframes.append({"resolved_frame_index": 0, "image": img})
            if shot_bank:
                # New refs mirror the measured H3KeyframeInject path: Qwen sees
                # only refs and H3AVBank merges the chain keyframe payload-side.
                # voice_ref-only retains its exact historical item order.
                items = h3_refs.compose_shot_items(shot_bank, images)
                tokens = clip.tokenize(prompt, minimax_ref_items=items)
            else:
                # Preserve the original no-reference path byte-for-byte.
                tokens = clip.tokenize(prompt, images=images)
            cond = clip.encode_from_tokens_scheduled(tokens)
            if keyframes:
                for kf in keyframes:
                    kf["latent"] = video_vae.encode(kf.pop("image"))
                cond = node_helpers.conditioning_set_values(cond, {
                    "minimax_keyframes": keyframes,
                    "minimax_frame_count": frame_count,
                })
            if shot_bank:
                cond = node_helpers.conditioning_set_values(cond, {
                    "minimax_refs": shot_bank.blocks,
                })
            # --- free the text encoder before the DiT loads -----------------
            # The 32B VL encoder (~16.5GB even at Q4) and the H3 DiT (~25GB) do
            # not co-fit on a 32GB card: without this the DiT loads PARTIALLY and
            # streams ~19GB from system RAM every step (60min vs ~15min renders).
            # Conditioning is already computed above, so the encoder weights are
            # safe to evict here; they reload next shot (chained prompts need it).
            # MULTI-GPU (issue #8, @VladiCz): when the TE lives on a DIFFERENT
            # device than the DiT there is nothing to reclaim - evicting just
            # forces a full TE reload every shot (measured: a third of the
            # whole render). Skip the eviction entirely in that case.
            import comfy.model_management as _mm
            _te_dev = getattr(clip.patcher, "load_device", None)
            _dit_dev = getattr(model, "load_device", None)
            if (_te_dev is not None and _dit_dev is not None
                    and str(_te_dev) != str(_dit_dev)):
                if si == 0:
                    print(f"[H3Multishot] TE on {_te_dev}, DiT on {_dit_dev} "
                          f"- separate devices, TE stays resident (no "
                          f"per-shot reload).", flush=True)
            else:
                try:
                    clip.patcher.model.to(_mm.text_encoder_offload_device())
                except Exception as _e:
                    print(f"[H3Multishot] TE offload skipped: {_e}", flush=True)
                try:
                    _dev = _mm.get_torch_device()
                    _mm.free_memory(_mm.get_total_memory(_dev) * 0.9, _dev)
                    _mm.soft_empty_cache()
                    _free = _mm.get_free_memory(_dev) / (1024 ** 3)
                    print(f"[H3Multishot] TE evicted; {_free:.1f} GB free "
                          f"for the DiT", flush=True)
                except Exception as _e:
                    print(f"[H3Multishot] VRAM purge skipped: {_e}", flush=True)
            # ----------------------------------------------------------------
            guider = ncs.BasicGuider().get_guider(model, cond)[0]
            shot_seed = (seed + si) if seed_per_shot else seed
            noise = ncs.RandomNoise().get_noise(shot_seed)[0]
            _auto_ctx["refsig"] = shot_bank.signature()
            _mb = _auto_measure_begin()
            try:
                out, _denoised = ncs.SamplerCustomAdvanced().sample(
                    noise, guider, sampler, sigmas, latent)
            finally:
                # record even on interrupt/OOM: the peak up to that moment is
                # a valid LOWER bound on the pool, and the cache only grows -
                # an aborted thrashing run should still teach the next one
                _auto_measure_end(_mb, model)
                # Do not leak a ref-specific reserve key into other H3 nodes
                # that may sample the same model after this multishot run.
                _auto_ctx["refsig"] = ""

            lat = out["samples"]
            if getattr(lat, "is_nested", False):
                lat = lat.unbind()[0]        # AV pair: [0]=video, [-1]=audio
            imgs = video_vae.decode(lat)
            if imgs.ndim == 5:
                imgs = imgs.reshape(-1, imgs.shape[-3], imgs.shape[-2],
                                    imgs.shape[-1])
            aud = vae_decode_audio(audio_vae, out)
            sr = aud["sample_rate"]
            wav = aud["waveform"]

            prev_last = imgs[-1:].clone()
            if si > 0:
                imgs = imgs[1:]                       # duplicated seam frame
                trim = int(round(sr / 24.0))          # matching 1/24s audio
                wav = wav[..., trim:]
            frame_store.append(imgs)
            audio_parts.append(wav.cpu())
            if stream_to_disk:
                del imgs, lat, out, aud, wav, _denoised
                del noise, guider, cond, latent, tokens, images, keyframes

        master = frame_store.finish()
        waveform = _xfade_audio(audio_parts, sr)
        print(f"[H3Multishot] done: {n} shots, {master.shape[0]} frames "
              f"(~{master.shape[0] / 24.0:.1f}s).", flush=True)
        return (master, {"waveform": waveform, "sample_rate": sr}, n)



class H3MultishotMemorySampler:
    """Long-form multishot with a memory bank.

    Stock chaining shows each shot exactly ONE image: the previous shot's last
    frame. Over 12-30 shots (2-5 minute videos) identity drifts, because every
    hop can only see one hop back.

    This node separates two jobs that stock chaining conflates:

      * KEYFRAME - what the video physically continues from (always the most
                   recent frame, so seams stay smooth).
      * MEMORY   - what the encoder LOOKS AT for identity/context: a persistent
                   anchor from the start of the piece plus the last N shot-end
                   frames. The anchor never changes, so drift cannot compound.

    H3's encoder takes multiple images natively (<Picture 1..N>), so this uses
    the model's own mechanism, just deeper.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",),
            "clip": ("CLIP",),
            "video_vae": ("VAE",),
            "audio_vae": ("VAE",),
            "script": ("STRING", {
                "multiline": True, "dynamicPrompts": False,
                "default": "Shot 1 prompt goes here.\n---\nShot 2 prompt goes here.",
                "tooltip": "One prompt per shot, '---' between shots."}),
            "shot_count": ("INT", {"default": 0, "min": 0, "max": 64,
                "tooltip": "0 = one shot per prompt in the script."}),
            "width": ("INT", {"default": 960, "min": 32, "max": 4096, "step": 16}),
            "height": ("INT", {"default": 544, "min": 32, "max": 4096, "step": 16}),
            "frames_per_shot": ("INT", {"default": 243, "min": 5, "max": 1000,
                "tooltip": "Snaps to H3's 17k+5 grid. 243 = ~10.1s @24fps."}),
            "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            "steps": ("INT", {"default": 20, "min": 1, "max": 50}),
            "seed_per_shot": ("BOOLEAN", {
                "default": True, "label_on": "vary per shot",
                "label_off": "same seed every shot",
                "tooltip": "Leave ON. Measured: varying the seed per shot holds the "
                           "face across the chain; using one seed for every shot "
                           "made BOTH the face and the voice drift. Identity "
                           "lives in the conditioning, not the seed."}),
            "memory_frames": ("INT", {"default": 2, "min": 0, "max": 6,
                "tooltip": "Recent shot-end frames the encoder sees. 0 = stock."}),
            "anchor_frames": ("INT", {"default": 1, "min": 0, "max": 2,
                "tooltip": "Persistent frame(s) from the START, shown to every "
                           "shot. This is what stops identity drift on long "
                           "chains. 0 = disabled."}),
        }, "optional": {
            "start_image": ("IMAGE", {
                "tooltip": "Optional first frame (I2V). Also becomes the identity "
                           "anchor when anchor_frames > 0."}),
            "sampler_name": (_sampler_names(), {
                "default": "res_multistep",
                "tooltip": "Sampling algorithm. res_multistep is the default "
                           "and what every measurement in the docs used."}),
            "scheduler": (_scheduler_names(), {
                "default": "simple",
                "tooltip": "Sigma schedule. simple is the default and what "
                           "the docs measured."}),
            "stream_to_disk": ("BOOLEAN", {
                "default": False,
                "label_on": "LOW RAM - disk backed",
                "label_off": "FAST - keep frames in RAM",
                "tooltip": "Write each completed shot to a temporary "
                           "memory-mapped frame buffer instead of retaining all "
                           "shots in RAM. The IMAGE/AUDIO outputs and downstream "
                           "video nodes remain unchanged."}),
        }}

    RETURN_TYPES = ("IMAGE", "AUDIO", "INT")
    RETURN_NAMES = ("master_frames", "master_audio", "shots_rendered")
    FUNCTION = "run"
    CATEGORY = "sampling/minimax"

    def run(self, model, clip, video_vae, audio_vae, script, shot_count, width,
            height, frames_per_shot, seed, steps, memory_frames, anchor_frames,
            seed_per_shot=False, start_image=None,
            sampler_name="res_multistep", scheduler="simple",
            stream_to_disk=False):
        import torch
        import node_helpers
        from comfy_extras import nodes_custom_sampler as ncs
        from comfy_extras import nodes_minimax_h3 as mmh3
        from comfy_extras.nodes_audio import vae_decode_audio
        import comfy.model_management as _mm

        shots = _parse_script(script)
        n = shot_count if shot_count > 0 else len(shots)
        if len(shots) > n:
            shots = shots[:n]
        while len(shots) < n:
            shots.append(shots[-1])

        sigmas = ncs.BasicScheduler().get_sigmas(model, scheduler, steps, 1.0)[0]
        sampler = ncs.KSamplerSelect().get_sampler(sampler_name)[0]

        frame_store = _MasterFrameStore(
            torch, stream_to_disk, n * frames_per_shot, width, height)
        audio_parts = []
        sr = None
        history = []
        anchor = start_image[:1] if start_image is not None else None
        if anchor is not None:
            print("[H3Memory] I2V: shot 1 starts from the supplied image; it is "
                  "also the identity anchor.", flush=True)

        for si, prompt in enumerate(shots):
            ctx = []
            if anchor is not None and anchor_frames > 0:
                ctx.append(anchor)
            if history:
                take = memory_frames if memory_frames > 0 else 1
                ctx.extend(history[-take:])
            images = [mmh3._resize(c[:1], width, height, "disabled") for c in ctx]

            print("[H3Memory] shot %d/%d (%df @ %dx%d) | memory: %d frame(s) "
                  "(anchor=%s, recent=%d)" % (
                      si + 1, n, frames_per_shot, width, height, len(images),
                      "yes" if (anchor is not None and anchor_frames > 0) else "no",
                      min(memory_frames, len(history)) if memory_frames > 0
                      else min(1, len(history))), flush=True)

            latent, frame_count = mmh3._empty_av_latent(width, height,
                                                        frames_per_shot)
            keyframes = []
            cont = history[-1] if history else anchor
            if cont is not None:
                kf = mmh3._resize(cont[:1], width, height, "disabled")
                keyframes.append({"resolved_frame_index": 0, "image": kf})

            tokens = clip.tokenize(prompt, images=images)
            cond = clip.encode_from_tokens_scheduled(tokens)
            if keyframes:
                for kf_ in keyframes:
                    kf_["latent"] = video_vae.encode(kf_.pop("image"))
                cond = node_helpers.conditioning_set_values(cond, {
                    "minimax_keyframes": keyframes,
                    "minimax_frame_count": frame_count,
                })

            # issue #8: separate TE device -> nothing to reclaim, keep it hot
            _te_dev = getattr(clip.patcher, "load_device", None)
            _dit_dev = getattr(model, "load_device", None)
            if (_te_dev is not None and _dit_dev is not None
                    and str(_te_dev) != str(_dit_dev)):
                if si == 0:
                    print(f"[H3Memory] TE on {_te_dev}, DiT on {_dit_dev} - "
                          f"separate devices, TE stays resident.", flush=True)
            else:
                try:
                    clip.patcher.model.to(_mm.text_encoder_offload_device())
                except Exception:
                    pass
                try:
                    _dev = _mm.get_torch_device()
                    _mm.free_memory(_mm.get_total_memory(_dev) * 0.9, _dev)
                    _mm.soft_empty_cache()
                    print("[H3Memory] TE evicted; %.1f GB free for the DiT"
                          % (_mm.get_free_memory(_dev) / (1024 ** 3)), flush=True)
                except Exception:
                    pass

            guider = ncs.BasicGuider().get_guider(model, cond)[0]
            shot_seed = (seed + si) if seed_per_shot else seed
            noise = ncs.RandomNoise().get_noise(shot_seed)[0]
            _mb = _auto_measure_begin()
            try:
                out, _denoised = ncs.SamplerCustomAdvanced().sample(
                    noise, guider, sampler, sigmas, latent)
            finally:
                # record even on interrupt/OOM: the peak up to that moment is
                # a valid LOWER bound on the pool, and the cache only grows -
                # an aborted thrashing run should still teach the next one
                _auto_measure_end(_mb, model)

            lat = out["samples"]
            if getattr(lat, "is_nested", False):
                lat = lat.unbind()[0]
            imgs = video_vae.decode(lat)
            if imgs.ndim == 5:
                imgs = imgs.reshape(-1, imgs.shape[-3], imgs.shape[-2],
                                    imgs.shape[-1])
            aud = vae_decode_audio(audio_vae, out)
            sr = aud["sample_rate"]
            wav = aud["waveform"]

            if anchor is None and anchor_frames > 0:
                anchor = imgs[:1].clone()
                print("[H3Memory] identity anchor set from shot 1 frame 1.",
                      flush=True)
            history.append(imgs[-1:].clone())
            if len(history) > 8:
                history.pop(0)

            if si > 0:
                imgs = imgs[1:]
                trim = int(round(sr / 24.0))
                wav = wav[..., trim:]
            frame_store.append(imgs)
            audio_parts.append(wav.cpu())
            if stream_to_disk:
                del imgs, lat, out, aud, wav, _denoised
                del noise, guider, cond, latent, tokens, images, keyframes, ctx

        master = frame_store.finish()
        waveform = _xfade_audio(audio_parts, sr)
        print("[H3Memory] done: %d shots, %d frames (~%.1fs)." % (
            n, master.shape[0], master.shape[0] / 24.0), flush=True)
        return (master, {"waveform": waveform, "sample_rate": sr}, n)



class H3OptionalImage:
    """An on/off gate for an OPTIONAL image input.

    A normal switch node cannot express "no image": both of its branches are
    required, so turning I2V "off" ends up feeding a placeholder (usually a
    black EmptyImage) into start_image - which is not text-to-video, it is
    video that starts from a black frame.

    This node passes the image through when enabled, and emits nothing (None)
    when disabled, which is exactly what an optional input expects.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "enabled": ("BOOLEAN", {
                    "default": True, "label_on": "image ON",
                    "label_off": "no image (T2V)",
                    "tooltip": "Off = emits nothing, so the downstream optional "
                               "input behaves as if it were unconnected."}),
            },
            "optional": {
                "image": ("IMAGE", {"tooltip": "Image to pass through when enabled."}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "gate"
    CATEGORY = "utils/minimax"
    DESCRIPTION = ("Pass an image through, or nothing at all. Use to toggle an "
                   "optional input such as start_image (I2V) without feeding a "
                   "placeholder frame.")

    def gate(self, enabled, image=None):
        if not enabled:
            print("[H3OptionalImage] disabled - passing nothing (T2V).",
                  flush=True)
            return (None,)
        if image is None:
            print("[H3OptionalImage] enabled but no image connected - passing "
                  "nothing.", flush=True)
        return (image,)


class H3AspectMegapixelSize:
    """Resolve H3 output dimensions with three predictable sizing modes."""

    _MULTIPLE = 32
    _MIN_SIZE = 32
    _MAX_SIZE = 4096
    _PIXELS_PER_MEGAPIXEL = 1024.0 * 1024.0

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "size_mode": ([
                    "manual width x height",
                    "megapixels + format",
                    "source aspect + megapixels",
                ], {
                    "default": "manual width x height",
                    "tooltip": "Manual uses Width/Height. MP + format uses the "
                               "selected aspect format. Source aspect + MP is "
                               "the backwards-compatible Picture 1 mode.",
                }),
                "manual_width": ("INT", {
                    "default": 1152, "min": 32, "max": 4096, "step": 32,
                    "tooltip": "Used in manual mode and as a safe fallback "
                               "when Picture 1 is missing.",
                }),
                "manual_height": ("INT", {
                    "default": 640, "min": 32, "max": 4096, "step": 32,
                    "tooltip": "Used in manual mode and as a safe fallback "
                               "when Picture 1 is missing.",
                }),
                "megapixels": ("FLOAT", {
                    "default": 0.98, "min": 0.10, "max": 8.0, "step": 0.01,
                    "round": 0.01,
                    "tooltip": "Approximate total output area using ComfyUI's "
                               "1024-squared megapixel convention. 0.98 is "
                               "H3's native maximum. Dimensions are snapped "
                               "to H3's 32-pixel grid.",
                }),
                "aspect_format": ([
                    "16:9 landscape",
                    "9:16 portrait",
                    "1:1 square",
                    "4:3 landscape",
                    "3:4 portrait",
                    "3:2 landscape",
                    "2:3 portrait",
                    "21:9 ultrawide",
                    "9:21 vertical ultrawide",
                    "5:4 landscape",
                    "4:5 portrait",
                ], {
                    "default": "16:9 landscape",
                    "tooltip": "Used only by 'megapixels + format'.",
                }),
            },
            "optional": {
                "source_image": ("IMAGE", {
                    "tooltip": "Legacy primary aspect source retained for "
                               "older workflows.",
                }),
                "fallback_image": ("IMAGE", {
                    "tooltip": "Legacy fallback aspect source retained for "
                               "older workflows.",
                }),
                "picture_1": ("IMAGE", {
                    "tooltip": "Direct Picture 1 input. It has priority in "
                               "source aspect + megapixels mode, independently "
                               "from the selected T2V/I2V/R2V route.",
                }),
            },
        }

    RETURN_TYPES = ("INT", "INT", "STRING")
    RETURN_NAMES = ("width", "height", "size_info")
    FUNCTION = "resolve"
    CATEGORY = "utils/minimax"
    DESCRIPTION = (
        "Choose manual dimensions, megapixels plus a format, or megapixels "
        "while preserving Picture 1's aspect ratio.")

    @classmethod
    def _snap_manual(cls, value):
        snapped = int(round(float(value) / cls._MULTIPLE)) * cls._MULTIPLE
        return max(cls._MIN_SIZE, min(cls._MAX_SIZE, snapped))

    @staticmethod
    def _image_size(image):
        shape = getattr(image, "shape", None)
        if shape is None or len(shape) < 3:
            return None
        height, width = int(shape[-3]), int(shape[-2])
        if width <= 0 or height <= 0:
            return None
        return width, height

    @classmethod
    def _size_for_area(cls, source_width, source_height, megapixels):
        target_area = max(
            1.0, float(megapixels) * cls._PIXELS_PER_MEGAPIXEL)
        ratio = source_width / float(source_height)
        raw_width = math.sqrt(target_area * ratio)
        raw_height = math.sqrt(target_area / ratio)
        center_width = cls._snap_manual(raw_width)
        center_height = cls._snap_manual(raw_height)

        candidates = []
        for width_step in range(-2, 3):
            for height_step in range(-2, 3):
                width = max(
                    cls._MIN_SIZE,
                    min(cls._MAX_SIZE,
                        center_width + width_step * cls._MULTIPLE))
                height = max(
                    cls._MIN_SIZE,
                    min(cls._MAX_SIZE,
                        center_height + height_step * cls._MULTIPLE))
                area_error = abs(width * height - target_area) / target_area
                aspect_error = abs(width / float(height) - ratio) / ratio
                candidates.append(
                    (area_error + 2.0 * aspect_error, width, height))
        _, width, height = min(candidates)
        return width, height

    @staticmethod
    def _format_ratio(aspect_format):
        """Return a numeric ratio from values such as '16:9 landscape'."""
        try:
            ratio_token = str(aspect_format).strip().split()[0]
            ratio_width, ratio_height = ratio_token.split(":", 1)
            ratio_width = float(ratio_width)
            ratio_height = float(ratio_height)
            if ratio_width > 0 and ratio_height > 0:
                return ratio_width, ratio_height
        except (IndexError, TypeError, ValueError):
            pass
        return 16.0, 9.0

    def resolve(self, size_mode, manual_width, manual_height, megapixels,
                aspect_format="16:9 landscape", source_image=None,
                fallback_image=None, picture_1=None):
        manual_width = self._snap_manual(manual_width)
        manual_height = self._snap_manual(manual_height)

        if size_mode == "megapixels + format":
            ratio_width, ratio_height = self._format_ratio(aspect_format)
            width, height = self._size_for_area(
                ratio_width, ratio_height, megapixels)
            info = (
                "%dx%d from %s (target %.2f MP, actual %.2f MP)"
                % (width, height, aspect_format, megapixels,
                   width * height / 1_000_000.0))
            print("[H3OutputSize] " + info, flush=True)
            return width, height, info

        picture_modes = {
            "source aspect + megapixels",
            "megapixels + Picture 1 aspect",
        }
        if size_mode not in picture_modes:
            info = "%dx%d manual (%.2f MP)" % (
                manual_width, manual_height,
                manual_width * manual_height / 1_000_000.0)
            return manual_width, manual_height, info

        source = picture_1
        if source is None:
            source = source_image if source_image is not None else fallback_image
        source_size = self._image_size(source)
        if source_size is None:
            info = (
                "%dx%d manual fallback: Picture 1 is missing (%.2f MP)"
                % (manual_width, manual_height,
                   manual_width * manual_height / 1_000_000.0))
            print("[H3OutputSize] " + info, flush=True)
            return manual_width, manual_height, info

        source_width, source_height = source_size
        width, height = self._size_for_area(
            source_width, source_height, megapixels)
        info = (
            "%dx%d from Picture 1 %dx%d (target %.2f MP, actual %.2f MP)"
            % (width, height, source_width, source_height, megapixels,
               width * height / 1_000_000.0))
        print("[H3OutputSize] " + info, flush=True)
        return width, height, info

NODE_CLASS_MAPPINGS = {"H3ScriptSplit": H3ScriptSplit,
                       "H3ModelLoaderAny": H3ModelLoaderAny,
                       "H3ClipLoaderAny": H3ClipLoaderAny,
                       "H3AudioTrimStart": H3AudioTrimStart,
                       "H3MultishotSampler": H3MultishotSampler,
                       "H3MultishotReferenceSampler": H3MultishotSampler,
                       "H3MultishotModeRouter": h3_refs.H3MultishotModeRouter,
                       "H3MultishotMemorySampler": H3MultishotMemorySampler,
                       "H3OptionalImage": H3OptionalImage,
                       "H3AspectMegapixelSize": H3AspectMegapixelSize}
NODE_DISPLAY_NAME_MAPPINGS = {
    "H3ScriptSplit": "H3 Shot List",
    "H3ModelLoaderAny": "H3 Model Loader (safetensors + GGUF)",
    "H3ClipLoaderAny": "H3 CLIP Loader (safetensors + GGUF)",
    "H3AudioTrimStart": "H3 Audio Trim Start",
    "H3MultishotSampler": "H3 Multishot Sampler (one node)",
    "H3MultishotReferenceSampler": "H3 Multishot + References (one node)",
    "H3MultishotModeRouter": "H3 Multishot Mode + Prompt Router",
    "H3MultishotMemorySampler": "H3 Multishot Sampler + Memory (long form)",
    "H3OptionalImage": "H3 Optional Image (I2V on/off)",
    "H3AspectMegapixelSize": "H3 Output Size (3 modes)"}
