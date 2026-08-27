# -*- coding: utf-8 -*-
"""AIO Reference Memory sampler with latent-native Motion Context.

The ordinary AIO sampler already owns the complete multishot loop, so it can
carry the previous shot's paired H3 video/audio latent directly into the next
shot. This avoids the Save/Load pair required by ordinary ComfyUI graphs and,
more importantly, avoids decoding and re-encoding the continuation window.
"""

from .h3_reference_memory import H3ReferenceMemorySampler


class _InRunMotionContext:
    def __init__(self, context_length="39", audio_context_length=39,
                 crossfade_frames=17):
        self.context_length = str(context_length)
        self.audio_context_length = int(audio_context_length)
        self.crossfade_frames = max(0, int(crossfade_frames))
        self.previous_latent = None
        self.external_frames = None
        self.external_audio = None
        self.external_audio_vae = None
        self._motion_node = None
        self._trim_node = None

    def set_external(self, frames, audio=None, audio_vae=None):
        """Seed clip 1 from a decoded external source tail.

        Internal multishot boundaries use ``previous_latent`` and remain the
        lossless preferred path. A separate Continue job only has decoded
        frames/audio, so Motion Context re-encodes their tail once instead of
        guessing motion from a single still.
        """
        self.external_frames = frames
        self.external_audio = audio
        self.external_audio_vae = audio_vae

    @staticmethod
    def _node(node_name):
        # Look up the installed pack at execution time. ComfyUI has completed
        # custom-node discovery by then, and this avoids importing a sibling
        # package whose on-disk folder contains hyphens.
        import nodes

        cls = nodes.NODE_CLASS_MAPPINGS.get(node_name)
        if cls is None:
            raise RuntimeError(
                "H3 AIO Motion Memory requires ComfyUI-H3-Motion-Context. "
                "Install/update that pack and restart ComfyUI.")
        return cls()

    def apply(self, conditioning, video_vae, latent, shot_index):
        if shot_index == 0:
            if self.external_frames is None:
                return conditioning, 0
            if self._motion_node is None:
                self._motion_node = self._node("MiniMaxH3MotionContext")
            kwargs = {
                "conditioning": conditioning,
                "vae": video_vae,
                "latent": latent,
                "context_length": self.context_length,
                "audio_context_length": self.audio_context_length,
                "context_frames": self.external_frames,
            }
            if (self.external_audio is not None
                    and self.external_audio_vae is not None):
                kwargs["audio_vae"] = self.external_audio_vae
                kwargs["context_audio"] = self.external_audio
            conditioned, trim_frames = self._motion_node.apply(**kwargs)
            print(
                "[H3ReferenceMotionMemory] clip 1: external pixel motion "
                "context video=%s frames, audio=%d frames, trim=%d."
                % (self.context_length, self.audio_context_length,
                   int(trim_frames)),
                flush=True)
            return conditioned, int(trim_frames)
        if self.previous_latent is None:
            raise RuntimeError(
                "H3 AIO Motion Memory has no previous AV latent for clip %d."
                % (shot_index + 1))
        if self._motion_node is None:
            self._motion_node = self._node("MiniMaxH3MotionContext")
        conditioned, trim_frames = self._motion_node.apply(
            conditioning=conditioning,
            vae=video_vae,
            latent=latent,
            context_length=self.context_length,
            audio_context_length=self.audio_context_length,
            context_latent=self.previous_latent,
        )
        print(
            "[H3ReferenceMotionMemory] clip %d: latent-native context "
            "video=%s frames, audio=%d frames, trim=%d."
            % (shot_index + 1, self.context_length,
               self.audio_context_length, int(trim_frames)),
            flush=True)
        return conditioned, int(trim_frames)

    def capture(self, output, shot_index):
        samples = output.get("samples") if isinstance(output, dict) else None
        if samples is None:
            raise ValueError(
                "H3 AIO Motion Memory expected the sampler LATENT output.")
        if getattr(samples, "is_nested", False):
            streams = list(samples.unbind())
        elif isinstance(samples, (list, tuple)):
            streams = list(samples)
        else:
            raise ValueError(
                "H3 AIO Motion Memory requires H3's paired video/audio latent.")
        if len(streams) < 2:
            raise ValueError(
                "H3 AIO Motion Memory found no audio stream in the H3 latent.")
        # The official disk loader returns CPU tensors too. Keeping only the
        # two detached streams prevents a previous clip from occupying VRAM
        # while the next one is sampled.
        self.previous_latent = {
            "samples": [
                stream.detach().to("cpu").contiguous()
                for stream in streams[:2]
            ]
        }

    def trim(self, images, audio, trim_frames):
        if self._trim_node is None:
            self._trim_node = self._node("MiniMaxH3MotionContextTrim")
        return self._trim_node.trim(
            images=images,
            trim_frames=int(trim_frames),
            audio=audio,
            fps=24.0,
            match_tail=True,
        )


class H3ReferenceMotionMemorySampler(H3ReferenceMemorySampler):
    """Original AIO sampler plus latent-native motion/audio continuity."""

    @classmethod
    def INPUT_TYPES(cls):
        base = H3ReferenceMemorySampler.INPUT_TYPES()
        required = dict(base["required"])
        required["motion_context_enabled"] = ("BOOLEAN", {
            "default": True,
            "tooltip": "Carry the previous shot's native H3 video/audio "
                       "latent into the next shot. Affects clip 2 onward. "
                       "Use it for continuous action; turn it off for a "
                       "deliberate hard cut or a complete scene reset."})
        required["motion_context_length"] = (["39", "22", "90", "5", "56", "141"], {
            "default": "39",
            "tooltip": "Previous-shot video frames pinned at the next "
                       "shot's head. 39 is recommended because it is both "
                       "a native H3 video run and an exact AV boundary."})
        required["motion_audio_context_length"] = ("INT", {
            "default": 39, "min": 0, "max": 240, "step": 3,
            "tooltip": "Previous-shot audio frames to continue. Use 39 "
                       "with a 39-frame video context for exact AV timing."})
        optional = dict(base.get("optional", {}))
        optional["motion_crossfade_frames"] = ("INT", {
            "default": 17, "min": 0, "max": 141, "step": 1,
            "tooltip": "Matching Motion Context frames blended linearly "
                       "over the previous clip tail. 17 is a safe default; "
                       "0 disables visual blending, 39 uses the full "
                       "recommended context."})
        return {
            "required": required,
            "optional": optional,
        }

    DESCRIPTION = (
        "The complete H3 Reference + Memory AIO sampler with latent-native "
        "Motion Context between shots. It keeps real movement and audio "
        "across joins without a decode/re-encode round trip.")

    def run(self, motion_context_enabled=True, motion_context_length="39",
            motion_audio_context_length=39, motion_crossfade_frames=17,
            **kwargs):
        self._motion_context_controller = (
            _InRunMotionContext(
                motion_context_length, motion_audio_context_length,
                motion_crossfade_frames)
            if motion_context_enabled else None)
        try:
            return super().run(**kwargs)
        finally:
            self._motion_context_controller = None


NODE_CLASS_MAPPINGS = {
    "H3ReferenceMotionMemorySampler": H3ReferenceMotionMemorySampler,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "H3ReferenceMotionMemorySampler":
        "H3 Reference + Motion Memory (one node)",
}
