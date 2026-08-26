import { app } from "../../scripts/app.js";

const IT2V = "H3IT2VShotPromptBuilder";
const R2V = "H3R2VShotPromptBuilder";
const TASK_TYPES = [
    "keyframe completion", "reference generation", "video editing",
    "video continuation", "audio reuse", "audio reference",
];
const PICTURE_INDICES = Object.freeze(Array.from({ length: 9 }, (_, i) => i + 1));
const I2V_ANCHOR = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";
const TASK_HELP = {
    "keyframe completion": "Una <Picture N> e un frame concreto del risultato: primo frame, ultimo frame, keyframe intermedio o frame da completare.",
    "reference generation": "I riferimenti guidano identita, personaggi, ambiente, stile, azione, camera o storyboard, ma il video viene generato da zero.",
    "video editing": "Un <Video N> esistente viene modificato direttamente. Non usarlo per una semplice immagine o character sheet.",
    "video continuation": "Il nuovo contenuto prosegue o estende la fine di un <Video N> sorgente.",
    "audio reuse": "Il segnale di un <Audio N> viene copiato realmente, tutto o in parte, nel risultato.",
    "audio reference": "L'audio non viene copiato: guida soltanto voce, timbro, ritmo, stile musicale, parole o texture sonora.",
};

let stylesInstalled = false;

function installStyles() {
    if (stylesInstalled) return;
    stylesInstalled = true;
    const style = document.createElement("style");
    style.textContent = [
        ".h3pb{box-sizing:border-box;width:100%;font:12px system-ui,sans-serif;color:#dce8ef;display:flex;flex-direction:column;gap:8px;padding:4px}",
        ".h3pb *{box-sizing:border-box}",
        ".h3pb-help{color:#a9bdc9;background:#111b22;border:1px solid #38505d;border-radius:6px;padding:7px;line-height:1.35}",
        ".h3pb-toolbar{display:flex;gap:6px;flex-wrap:wrap;position:sticky;top:0;z-index:2;background:#16232b;padding:5px;border-radius:6px}",
        ".h3pb button{background:#243946;color:#e8f4fa;border:1px solid #527082;border-radius:5px;padding:5px 9px;cursor:pointer;font-weight:600}",
        ".h3pb button:hover{background:#315062;border-color:#7db2cf}",
        ".h3pb .h3pb-add{background:#214c36;border-color:#52a877;color:#d7ffe5}",
        ".h3pb .h3pb-import{background:#243b57;border-color:#5d8fc0;color:#e1f0ff}",
        ".h3pb .h3pb-toggle{background:#573f1d;border-color:#b9873f;color:#fff0cc}",
        ".h3pb .h3pb-remove{background:#4b2a2a;border-color:#a75e5e;color:#ffdede}",
        ".h3pb-status{border-radius:5px;padding:6px 8px;font-size:11px;line-height:1.35}",
        ".h3pb-status-ok{background:#153525;border:1px solid #3c8b5c;color:#caffda}",
        ".h3pb-status-error{background:#411f24;border:1px solid #a95762;color:#ffdce0}",
        ".h3pb-global,.h3pb-shot{border:1px solid #425c6b;border-radius:7px;padding:8px;background:#10191f;display:flex;flex-direction:column;gap:7px}",
        ".h3pb-shot-title{font-size:13px;font-weight:800;color:#fff;padding-bottom:4px;border-bottom:1px solid #334b58}",
        ".h3pb-field{display:flex;flex-direction:column;gap:3px}",
        ".h3pb-label{font-weight:700;color:#b9d8e8}",
        ".h3pb-note{font-size:10px;color:#8199a6}",
        ".h3pb textarea{width:100%;min-height:76px;resize:vertical;background:#0b1116;color:#edf7fc;border:1px solid #3d5969;border-radius:5px;padding:7px;line-height:1.35}",
        ".h3pb textarea:focus{outline:1px solid #70b8df;border-color:#70b8df}",
        ".h3pb-tasks{display:flex;gap:8px;flex-wrap:wrap;padding:4px 0}",
        ".h3pb-task{display:flex;gap:4px;align-items:center;color:#bcd0da}",
        ".h3pb-task-panel{border:1px solid #527082;border-radius:6px;padding:8px;background:#172731;display:flex;flex-direction:column;gap:5px}",
        ".h3pb-task-panel .h3pb-label{color:#e3f4fc}",
        ".h3pb-task-guide{display:flex;flex-direction:column;gap:4px;margin-top:4px;padding-top:6px;border-top:1px solid #38505d;font-size:10px;line-height:1.3}",
        ".h3pb-task-guide-row{color:#9eb7c4}",
        ".h3pb-task-guide-row strong{color:#d7f1ff}",
        ".h3pb-task-example{margin-top:3px;padding:5px 6px;border-radius:4px;background:#10202a;color:#b9d8e8}",
        ".h3pb-ref-panel{border:1px solid #6f5a35;border-radius:6px;padding:7px;background:#211b12;display:flex;flex-direction:column;gap:5px}",
        ".h3pb-ref-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
        ".h3pb-ref-head .h3pb-label{color:#ffe2a8}",
        ".h3pb-ref-checks{display:flex;gap:10px;flex-wrap:wrap}",
        ".h3pb-ref-check{display:flex;gap:4px;align-items:center;color:#ffe0a0;font-weight:700}",
        ".h3pb-ref-actions{margin-left:auto;display:flex;gap:4px}",
        ".h3pb .h3pb-ref-mini{font-size:10px;padding:2px 6px;background:#3a2c16;border-color:#806638}",
        ".h3pb-count{margin-left:auto;color:#a8dabb;padding:5px 8px}",
        ".h3pb-mode{border:1px solid #527082;border-radius:8px;padding:8px;background:#14212a;display:flex;flex-direction:column;gap:8px}",
        ".h3pb-mode-title{font-size:14px;font-weight:900;color:#d7f1ff;padding:5px 3px;border-bottom:2px solid #527082}",
        ".h3pb-mode-note{font-size:11px;color:#9eb7c4;line-height:1.35}",
        ".h3pb-classic{border:1px solid #9a733a;border-radius:8px;padding:9px;background:#1d1810;display:flex;flex-direction:column;gap:9px}",
        ".h3pb-classic .h3pb-shot-title{color:#ffe7b8;border-color:#6f542e}",
        ".h3pb-classic textarea{min-height:520px;font-family:Consolas,'Cascadia Mono',monospace;font-size:12px;white-space:pre;tab-size:4}",
        ".h3pb-classic-warning{color:#ffdca0;background:#3a2a13;border:1px solid #966b2c;border-radius:6px;padding:7px;line-height:1.35}",
    ].join("");
    document.head.appendChild(style);
}

