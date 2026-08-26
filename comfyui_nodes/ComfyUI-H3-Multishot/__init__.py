from . import h3_gguf_arch  # noqa: F401  (teaches ComfyUI-GGUF minimax_h3 on import)
from .h3_multishot_utils import (NODE_CLASS_MAPPINGS,
                                 NODE_DISPLAY_NAME_MAPPINGS)
from .h3_keyframes import (NODE_CLASS_MAPPINGS as _KF_C,
                           NODE_DISPLAY_NAME_MAPPINGS as _KF_N)
from .h3_cartridge import (NODE_CLASS_MAPPINGS as _CT_C,
                           NODE_DISPLAY_NAME_MAPPINGS as _CT_D)
from .h3_ref_folder import (NODE_CLASS_MAPPINGS as _RF_C,
                            NODE_DISPLAY_NAME_MAPPINGS as _RF_D)
from .h3_advanced import (NODE_CLASS_MAPPINGS as _AD_C,
                          NODE_DISPLAY_NAME_MAPPINGS as _AD_N)
from .h3_lora_stack import (NODE_CLASS_MAPPINGS as _LS_C,
                            NODE_DISPLAY_NAME_MAPPINGS as _LS_D)

for _c, _n in ((_KF_C, _KF_N), (_AD_C, _AD_N)):
    NODE_CLASS_MAPPINGS.update(_c)
    NODE_DISPLAY_NAME_MAPPINGS.update(_n)

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS.update(_RF_C)
NODE_DISPLAY_NAME_MAPPINGS.update(_RF_D)
NODE_CLASS_MAPPINGS.update(_CT_C)
NODE_DISPLAY_NAME_MAPPINGS.update(_CT_D)
NODE_CLASS_MAPPINGS.update(_LS_C)
NODE_DISPLAY_NAME_MAPPINGS.update(_LS_D)

from .h3_episode_tools import (NODE_CLASS_MAPPINGS as _ET_C,
                               NODE_DISPLAY_NAME_MAPPINGS as _ET_D)
NODE_CLASS_MAPPINGS.update(_ET_C)
NODE_DISPLAY_NAME_MAPPINGS.update(_ET_D)

from .h3_avbank_probe import (NODE_CLASS_MAPPINGS as _AV_C,
                              NODE_DISPLAY_NAME_MAPPINGS as _AV_D)
NODE_CLASS_MAPPINGS.update(_AV_C)
NODE_DISPLAY_NAME_MAPPINGS.update(_AV_D)

from .h3_prompt_builders import (NODE_CLASS_MAPPINGS as _PB_C,
                                 NODE_DISPLAY_NAME_MAPPINGS as _PB_D)
NODE_CLASS_MAPPINGS.update(_PB_C)
NODE_DISPLAY_NAME_MAPPINGS.update(_PB_D)

from .h3_reference_memory import (NODE_CLASS_MAPPINGS as _RM_C,
                                  NODE_DISPLAY_NAME_MAPPINGS as _RM_D)
NODE_CLASS_MAPPINGS.update(_RM_C)
NODE_DISPLAY_NAME_MAPPINGS.update(_RM_D)

from .h3_motion_memory import (NODE_CLASS_MAPPINGS as _MM_C,
                               NODE_DISPLAY_NAME_MAPPINGS as _MM_D)
NODE_CLASS_MAPPINGS.update(_MM_C)
NODE_DISPLAY_NAME_MAPPINGS.update(_MM_D)

from .h3_workflow_presets import (NODE_CLASS_MAPPINGS as _WP_C,
                                  NODE_DISPLAY_NAME_MAPPINGS as _WP_D)
NODE_CLASS_MAPPINGS.update(_WP_C)
NODE_DISPLAY_NAME_MAPPINGS.update(_WP_D)

from .h3_music_video import (NODE_CLASS_MAPPINGS as _MV_C,
                             NODE_DISPLAY_NAME_MAPPINGS as _MV_D)
NODE_CLASS_MAPPINGS.update(_MV_C)
NODE_DISPLAY_NAME_MAPPINGS.update(_MV_D)
from .h3_aio_autoprompt import (NODE_CLASS_MAPPINGS as _AIO_C,
                                NODE_DISPLAY_NAME_MAPPINGS as _AIO_D)
NODE_CLASS_MAPPINGS.update(_AIO_C)
NODE_DISPLAY_NAME_MAPPINGS.update(_AIO_D)

from .h3_composer_prevalidator import (NODE_CLASS_MAPPINGS as _CP_C,
                                       NODE_DISPLAY_NAME_MAPPINGS as _CP_D)
NODE_CLASS_MAPPINGS.update(_CP_C)
NODE_DISPLAY_NAME_MAPPINGS.update(_CP_D)
from .h3_official_prompt_skill import (NODE_CLASS_MAPPINGS as _OS_C,
                                       NODE_DISPLAY_NAME_MAPPINGS as _OS_D)
NODE_CLASS_MAPPINGS.update(_OS_C)
NODE_DISPLAY_NAME_MAPPINGS.update(_OS_D)