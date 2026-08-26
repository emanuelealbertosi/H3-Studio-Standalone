import { app } from "../../scripts/app.js";

const NODE_NAME = "H3MultishotModeRouter";
const BYPASS = 4;
const ACTIVE = 0;
const REF_IMAGE_SLOTS = 9;
const PROMPT_INPUTS = new Set([
    "t2v_script",
    "i2v_script",
    "reference_script",
]);

function nodeType(node) {
    return node?.comfyClass ?? node?.type ?? null;
}

function widgetValue(node, name, fallback) {
    const widget = node.widgets?.find((item) => item.name === name);
    return widget ? widget.value : fallback;
}

function refreshAudioReferenceButton(node) {
    const button = node?._h3AudioReferenceButton;
    if (!button) return;
    const count = Number(widgetValue(node, "ref_audio_count", 0)) || 0;
    button.name = count > 0
        ? `AUDIO REFERENCE: ON (${count})`
        : "AUDIO REFERENCE: OFF — click to enable";
}

function installAudioReferenceButton(node) {
    if (!node || node._h3AudioReferenceButton) return;
    const button = node.addWidget(
        "button",
        "AUDIO REFERENCE: OFF — click to enable",
        null,
        () => {
            const countWidget = node.widgets?.find(
                (item) => item.name === "ref_audio_count");
            if (!countWidget) return;

            const current = Number(countWidget.value) || 0;
            if (current > 0) {
                node._h3LastAudioReferenceCount = current;
                countWidget.value = 0;
            } else {
                countWidget.value = Math.max(
                    1, Number(node._h3LastAudioReferenceCount) || 1);

                // An audio reference is an R2V input, so make the matching
                // prompt/reference branch active as part of the same click.
                const referencesWidget = node.widgets?.find(
                    (item) => item.name === "use_references");
                if (referencesWidget && !referencesWidget.value) {
                    referencesWidget.value = true;
                    referencesWidget.callback?.call(
                        referencesWidget, true, app.canvas, node);
                }
            }
            countWidget.callback?.call(
                countWidget, countWidget.value, app.canvas, node);
            refreshAudioReferenceButton(node);
            sync(node);
        },
    );
    button.serialize = false;
    node._h3AudioReferenceButton = button;
    refreshAudioReferenceButton(node);
    node.setSize?.([
        node.size?.[0] ?? 520,
        Math.max(node.size?.[1] ?? 0, 650),
    ]);
}

function sourceNode(node, inputName) {
    const index = node.inputs?.findIndex((input) => input.name === inputName);
    if (index == null || index < 0) return null;
    const input = node.inputs[index];
    if (input?.link == null) return null;
    const link = app.graph?.links?.[input.link]
        ?? app.graph?._links?.[input.link]
        ?? node.getInputLink?.(index);
    const originId = link?.origin_id ?? link?.originId;
    return originId == null ? null : app.graph?.getNodeById?.(originId);
}

function setBranchMode(root, active, visited = new Set()) {
    if (!root || visited.has(root.id)) return;
    visited.add(root.id);
    root.mode = active ? ACTIVE : BYPASS;

    // The start-image branch contains H3OptionalImage -> LoadImage. Dim both;
    // otherwise the upstream loader still looks active and can be serialized.
    for (const input of root.inputs ?? []) {
        if (input?.link == null) continue;
        const link = app.graph?.links?.[input.link]
            ?? app.graph?._links?.[input.link];
        const originId = link?.origin_id ?? link?.originId;
        if (originId != null) {
            setBranchMode(app.graph?.getNodeById?.(originId), active, visited);
        }
    }
}

function sync(node) {
    if (!node || !app.graph) return;
    const start = Boolean(widgetValue(node, "use_start_image", false));
    const refs = Boolean(widgetValue(node, "use_references", false));
    const imageCount = Number(widgetValue(node, "ref_image_count", 0)) || 0;
    const video = Boolean(widgetValue(node, "use_ref_video", false));
    const voice = Boolean(widgetValue(node, "use_voice_ref", false));
    const videoAudio = Boolean(widgetValue(node, "use_video_audio", false));
    const audioCount = Number(widgetValue(node, "ref_audio_count", 0)) || 0;

    const wanted = {
        t2v_script: !refs && !start,
        i2v_script: !refs && start,
        reference_script: refs,
        start_image: start,
        voice_ref: refs && voice,
        ref_video_0: refs && video,
        ref_video_audio_0: refs && video && videoAudio,
        ref_audio_0: refs && audioCount >= 1,
        ref_audio_1: refs && audioCount >= 2,
    };
    for (let i = 0; i < REF_IMAGE_SLOTS; i++) {
        wanted[`ref_image_${i}`] = refs && imageCount > i;
    }

    // One structured builder can feed both t2v_script and i2v_script.
    // Resolve shared source nodes once with OR semantics; otherwise the second
    // inactive socket would immediately bypass a builder required by the first.
    const roots = new Map();
    for (const [inputName, active] of Object.entries(wanted)) {
        const root = sourceNode(node, inputName);
        if (!root) continue;
        // All prompt sockets are required lazy inputs. Bypassing their tiny
        // builders removes the socket value during prompt validation, even
        // when that branch is not selected. Keep builders active; only media
        // loaders are bypassed to save work and keep the graph readable.
        const branchActive = PROMPT_INPUTS.has(inputName) ? true : active;
        const previous = roots.get(root.id);
        roots.set(root.id, {
            root,
            active: Boolean(branchActive || previous?.active),
        });
    }
    for (const { root, active } of roots.values()) {
        setBranchMode(root, active);
    }
    app.graph.setDirtyCanvas?.(true, true);
}

function mount(node) {
    if (!node || node._h3BypassMounted) return;
    node._h3BypassMounted = true;
    installAudioReferenceButton(node);
    for (const name of [
        "use_start_image", "use_references", "ref_image_count",
        "use_ref_video", "use_voice_ref", "use_video_audio",
        "ref_audio_count",
    ]) {
        const widget = node.widgets?.find((item) => item.name === name);
        if (!widget || widget._h3BypassWrapped) continue;
        const callback = widget.callback;
        widget.callback = function (...args) {
            const result = callback?.apply(this, args);
            setTimeout(() => {
                sync(node);
                refreshAudioReferenceButton(node);
            }, 0);
            return result;
        };
        widget._h3BypassWrapped = true;
    }
    setTimeout(() => {
        sync(node);
        refreshAudioReferenceButton(node);
    }, 0);
}

app.registerExtension({
    name: "h3_multishot.mode_router_visual_bypass",
    async beforeRegisterNodeDef(nodeTypeDef, nodeData) {
        if (nodeData.name !== NODE_NAME) return;
        const created = nodeTypeDef.prototype.onNodeCreated;
        nodeTypeDef.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            setTimeout(() => mount(this), 0);
            return result;
        };
        const configured = nodeTypeDef.prototype.onConfigure;
        nodeTypeDef.prototype.onConfigure = function () {
            const result = configured?.apply(this, arguments);
            setTimeout(() => sync(this), 0);
            return result;
        };
    },
    async nodeCreated(node) {
        if (nodeType(node) === NODE_NAME) mount(node);
    },
    async afterConfigureGraph() {
        for (const node of app.graph?._nodes ?? []) {
            if (nodeType(node) === NODE_NAME) sync(node);
        }
    },
});