function defaultShot() {
    return { description: "", soundscape: "", music: "N/A" };
}

function defaultR2VShot() {
    return {
        ...defaultShot(),
        active_ref_images: [...PICTURE_INDICES],
    };
}
function defaultState(kind) {
    if (kind === "r2v") {
        return {
            version: 1, kind: "r2v", editor_mode: "structured",
            classic_r2v_script: "", subject_definitions: "",
            task_types: ["reference generation"], summary: "",
            retention_analysis: "", style: "", shots: [defaultR2VShot()],
        };
    }
    return {
        version: 1, kind: "it2v", editor_mode: "structured",
        classic_t2v_script: "", classic_i2v_script: "",
        t2v_shots: [defaultShot()], i2v_shots: [defaultShot()],
    };
}

function parseState(value, kind) {
    let state;
    try {
        state = JSON.parse(value || "{}");
    } catch {
        state = defaultState(kind);
    }
    if (!state || typeof state !== "object" || Array.isArray(state)) {
        state = defaultState(kind);
    }

    const legacyShots = Array.isArray(state.shots) ? state.shots : null;
    const rawT2VShots = Array.isArray(state.t2v_shots)
        ? state.t2v_shots : legacyShots;
    const rawI2VShots = Array.isArray(state.i2v_shots)
        ? state.i2v_shots : legacyShots;
    state = { ...defaultState(kind), ...state, kind };
    state.editor_mode = state.editor_mode === "classic"
        ? "classic" : "structured";
    if (kind === "r2v") {
        state.classic_r2v_script = String(state.classic_r2v_script || "");
    } else {
        state.classic_t2v_script = String(state.classic_t2v_script || "");
        state.classic_i2v_script = String(state.classic_i2v_script || "");
    }
    const normalizeShots = (shots, referenceMode = false) => {
        if (!Array.isArray(shots) || !shots.length) {
            shots = [referenceMode ? defaultR2VShot() : defaultShot()];
        }
        return shots.slice(0, 64).map(rawShot => {
            const shot = {
                ...defaultShot(),
                ...(rawShot && typeof rawShot === "object" ? rawShot : {}),
            };
            if (referenceMode) {
                shot.active_ref_images = Array.isArray(shot.active_ref_images)
                    ? PICTURE_INDICES.filter(index =>
                        shot.active_ref_images.includes(index))
                    : [...PICTURE_INDICES];
            } else {
                delete shot.active_ref_images;
            }
            return shot;
        });
    };

    if (kind === "r2v") {
        state.shots = normalizeShots(state.shots, true);
        if (!Array.isArray(state.task_types)) state.task_types = ["reference generation"];
        state.task_types = TASK_TYPES.filter(item => state.task_types.includes(item));
        if (!state.task_types.length) state.task_types = ["reference generation"];
    } else {
        state.t2v_shots = normalizeShots(rawT2VShots);
        state.i2v_shots = normalizeShots(rawI2VShots);
        delete state.shots;
    }
    return state;
}

