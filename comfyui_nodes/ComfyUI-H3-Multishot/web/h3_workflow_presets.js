import { app } from "../../scripts/app.js";

const NODE_NAME = "H3WorkflowPresetManager";
const QUICK_EXCLUDED_TYPES = new Set([
    NODE_NAME, "H3IT2VShotPromptBuilder", "H3R2VShotPromptBuilder",
    "LoadImage", "LoadAudio", "VHS_LoadVideo", "SaveVideo", "CreateVideo",
    "MarkdownNote",
]);
const INCLUDED_TYPES = new Set([
    "H3ModelLoaderAny", "H3ClipLoaderAny", "VAELoader",
    "Power Lora Loader (rgthree)", "PathchSageAttentionKJ", "SolAttnPatch",
    "MiniMaxH3SigmaShift", "SpectrumApplyMiniMaxH3",
    "H3MultishotReferenceSampler", "H3ReferenceMemorySampler",
    "H3MultishotMemorySampler", "H3MultishotModeRouter", "H3OptionalImage",
]);

let stylesInstalled = false;

function installStyles() {
    if (stylesInstalled) return;
    stylesInstalled = true;
    const style = document.createElement("style");
    style.textContent = [
        ".h3preset{box-sizing:border-box;width:100%;padding:8px;color:#e6f1f7;font:12px system-ui,sans-serif;display:flex;flex-direction:column;gap:8px}",
        ".h3preset *{box-sizing:border-box}",
        ".h3preset-note{padding:7px;border:1px solid #456274;border-radius:6px;background:#101a20;color:#aac0cc;line-height:1.35}",
        ".h3preset-row{display:flex;gap:6px;align-items:center}",
        ".h3preset input,.h3preset select{min-width:0;flex:1;background:#0b1217;color:#eef8fc;border:1px solid #486777;border-radius:5px;padding:6px}",
        ".h3preset button{border:1px solid #5c8296;border-radius:5px;padding:6px 9px;background:#263e4a;color:#effaff;cursor:pointer;font-weight:700}",
        ".h3preset button:hover{background:#345769}",
        ".h3preset-save{background:#214d37!important;border-color:#4f9d70!important}",
        ".h3preset-load{background:#244368!important;border-color:#577fb1!important}",
        ".h3preset-instance{background:#4a3a1f!important;border-color:#a98849!important}",
        ".h3preset-transfer{font-size:10px!important;padding:5px 7px!important}",
        ".h3preset-delete{background:#4b292d!important;border-color:#9d5961!important}",
        ".h3preset-status{min-height:30px;padding:7px;border-radius:5px;background:#15252e;color:#bcd3df;line-height:1.3}",
        ".h3preset-status-error{background:#421f24;color:#ffdce1}",
    ].join("");
    document.head.appendChild(style);
}

function cloneValue(value) {
    if (value === undefined) return null;
    try {
        return structuredClone(value);
    } catch {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch {
            return null;
        }
    }
}

function parseState(value) {
    try {
        const parsed = JSON.parse(value || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return {
                version: 2,
                selected: String(parsed.selected || ""),
                presets: parsed.presets && typeof parsed.presets === "object"
                    ? parsed.presets : {},
            };
        }
    } catch {}
    return { version: 2, selected: "", presets: {} };
}

function hideStateWidget(widget) {
    if (!widget) return;
    widget.hidden = true;
    widget.options = { ...(widget.options || {}), hidden: true };
    widget.draw = () => {};
    widget.computeSize = () => [0, -4];
}

function nodeType(node) {
    return node?.comfyClass || node?.type || "";
}

function shouldCaptureQuick(node) {
    const type = nodeType(node);
    if (!node || QUICK_EXCLUDED_TYPES.has(type)) return false;
    if (INCLUDED_TYPES.has(type)) return true;
    return /(?:H3|MiniMax)/i.test(type)
        && !/(?:PromptBuilder|Preview|Note)/i.test(type);
}

function serializableWidgets(node) {
    const widgets = [];
    for (const widget of node.widgets || []) {
        if (!widget?.name || widget.name === "presets_json") continue;
        if (widget.type === "button" || widget.type === "image") continue;
        const value = cloneValue(widget.value);
        if (value !== null) widgets.push({ name: widget.name, value });
    }
    return widgets;
}

function captureGraph(manager, scope = "settings") {
    const allNodes = app.graph?._nodes || [];
    const candidates = allNodes.filter(node => node !== manager
        && (scope === "complete" || shouldCaptureQuick(node)));
    const ordinals = new Map();
    return candidates.map(node => {
        const key = nodeType(node) + "\u0000" + (node.title || "");
        const ordinal = ordinals.get(key) || 0;
        ordinals.set(key, ordinal + 1);
        return {
            id: node.id,
            type: nodeType(node),
            title: node.title || "",
            ordinal,
            mode: Number.isFinite(node.mode) ? node.mode : 0,
            widgets: serializableWidgets(node),
        };
    });
}

