# -*- coding: utf-8 -*-
"""Frontend-backed workflow configuration presets for H3 workflows."""

import json


_DEFAULT_STATE = json.dumps({
    "version": 2,
    "selected": "",
    "presets": {},
}, ensure_ascii=False, separators=(",", ":"))


class H3WorkflowPresetManager:
    """Stores frontend preset data inside the workflow JSON."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "presets_json": ("STRING", {
                "default": _DEFAULT_STATE,
                "multiline": False,
                "dynamicPrompts": False,
                "hidden": True,
                "tooltip": "Serialized by the H3 settings preset manager.",
            }),
        }}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("presets_json",)
    FUNCTION = "passthrough"
    CATEGORY = "utils/minimax"
    DESCRIPTION = (
        "Save lightweight technical presets or complete workflow instances "
        "including prompts, selected media, widget values and node modes; "
        "frontend controls also import/export portable JSON snapshots.")

    def passthrough(self, presets_json):
        return (presets_json,)


NODE_CLASS_MAPPINGS = {
    "H3WorkflowPresetManager": H3WorkflowPresetManager,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "H3WorkflowPresetManager": "H3 Presets + Workflow Instances",
}