function splitPromptBlocks(text) {
    return String(text || "")
        .replace(/^\uFEFF/, "")
        .replace(/\r\n?/g, "\n")
        .trim()
        .split(/\n[ \t]*---[ \t]*(?:\n|$)/)
        .map(block => block.trim())
        .filter(Boolean)
        .slice(0, 64);
}

function extractSections(block, headings) {
    const escaped = headings.map(name =>
        name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"));
    const matcher = new RegExp(
        "^[ \\t]*(" + escaped.join("|") + ")[ \\t]*:[ \\t]*", "gim");
    const matches = [...block.matchAll(matcher)];
    const sections = {};
    matches.forEach((match, index) => {
        const key = match[1].toLowerCase();
        const end = index + 1 < matches.length ? matches[index + 1].index : block.length;
        sections[key] = block.slice(match.index + match[0].length, end).trim();
    });
    return sections;
}

function stripLocalShotMarker(value) {
    return String(value || "")
        .replace(/^[ \t]*\[Shot[ \t]+\d+\][ \t]*/i, "")
        .trim();
}

function stripHeading(value, ...headings) {
    let text = String(value || "").trim();
    for (const heading of headings) {
        const escaped = heading.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
        text = text.replace(
            new RegExp("^\\s*" + escaped + "\\s*:\\s*", "i"), "");
    }
    return text.trim();
}

function localShotDescription(value) {
    const text = stripHeading(
        value, "integrated_multimodal_description", "detailed_description");
    return /^\s*\[Shot\s+\d+\]/i.test(text)
        ? text : ("[Shot 1] " + text).trim();
}

function exportIT2VPrompt(shots, anchorFirst) {
    return shots.map((shot, index) => {
        const body = [
            "integrated_multimodal_description: " +
                localShotDescription(shot.description),
            "overall_soundscape: " +
                stripHeading(shot.soundscape, "overall_soundscape"),
            "non_diegetic_music: " +
                (stripHeading(shot.music, "non_diegetic_music") || "N/A"),
        ].join("\n\n");
        return anchorFirst || index > 0 ? I2V_ANCHOR + "\n\n" + body : body;
    }).join("\n---\n");
}

function summaryLine(state) {
    const summary = stripHeading(state.summary, "summary");
    if (summary.startsWith("[")) return summary;
    const selected = TASK_TYPES.filter(task => state.task_types.includes(task));
    return "[" + (selected.length ? selected : ["reference generation"]).join(" + ") +
        "]" + (summary ? " " + summary : "");
}

function exportR2VPrompt(state) {
    const subjects = stripHeading(
        state.subject_definitions, "subject_definitions");
    const retention = stripHeading(
        state.retention_analysis, "retention_analysis");
    const style = String(state.style || "").trim();
    return state.shots.map(shot => {
        const detail = [style, localShotDescription(shot.description)]
            .filter(Boolean).join("\n");
        return [
            "subject_definitions:\n" + subjects,
            "summary:\n" + summaryLine(state),
            "retention_analysis:\n" + retention,
            "detailed_description:\n" + detail,
            "overall_soundscape:\n" +
                stripHeading(shot.soundscape, "overall_soundscape"),
            "non_diegetic_music:\n" +
                (stripHeading(shot.music, "non_diegetic_music") || "N/A"),
        ].join("\n\n");
    }).join("\n---\n");
}

function importIT2VPrompt(text) {
    const blocks = splitPromptBlocks(text);
    if (!blocks.length) throw new Error("Il file non contiene alcuno shot.");
    return blocks.map((block, index) => {
        const sections = extractSections(block, [
            "integrated_multimodal_description",
            "detailed_description",
            "overall_soundscape",
            "non_diegetic_music",
        ]);
        const description = sections.integrated_multimodal_description
            ?? sections.detailed_description;
        if (description === undefined) {
            throw new Error(
                "Shot " + (index + 1) + ": manca integrated_multimodal_description:.");
        }
        return {
            description: stripLocalShotMarker(description),
            soundscape: sections.overall_soundscape || "",
            music: sections.non_diegetic_music || "N/A",
        };
    });
}

function splitR2VDetail(value) {
    const text = String(value || "").trim();
    const marker = /(?:^|\n)[ \t]*\[Shot[ \t]+\d+\][ \t]*/i.exec(text);
    if (!marker) return { style: "", description: text };
    return {
        style: text.slice(0, marker.index).trim(),
        description: text.slice(marker.index + marker[0].length).trim(),
    };
}

function activePicturesFromBlock(block) {
    const match = /^[ \t]*__H3_ACTIVE_PICTURES__[ \t]*:[ \t]*([^\r\n]+)/im.exec(
        String(block || ""));
    if (!match) return [...PICTURE_INDICES];
    const value = match[1].trim().toLowerCase();
    if (!value || ["none", "off"].includes(value)) return [];
    return PICTURE_INDICES.filter(index =>
        new RegExp("(^|\\D)" + index + "(\\D|$)").test(value));
}
function importR2VPrompt(text) {
    const blocks = splitPromptBlocks(text);
    if (!blocks.length) throw new Error("Il file non contiene alcuno shot.");
    let globals = null;
    const shots = blocks.map((block, index) => {
        const sections = extractSections(block, [
            "subject_definitions", "summary", "retention_analysis",
            "detailed_description", "integrated_multimodal_description",
            "overall_soundscape", "non_diegetic_music",
        ]);
        const detailed = sections.detailed_description
            ?? sections.integrated_multimodal_description;
        if (detailed === undefined) {
            throw new Error("Shot " + (index + 1) + ": manca detailed_description:.");
        }
        const detail = splitR2VDetail(detailed);
        if (!globals) {
            const rawSummary = sections.summary || "";
            const summaryMatch = /^\s*\[([^\]]+)\]\s*([\s\S]*)$/i.exec(rawSummary);
            const selected = summaryMatch
                ? summaryMatch[1].split("+").map(item => item.trim().toLowerCase())
                : [];
            const taskTypes = TASK_TYPES.filter(item => selected.includes(item));
            globals = {
                subject_definitions: sections.subject_definitions || "",
                task_types: taskTypes.length ? taskTypes : ["reference generation"],
                summary: summaryMatch ? summaryMatch[2].trim() : rawSummary,
                retention_analysis: sections.retention_analysis || "",
                style: detail.style,
            };
        }
        return {
            description: detail.description,
            soundscape: sections.overall_soundscape || "",
            music: sections.non_diegetic_music || "N/A",
            active_ref_images: activePicturesFromBlock(block),
        };
    });
    return { ...globals, shots };
}