function findTarget(saved) {
    const nodes = app.graph?._nodes || [];
    const byId = nodes.find(node => String(node.id) === String(saved.id)
        && nodeType(node) === saved.type);
    if (byId) return byId;
    const sameType = nodes.filter(node => nodeType(node) === saved.type);
    if (sameType.length === 1) return sameType[0];
    const sameTitle = sameType.filter(node =>
        (node.title || "") === saved.title);
    if (sameTitle.length) return sameTitle[saved.ordinal || 0] || sameTitle[0];
    return sameType[saved.ordinal || 0] || null;
}

function restoreGraph(snapshot) {
    let restored = 0;
    let missing = 0;
    const modes = [];
    for (const saved of snapshot || []) {
        const target = findTarget(saved);
        if (!target) {
            missing += 1;
            continue;
        }
        for (const savedWidget of saved.widgets || []) {
            const widget = target.widgets?.find(item =>
                item.name === savedWidget.name);
            if (!widget) continue;
            widget.value = cloneValue(savedWidget.value);
            try {
                widget.callback?.(widget.value, app.canvas, target);
            } catch (error) {
                console.warn("[H3Preset] widget callback failed", error);
            }
        }
        modes.push([target, saved.mode]);
        target._h3PromptBuilderReload?.();
        restored += 1;
    }
    for (const [target, mode] of modes) target.mode = mode;
    app.graph?.setDirtyCanvas?.(true, true);
    app.graph?.change?.();
    return { restored, missing };
}

function safeFileName(value) {
    return String(value || "h3-instance")
        .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
        .replace(/[. ]+$/g, "") || "h3-instance";
}

function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function chooseJsonFile(onLoaded) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
            const parsed = JSON.parse(await file.text());
            onLoaded(parsed, file.name, null);
        } catch (error) {
            onLoaded(null, file.name, error);
        }
    };
    input.click();
}

function exportWholeWorkflow() {
    const graph = app.graph?.serialize?.();
    if (!graph) throw new Error("Il workflow non e serializzabile.");
    return graph;
}

function stopGraphShortcuts(element) {
    for (const name of [
        "pointerdown", "mousedown", "keydown", "keypress", "keyup",
        "copy", "cut", "paste", "wheel",
    ]) element.addEventListener(name, event => event.stopPropagation());
}

