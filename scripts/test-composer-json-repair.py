import importlib.util
import json
from pathlib import Path


root = Path(__file__).resolve().parents[1]
module_path = (
    root / "comfyui_nodes" / "ComfyUI-H3-Multishot" / "h3_json_repair.py")
spec = importlib.util.spec_from_file_location("h3_json_repair", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

broken = r'''{
  "shots": [{
    "description": "Continuity Bible: same girl and room.",
    "[Shot 1] She finishes eating and smiles.",
    "soundscape": "Quiet room.",
    "music": "N/A",
    "active_ref_images": [1]
  }]
}'''
repaired, changed = module.repair_split_description(broken)
assert changed is True
data = json.loads(repaired)
assert data["shots"][0]["description"] == (
    "Continuity Bible: same girl and room. "
    "[Shot 1] She finishes eating and smiles.")

valid = '{"shots":[{"description":"[Shot 1] Valid.","music":"N/A"}]}'
untouched, changed = module.repair_split_description(valid)
assert changed is False
assert untouched == valid

print("Composer split-description JSON repair passed.")
