# -*- coding: utf-8 -*-
"""Pinned official MiniMax H3 prompt-writing guidance for the AIO planner."""
from pathlib import Path

OFFICIAL_COMMIT = "d21241f0a4b3acbb34c97dae47fa417b7065e438"
ASSET_ROOT = Path(__file__).with_name("h3_official_prompt_skill_assets")
BASE_MODES = {"T2V", "I2V", "KEYFRAMES"}
MODE_NAMES = {
    "T2V": "T2VA", "I2V": "I2VA",
    "KEYFRAMES": "FL2VA/keyframe timeline", "R2V": "Ref2VA",
    "VIDEO EXTENSION": "Ref2VA video continuation",
    "VIDEO EDITING": "Ref2VA video editing",
}

COMMON = """Official H3 runtime rules (compact transcription of the pinned guide):
- Write prompt content in English. Preserve dialogue, lyrics, and visible text verbatim in the original language.
- Use concrete visible and audible details. Every clip must cover the duration requested by the AIO contract.
- Every clip description starts with [Shot 1] without a timestamp. Later internal shots use strictly increasing markers such as [Shot 2] At 00:03.500.
- Each internal shot establishes composition, subjects, environment and lighting, action/state change, natural camera behavior, and synchronized diegetic sound.
- Give every speaking or singing subject a stable (S1), (S2), ... identifier. Put only the original utterance inside <d>[Language] ...</d>.
- Keep reference labels stable and never invent an asset absent from the AIO media manifest.
- In AIO JSON, shots[].description carries the official timeline description, soundscape carries overall_soundscape, and music carries non_diegetic_music.
"""

BASE = """Base/keyframe profile:
- T2V/T2VA builds the complete audiovisual timeline from text without image alignment.
- I2V/I2VA treats <Picture 1> as the exact first frame at 0.00 seconds and develops continuously forward while preserving identity, clothing, objects, colors, and spatial relationships.
- KEYFRAMES treats loaded pictures as concrete timeline anchors. Describe physically plausible motion that reaches each scheduled image; do not treat keyframes as ordinary identity references.
- Prefer one internal shot for continuous first-to-last interpolation unless the request explicitly needs cuts. Land visibly on every required ending keyframe.
"""

REF = """Full-reference/Ref2VA profile:
- Preserve the official six-section meaning inside AIO JSON: subject_definitions, summary, retention_analysis, detailed shot descriptions, soundscape, and non-diegetic music.
- <Subject N> is reusable visible content and may be defined by multiple assets. One asset may define multiple subjects.
- Use standalone <Picture N> only as a concrete frame, keyframe, composition anchor, or storyboard anchor. If it supplies identity, costume, scene, or style only, cite it inside <Subject N>.
- <Video N> is an editing/continuation source or whole-video structure; visible content taken from it remains <Subject N>.
- <Audio N> is copied or referenced audio. Obey the AIO audio route and never infer a role merely because a video contains audio.
- summary uses only labels already defined. retention_analysis covers every used reference with an appropriate preservation/copy/reference relationship.
- VIDEO EXTENSION continues the exact final state of <Video 1>. VIDEO EDITING preserves its timeline unless the user explicitly requests structural change.
"""

CONTROL = """AIO CONTROL CONTRACT - HIGHEST PRIORITY
+Keep the ORIGINAL AIO JSON schema and clip-count policy exactly. Return one valid JSON object only: no Markdown, commentary, standalone official prompt, or trailing commas.
+The official skill below refines content inside that JSON; it never replaces the AIO parser contract.
+""".replace("\n+", "\n").lstrip("+")

FINAL = """FINAL REMINDER
Return only the JSON demanded by ORIGINAL AIO PLANNER REQUEST. Preserve its exact fields, shots[] structure, clip count, reference routing, audio exclusions, and duration. Apply official rules inside those fields.
"""


def read_asset(relative):
    path = ASSET_ROOT.joinpath(*relative.split("/"))
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError("Missing official H3 skill asset: %s" % path) from exc


def select_profile(generation_mode, guide_profile):
    requested = str(guide_profile or "AUTO").upper()
    mode = str(generation_mode or "").strip().upper()
    if requested.startswith("BASE"):
        return "BASE", mode
    if requested.startswith("FULL-REFERENCE"):
        return "REF", mode
    return ("BASE" if mode in BASE_MODES else "REF"), mode


class H3OfficialPromptSkill:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "planner_request": ("STRING", {"forceInput": True}),
            "generation_mode": ("STRING", {"forceInput": True}),
            "enabled": ("BOOLEAN", {"default": True}),
            "guide_profile": (["AUTO", "BASE / KEYFRAMES",
                               "FULL-REFERENCE / REF2VA"], {"default": "AUTO"}),
            "context_detail": (["COMPACT (recommended)",
                                "FULL OFFICIAL (requires >=16k context)"],
                               {"default": "COMPACT (recommended)"}),
        }}

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("enhanced_request", "status")
    FUNCTION = "apply"
    CATEGORY = "MiniMax H3/AIO"

    def apply(self, planner_request, generation_mode, enabled=True,
              guide_profile="AUTO", context_detail="COMPACT (recommended)"):
        original = str(planner_request or "").strip()
        if not enabled:
            return original, "OFF - original AIO planner request passes through"
        if not original:
            raise ValueError("Official Prompt Skill requires planner_request.")

        profile, mode = select_profile(generation_mode, guide_profile)
        skill = read_asset("SKILL.md")
        full = str(context_detail).upper().startswith("FULL OFFICIAL")
        if full:
            guide_name = "base-en.txt" if profile == "BASE" else "ref-en.txt"
            official = skill + "\n\n" + read_asset("references/" + guide_name)
            detail = "FULL OFFICIAL; planner context >=16k recommended"
        else:
            official = skill + "\n\n" + COMMON + "\n" + (BASE if profile == "BASE" else REF)
            detail = "COMPACT"

        selected_mode = MODE_NAMES.get(mode, mode or "AUTO")
        enhanced = "\n\n".join((
            CONTROL.strip(),
            "PINNED OFFICIAL MINIMAX H3 PROMPT-WRITING SKILL\n"
            "Source commit: %s\nSelected profile: %s (%s)\n\n%s" %
            (OFFICIAL_COMMIT, profile, selected_mode, official),
            "ORIGINAL AIO PLANNER REQUEST - PRESERVE ITS CONTRACT\n" + original,
            FINAL.strip(),
        ))
        status = "ON | official h3-prompt-writing | %s | %s | commit %s" % (
            profile, detail, OFFICIAL_COMMIT[:12])
        return enhanced, status


NODE_CLASS_MAPPINGS = {"H3OfficialPromptSkill": H3OfficialPromptSkill}
NODE_DISPLAY_NAME_MAPPINGS = {
    "H3OfficialPromptSkill": "H3 Official Prompt Skill (pinned)"}