function install(node) {
    if (!node || node._h3PresetInstalled) return;
    node._h3PresetInstalled = true;
    installStyles();

    const stateWidget = node.widgets?.find(widget =>
        widget.name === "presets_json");
    if (!stateWidget) return;
    hideStateWidget(stateWidget);
    let state = parseState(stateWidget.value);

    const root = document.createElement("div");
    root.className = "h3preset";
    const note = document.createElement("div");
    note.className = "h3preset-note";
    note.textContent = "PRESET salva solo le regolazioni tecniche. ISTANZA salva tutti i widget del workflow, inclusi prompt, file selezionati, modalita e bypass. Il WF COMPLETO include anche nodi e collegamenti.";

    const nameRow = document.createElement("div");
    nameRow.className = "h3preset-row";
    const nameInput = document.createElement("input");
    nameInput.placeholder = "Nome preset, es. EMA 8 QUALITY";
    stopGraphShortcuts(nameInput);
    const saveButton = document.createElement("button");
    saveButton.className = "h3preset-save";
    saveButton.textContent = "SALVA PRESET";
    const instanceButton = document.createElement("button");
    instanceButton.className = "h3preset-instance";
    instanceButton.textContent = "SALVA ISTANZA";
    nameRow.append(nameInput, saveButton, instanceButton);

    const loadRow = document.createElement("div");
    loadRow.className = "h3preset-row";
    const select = document.createElement("select");
    stopGraphShortcuts(select);
    const loadButton = document.createElement("button");
    loadButton.className = "h3preset-load";
    loadButton.textContent = "RICHIAMA";
    const deleteButton = document.createElement("button");
    deleteButton.className = "h3preset-delete";
    deleteButton.textContent = "ELIMINA";
    loadRow.append(select, loadButton, deleteButton);
    const transferRow = document.createElement("div");
    transferRow.className = "h3preset-row";
    const exportButton = document.createElement("button");
    exportButton.className = "h3preset-transfer";
    exportButton.textContent = "ESPORTA ISTANZA";
    const importButton = document.createElement("button");
    importButton.className = "h3preset-transfer";
    importButton.textContent = "IMPORTA ISTANZA";
    const workflowButton = document.createElement("button");
    workflowButton.className = "h3preset-transfer";
    workflowButton.textContent = "ESPORTA WF COMPLETO";
    transferRow.append(exportButton, importButton, workflowButton);


    const status = document.createElement("div");
    status.className = "h3preset-status";
    status.textContent = "Nessun preset richiamato.";
    root.append(note, nameRow, loadRow, transferRow, status);

    const emit = () => {
        stateWidget.value = JSON.stringify(state);
        stateWidget.callback?.(stateWidget.value);
        app.graph?.setDirtyCanvas?.(true, true);
        app.graph?.change?.();
    };

    const setStatus = (message, error = false) => {
        status.textContent = message;
        status.classList.toggle("h3preset-status-error", error);
    };

    const refreshSelect = () => {
        const names = Object.keys(state.presets).sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: "base" }));
        select.replaceChildren();
        if (!names.length) {
            const option = document.createElement("option");
            option.value = "";
            option.textContent = "— nessun preset —";
            select.append(option);
            state.selected = "";
            return;
        }
        for (const name of names) {
            const option = document.createElement("option");
            option.value = name;
            const scope = state.presets[name]?.scope === "complete" ? "ISTANZA" : "PRESET";
            option.textContent = "[" + scope + "] " + name;
            select.append(option);
        }
        if (!state.presets[state.selected]) state.selected = names[0];
        select.value = state.selected;
    };

    select.onchange = () => {
        state.selected = select.value;
        nameInput.value = select.value;
        emit();
    };

    const saveSnapshot = scope => {
        const name = nameInput.value.trim();
        if (!name) {
            setStatus("Inserisci prima un nome.", true);
            return;
        }
        const nodes = captureGraph(node, scope);
        state.presets[name] = {
            scope,
            saved_at: new Date().toISOString(),
            nodes,
        };
        state.selected = name;
        emit();
        refreshSelect();
        const label = scope === "complete" ? "Istanza completa" : "Preset";
        setStatus(label + " “" + name + "” salvata: " + nodes.length + " nodi.");
    };

    saveButton.onclick = () => saveSnapshot("settings");
    instanceButton.onclick = () => saveSnapshot("complete");

    loadButton.onclick = () => {
        const name = select.value;
        const preset = state.presets[name];
        if (!preset) {
            setStatus("Seleziona un preset da richiamare.", true);
            return;
        }
        const result = restoreGraph(preset.nodes);
        state.selected = name;
        nameInput.value = name;
        emit();
        setStatus(
            (preset.scope === "complete" ? "Istanza" : "Preset")
            + " “" + name + "” richiamata: " + result.restored + " nodi"
            + (result.missing ? ", " + result.missing + " non trovati." : "."),
            result.missing > 0);
    };

    deleteButton.onclick = () => {
        const name = select.value;
        if (!name || !state.presets[name]) return;
        delete state.presets[name];
        state.selected = "";
        emit();
        refreshSelect();
        nameInput.value = "";
        setStatus("Preset “" + name + "” eliminato.");
    };

    exportButton.onclick = () => {
        const name = select.value;
        const preset = state.presets[name];
        if (!preset) {
            setStatus("Seleziona prima un preset o un'istanza.", true);
            return;
        }
        downloadJson({
            format: "h3-workflow-instance",
            version: 1,
            name,
            preset: cloneValue(preset),
        }, safeFileName(name) + ".h3instance.json");
        setStatus("Istanza “" + name + "” esportata.");
    };

    importButton.onclick = () => chooseJsonFile((parsed, fileName, error) => {
        if (error) {
            setStatus(fileName + ": JSON non valido.", true);
            return;
        }
        if (parsed?.format !== "h3-workflow-instance"
                || !parsed.preset || !Array.isArray(parsed.preset.nodes)) {
            setStatus(fileName + ": non e un'istanza H3 valida.", true);
            return;
        }
        const base = String(parsed.name || fileName.replace(/\.json$/i, "")
            || "istanza importata").trim();
        let name = base;
        let suffix = 2;
        while (state.presets[name]) name = base + " (" + suffix++ + ")";
        state.presets[name] = cloneValue(parsed.preset);
        state.presets[name].scope = state.presets[name].scope || "complete";
        state.selected = name;
        nameInput.value = name;
        emit();
        refreshSelect();
        setStatus("Istanza “" + name + "” importata; premi RICHIAMA per applicarla.");
    });

    workflowButton.onclick = () => {
        try {
            emit();
            const name = nameInput.value.trim() || select.value
                || "H3-workflow-instance";
            downloadJson(exportWholeWorkflow(),
                safeFileName(name) + ".workflow.json");
            setStatus("Workflow ComfyUI completo esportato: nodi, link, prompt e impostazioni.");
        } catch (error) {
            setStatus("Esportazione workflow fallita: " + error.message, true);
        }
    };
    const domWidget = node.addDOMWidget?.(
        "h3_preset_ui", "custom", root,
        { serialize: false, hideOnZoom: false, getHeight: () => 285 });
    if (!domWidget) return;
    node.setSize?.([Math.max(650, node.size?.[0] || 650), 345]);
    domWidget.computeSize = () =>
        [Math.max(630, node.size?.[0] || 650), 285];

    const restore = () => {
        state = parseState(stateWidget.value);
        refreshSelect();
        if (state.selected) nameInput.value = state.selected;
    };
    const configured = node.onConfigure;
    node.onConfigure = function () {
        const result = configured?.apply(this, arguments);
        requestAnimationFrame(restore);
        return result;
    };
    refreshSelect();
    requestAnimationFrame(restore);
}

app.registerExtension({
    name: "h3_multishot.workflow_presets",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            requestAnimationFrame(() => install(this));
            return result;
        };
    },
    async nodeCreated(node) {
        if (node?.comfyClass === NODE_NAME) install(node);
    },
    async loadedGraphNode(node) {
        if (node?.comfyClass === NODE_NAME) install(node);
    },
});