function chooseTextFile(onLoaded) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,.md,text/plain,text/markdown";
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        await onLoaded(await file.text(), file.name);
    };
    input.click();
}
function stopGraphShortcuts(element) {
    for (const name of [
        "pointerdown", "mousedown", "keydown", "keypress", "keyup",
        "copy", "cut", "paste", "wheel",
    ]) {
        element.addEventListener(name, event => event.stopPropagation());
    }
}

function field(label, note, value, rows, onInput) {
    const wrap = document.createElement("label");
    wrap.className = "h3pb-field";
    const title = document.createElement("span");
    title.className = "h3pb-label";
    title.textContent = label;
    wrap.append(title);
    if (note) {
        const hint = document.createElement("span");
        hint.className = "h3pb-note";
        hint.textContent = note;
        wrap.append(hint);
    }
    const area = document.createElement("textarea");
    area.rows = rows;
    area.value = value || "";
    area.addEventListener("input", () => onInput(area.value));
    stopGraphShortcuts(area);
    wrap.append(area);
    return wrap;
}

function hideStateWidget(widget) {
    if (!widget) return;
    widget.hidden = true;
    widget.options = { ...(widget.options || {}), hidden: true };
    widget.draw = () => {};
    widget.computeSize = () => [0, -4];
}

function install(node, kind) {
    if (!node || node._h3PromptBuilderInstalled) return;
    node._h3PromptBuilderInstalled = true;
    installStyles();

    const stateWidget = node.widgets?.find(widget => widget.name === "state_json");
    if (!stateWidget) return;
    hideStateWidget(stateWidget);

    let state = parseState(stateWidget.value, kind);
    let importStatus = "";
    let importFailed = false;
    const root = document.createElement("div");
    root.className = "h3pb";

    const emit = () => {
        state.version = kind === "r2v" ? 2 : 1;
        state.kind = kind;
        stateWidget.value = JSON.stringify(state);
        stateWidget.callback?.(stateWidget.value);
        node.graph?.setDirtyCanvas?.(true, true);
    };

    const resize = () => {
        if (state.editor_mode === "classic") {
            const height = kind === "r2v" ? 760 : 1370;
            root.style.height = height + "px";
            node.setSize?.([Math.max(620, node.size?.[0] || 620), height + 50]);
            domWidget.computeSize = () => [
                Math.max(600, node.size?.[0] || 620), height];
            return;
        }
        const shotHeight = kind === "r2v" ? 500 : 355;
        const globals = kind === "r2v" ? 930 : 245;
        const shotCount = kind === "r2v"
            ? state.shots.length
            : state.t2v_shots.length + state.i2v_shots.length;
        const height = Math.max(420, globals + shotCount * shotHeight);
        root.style.height = height + "px";
        node.setSize?.([Math.max(540, node.size?.[0] || 540), height + 50]);
        domWidget.computeSize = () => [Math.max(520, node.size?.[0] || 540), height];
    };

    const enterClassicMode = () => {
        if (kind === "r2v") {
            state.classic_r2v_script = exportR2VPrompt(state);
        } else {
            state.classic_t2v_script = exportIT2VPrompt(
                state.t2v_shots, false);
            state.classic_i2v_script = exportIT2VPrompt(
                state.i2v_shots, true);
        }
        state.editor_mode = "classic";
        importFailed = false;
        importStatus = "Modalita testo classico attiva: queste textbox sono ora il prompt realmente eseguito.";
        emit();
        render();
    };

    const applyClassicMode = () => {
        try {
            if (kind === "r2v") {
                const imported = importR2VPrompt(state.classic_r2v_script);
                state = { ...state, ...imported, editor_mode: "structured" };
                importStatus = "Testo applicato ai blocchi. Controlla e reimposta le Picture attive per ogni shot.";
            } else {
                state.t2v_shots = importIT2VPrompt(
                    state.classic_t2v_script);
                state.i2v_shots = importIT2VPrompt(
                    state.classic_i2v_script);
                state.editor_mode = "structured";
                importStatus = "Testi T2V e I2V applicati ai blocchi separati.";
            }
            importFailed = false;
            emit();
            render();
        } catch (error) {
            importFailed = true;
            importStatus = "Impossibile tornare ai blocchi: " +
                (error.message || error);
            render();
        }
    };

    const render = () => {
        root.replaceChildren();

        const help = document.createElement("div");
        help.className = "h3pb-help";
        help.textContent = kind === "r2v"
            ? "R2V: scrivi soltanto il contenuto e spunta le Picture che devono essere attive in ogni shot. Il nodo filtra davvero i riferimenti e inserisce automaticamente formato e separatori."
            : "T2V e I2V hanno editor indipendenti. Inserisci soltanto il contenuto: titoli, [Shot 1], anchor I2V e --- vengono creati automaticamente.";
        root.append(help);

        if (importStatus) {
            const status = document.createElement("div");
            status.className = "h3pb-status " + (importFailed
                ? "h3pb-status-error" : "h3pb-status-ok");
            status.textContent = importStatus;
            root.append(status);
        }

        const modeToolbar = document.createElement("div");
        modeToolbar.className = "h3pb-toolbar";
        const modeButton = document.createElement("button");
        modeButton.className = "h3pb-toggle";
        if (state.editor_mode === "classic") {
            modeButton.textContent = "APPLICA E TORNA AI BLOCCHI";
            modeButton.title = "Converte il testo formattato nelle textbox separate";
            modeButton.onclick = applyClassicMode;
        } else {
            modeButton.textContent = "PASSA A TESTO CLASSICO";
            modeButton.title = "Mostra il prompt completo in una textbox libera";
            modeButton.onclick = enterClassicMode;
        }
        modeToolbar.append(modeButton);
        root.append(modeToolbar);

        if (state.editor_mode === "classic") {
            const warning = document.createElement("div");
            warning.className = "h3pb-classic-warning";
            warning.textContent = kind === "r2v"
                ? "In questa modalita puoi copiare, incollare e modificare liberamente il prompt completo. La selezione Picture per-shot non e visibile: tornando ai blocchi controllala e reimpostala."
                : "In questa modalita puoi copiare, incollare e modificare liberamente i prompt completi. Mantieni --- su una riga separata tra gli shot.";
            root.append(warning);

            const classic = document.createElement("section");
            classic.className = "h3pb-classic";
            const title = document.createElement("div");
            title.className = "h3pb-shot-title";
            title.textContent = kind === "r2v"
                ? "R2V - PROMPT COMPLETO CLASSICO"
                : "I/T2V - PROMPT COMPLETI CLASSICI";
            classic.append(title);
            if (kind === "r2v") {
                classic.append(field(
                    "REFERENCE TO VIDEO",
                    "Testo completo realmente eseguito. Puoi sostituirlo integralmente con un prompt R2V valido.",
                    state.classic_r2v_script, 34,
                    value => {
                        state.classic_r2v_script = value;
                        emit();
                    }
                ));
            } else {
                classic.append(field(
                    "TEXT TO VIDEO",
                    "Prompt T2V completo: il primo shot non richiede l'anchor I2V.",
                    state.classic_t2v_script, 30,
                    value => {
                        state.classic_t2v_script = value;
                        emit();
                    }
                ));
                classic.append(field(
                    "IMAGE TO VIDEO",
                    "Prompt I2V completo: conserva l'anchor iniziale in ogni blocco.",
                    state.classic_i2v_script, 30,
                    value => {
                        state.classic_i2v_script = value;
                        emit();
                    }
                ));
            }
            root.append(classic);
            resize();
            return;
        }

        const makeToolbar = (
            shots, addLabel, removeLabel, onAdd, onRemove,
            importLabel, onImport
        ) => {
            const toolbar = document.createElement("div");
            toolbar.className = "h3pb-toolbar";
            const add = document.createElement("button");
            add.className = "h3pb-add";
            add.textContent = addLabel;
            add.onclick = onAdd;
            const remove = document.createElement("button");
            remove.className = "h3pb-remove";
            remove.textContent = removeLabel;
            remove.onclick = onRemove;
            const importButton = document.createElement("button");
            importButton.className = "h3pb-import";
            importButton.textContent = importLabel;
            importButton.title = "Carica un prompt completo con sezioni ufficiali e --- tra gli shot";
            importButton.onclick = onImport;
            const count = document.createElement("span");
            count.className = "h3pb-count";
            count.textContent = shots.length + " shot";
            toolbar.append(add, remove, importButton, count);
            return toolbar;
        };

        const appendShotCard = (container, shot, index, prefix) => {
            const card = document.createElement("section");
            card.className = "h3pb-shot";
            const title = document.createElement("div");
            title.className = "h3pb-shot-title";
            title.textContent = prefix + " SHOT " + (index + 1) + " - contenuto della clip";
            card.append(title);
            if (kind === "r2v") {
                const refPanel = document.createElement("div");
                refPanel.className = "h3pb-ref-panel";
                const refHead = document.createElement("div");
                refHead.className = "h3pb-ref-head";
                const refTitle = document.createElement("span");
                refTitle.className = "h3pb-label";
                refTitle.textContent = "PICTURE ATTIVE IN QUESTO SHOT";
                const refActions = document.createElement("div");
                refActions.className = "h3pb-ref-actions";
                const setPictures = selected => {
                    shot.active_ref_images = [...selected];
                    emit();
                    render();
                };
                const allButton = document.createElement("button");
                allButton.className = "h3pb-ref-mini";
                allButton.textContent = "TUTTE";
                allButton.onclick = () => setPictures(PICTURE_INDICES);
                const noneButton = document.createElement("button");
                noneButton.className = "h3pb-ref-mini";
                noneButton.textContent = "NESSUNA";
                noneButton.onclick = () => setPictures([]);
                refActions.append(allButton, noneButton);
                refHead.append(refTitle, refActions);

                const selected = new Set(
                    Array.isArray(shot.active_ref_images)
                        ? shot.active_ref_images : PICTURE_INDICES);
                const refChecks = document.createElement("div");
                refChecks.className = "h3pb-ref-checks";
                for (const pictureIndex of PICTURE_INDICES) {
                    const label = document.createElement("label");
                    label.className = "h3pb-ref-check";
                    const checkbox = document.createElement("input");
                    checkbox.type = "checkbox";
                    checkbox.checked = selected.has(pictureIndex);
                    checkbox.onchange = () => {
                        checkbox.checked
                            ? selected.add(pictureIndex)
                            : selected.delete(pictureIndex);
                        shot.active_ref_images = PICTURE_INDICES.filter(
                            value => selected.has(value));
                        emit();
                    };
                    label.append(
                        checkbox,
                        document.createTextNode("Picture " + pictureIndex));
                    refChecks.append(label);
                }
                const refNote = document.createElement("span");
                refNote.className = "h3pb-note";
                refNote.textContent = "Solo le immagini spuntate vengono inviate a questo shot. I marker vengono rinumerati automaticamente; non devi cambiare il testo.";
                refPanel.append(refHead, refChecks, refNote);
                card.append(refPanel);
            }
            card.append(field(
                kind === "r2v" ? "Descrizione dettagliata" : "Descrizione video",
                "Non scrivere il nome della sezione, [Shot 1] o ---: vengono inseriti automaticamente.",
                shot.description, 8,
                value => { shot.description = value; emit(); }
            ));
            card.append(field(
                "Suoni ambientali e fisici",
                "Niente dialoghi qui: il dialogo resta nella descrizione video.",
                shot.soundscape, 4,
                value => { shot.soundscape = value; emit(); }
            ));
            card.append(field(
                "Musica non diegetica",
                "Lascia N/A se non vuoi musica udibile soltanto dal pubblico.",
                shot.music, 3,
                value => { shot.music = value; emit(); }
            ));
            container.append(card);
        };

        const appendModeEditor = (key, titleText, noteText) => {
            const section = document.createElement("section");
            section.className = "h3pb-mode";
            const title = document.createElement("div");
            title.className = "h3pb-mode-title";
            title.textContent = titleText;
            const note = document.createElement("div");
            note.className = "h3pb-mode-note";
            note.textContent = noteText;
            section.append(title, note);
            const shortName = titleText.split(" ")[0];
            section.append(makeToolbar(
                state[key],
                "+ AGGIUNGI SHOT " + shortName,
                "- RIMUOVI ULTIMO " + shortName,
                () => {
                    if (state[key].length >= 64) return;
                    state[key].push(defaultShot());
                    emit();
                    render();
                },
                () => {
                    if (state[key].length <= 1) return;
                    state[key].pop();
                    emit();
                    render();
                },
                "IMPORTA TXT " + shortName,
                () => chooseTextFile(async (text, fileName) => {
                    try {
                        state[key] = importIT2VPrompt(text);
                        importFailed = false;
                        importStatus = fileName + ": importati " + state[key].length + " shot " + shortName + ".";
                        emit();
                        render();
                    } catch (error) {
                        importFailed = true;
                        importStatus = fileName + ": " + (error.message || error);
                        render();
                    }
                })
            ));
            state[key].forEach((shot, index) =>
                appendShotCard(section, shot, index, shortName));
            root.append(section);
        };

        if (kind === "r2v") {
            root.append(makeToolbar(
                state.shots, "+ AGGIUNGI SHOT R2V", "- RIMUOVI ULTIMO R2V",
                () => {
                    if (state.shots.length >= 64) return;
                    state.shots.push(defaultR2VShot());
                    emit();
                    render();
                },
                () => {
                    if (state.shots.length <= 1) return;
                    state.shots.pop();
                    emit();
                    render();
                },
                "IMPORTA TXT R2V",
                () => chooseTextFile(async (text, fileName) => {
                    try {
                        const imported = importR2VPrompt(text);
                        state = { ...state, ...imported };
                        importFailed = false;
                        importStatus = fileName + ": importati " + state.shots.length + " shot R2V.";
                        emit();
                        render();
                    } catch (error) {
                        importFailed = true;
                        importStatus = fileName + ": " + (error.message || error);
                        render();
                    }
                })
            ));

            const globals = document.createElement("section");
            globals.className = "h3pb-global";
            const globalTitle = document.createElement("div");
            globalTitle.className = "h3pb-shot-title";
            globalTitle.textContent = "RIFERIMENTI GLOBALI - validi per ogni shot";
            globals.append(globalTitle);

            const taskPanel = document.createElement("div");
            taskPanel.className = "h3pb-task-panel";
            const taskLabel = document.createElement("span");
            taskLabel.className = "h3pb-label";
            taskLabel.textContent = "TIPO DI OPERAZIONE R2V - seleziona uno o piu flag";
            taskPanel.append(taskLabel);
            const tasks = document.createElement("div");
            tasks.className = "h3pb-tasks";
            for (const task of TASK_TYPES) {
                const label = document.createElement("label");
                label.className = "h3pb-task";
                label.title = TASK_HELP[task];
                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.checked = state.task_types.includes(task);
                checkbox.onchange = () => {
                    const selected = new Set(state.task_types);
                    checkbox.checked ? selected.add(task) : selected.delete(task);
                    state.task_types = TASK_TYPES.filter(item => selected.has(item));
                    if (!state.task_types.length) state.task_types = ["reference generation"];
                    emit();
                };
                label.append(checkbox, document.createTextNode(task));
                tasks.append(label);
            }
            taskPanel.append(tasks);
            const taskNote = document.createElement("span");
            taskNote.className = "h3pb-note";
            taskNote.textContent = "Il prefisso [...] viene creato automaticamente. L'importazione TXT imposta questi flag dal campo summary.";
            taskPanel.append(taskNote);
            const taskGuide = document.createElement("div");
            taskGuide.className = "h3pb-task-guide";
            for (const task of TASK_TYPES) {
                const row = document.createElement("div");
                row.className = "h3pb-task-guide-row";
                const name = document.createElement("strong");
                name.textContent = task + ": ";
                row.append(name, document.createTextNode(TASK_HELP[task]));
                taskGuide.append(row);
            }
            const taskExample = document.createElement("div");
            taskExample.className = "h3pb-task-example";
            taskExample.textContent = "Esempi: character sheet -> reference generation. Start image come primo frame + character refs -> keyframe completion + reference generation. Edit del video mantenendo l'audio -> video editing + audio reuse.";
            taskGuide.append(taskExample);
            taskPanel.append(taskGuide);
            globals.append(taskPanel);

            globals.append(field(
                "Definizioni soggetti e riferimenti",
                "Esempio: <Subject 1> is the character in <Picture 1>, preserving identity and clothing.",
                state.subject_definitions, 5,
                value => { state.subject_definitions = value; emit(); }
            ));

            globals.append(field(
                "Riassunto",
                "Scrivi solo la frase; non scrivere summary: o il prefisso [reference generation].",
                state.summary, 3,
                value => { state.summary = value; emit(); }
            ));
            globals.append(field(
                "Cosa preservare / trasferire",
                "Una riga per riferimento con marker come fully_preserved, attribute_transfer o reference.",
                state.retention_analysis, 5,
                value => { state.retention_analysis = value; emit(); }
            ));
            globals.append(field(
                "Stile visivo globale",
                "Una o due frasi, senza scrivere detailed_description: e senza [Shot 1].",
                state.style, 3,
                value => { state.style = value; emit(); }
            ));
            root.append(globals);
            state.shots.forEach((shot, index) =>
                appendShotCard(root, shot, index, "R2V"));
        } else {
            appendModeEditor(
                "t2v_shots", "T2V - TEXT TO VIDEO",
                "Il primo shot parte soltanto dal testo; gli shot successivi continuano automaticamente dall'ultimo frame."
            );
            appendModeEditor(
                "i2v_shots", "I2V - IMAGE TO VIDEO",
                "Ogni segmento usa l'immagine iniziale corretta: la foto esterna per il primo shot e il frame precedente per le continuazioni."
            );
        }

        resize();
    };

    let domWidget = node.addDOMWidget?.(
        "h3_prompt_builder_ui", "custom", root,
        { serialize: false, hideOnZoom: false, getHeight: () => parseInt(root.style.height || "420", 10) }
    );
    if (!domWidget) return;

    const restore = () => {
        state = parseState(stateWidget.value, kind);
        render();
    };
    node._h3PromptBuilderReload = restore;
    const configured = node.onConfigure;
    node.onConfigure = function () {
        const result = configured?.apply(this, arguments);
        requestAnimationFrame(restore);
        return result;
    };

    const resized = node.onResize;
    node.onResize = function () {
        const result = resized?.apply(this, arguments);
        root.style.width = Math.max(1, (node.size?.[0] || 540) - 20) + "px";
        return result;
    };

    render();
    requestAnimationFrame(restore);
}

app.registerExtension({
    name: "h3_multishot.structured_prompt_builders",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (![IT2V, R2V].includes(nodeData.name)) return;
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            requestAnimationFrame(() => install(
                this, nodeData.name === R2V ? "r2v" : "it2v"));
            return result;
        };
    },
    async nodeCreated(node) {
        if (node?.comfyClass === IT2V) install(node, "it2v");
        if (node?.comfyClass === R2V) install(node, "r2v");
    },
    async loadedGraphNode(node) {
        if (node?.comfyClass === IT2V) install(node, "it2v");
        if (node?.comfyClass === R2V) install(node, "r2v");
    },
});

