import { app } from "../../scripts/app.js";

const NODE_NAME = "H3AIOAutopromptRequest";

function nodeType(node) {
    return node?.comfyClass ?? node?.type ?? null;
}

function promptWidget(node) {
    return node?.widgets?.find(widget => widget.name === "natural_prompt");
}

function promptElement(widget) {
    const direct = widget?.inputEl ?? widget?.element;
    if (direct?.matches?.("textarea,input")) return direct;
    return direct?.querySelector?.("textarea,input") ?? null;
}

function stopGraphShortcuts(element) {
    for (const name of [
        "pointerdown", "mousedown", "mouseup", "click",
        "keydown", "keypress", "keyup", "wheel",
    ]) {
        element.addEventListener(name, event => event.stopPropagation());
    }
}

function insertTag(node, tag, status) {
    const widget = promptWidget(node);
    if (!widget) return;
    const input = promptElement(widget);
    const current = String(input?.value ?? widget.value ?? "");
    let start = input?.selectionStart;
    let end = input?.selectionEnd;
    if (!Number.isInteger(start)) start = node._h3PromptCursor ?? current.length;
    if (!Number.isInteger(end)) end = start;
    start = Math.max(0, Math.min(current.length, start));
    end = Math.max(start, Math.min(current.length, end));

    const before = current.slice(0, start);
    const after = current.slice(end);
    const left = before && !/\s$/.test(before) ? " " : "";
    const right = after && !/^(?:\s|[.,;:!?\)\]])/.test(after) ? " " : "";
    const insertion = left + tag + right;
    const updated = before + insertion + after;
    const cursor = before.length + insertion.length;

    widget.value = updated;
    if (input) {
        input.value = updated;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        requestAnimationFrame(() => {
            input.focus();
            input.setSelectionRange?.(cursor, cursor);
            node._h3PromptCursor = cursor;
        });
    }
    widget.callback?.call(widget, updated, app.canvas, node);
    node.graph?.setDirtyCanvas?.(true, true);
    if (status) status.textContent = "Inserito " + tag;
}

function makeGroup(node, root, title, prefix, count, status) {
    const group = document.createElement("div");
    group.className = "h3tag-group";
    const label = document.createElement("span");
    label.className = "h3tag-label";
    label.textContent = title;
    group.append(label);
    for (let index = 1; index <= count; index++) {
        const tag = `<${prefix} ${index}>`;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `${prefix} ${index}`;
        button.title = `Inserisci ${tag} nel punto del cursore`;
        button.addEventListener("click", () => insertTag(node, tag, status));
        group.append(button);
    }
    root.append(group);
}

function mount(node) {
    if (!node || node._h3TagInserterMounted) return;
    const widget = promptWidget(node);
    if (!widget) return;
    node._h3TagInserterMounted = true;

    const input = promptElement(widget);
    const rememberCursor = () => {
        if (Number.isInteger(input?.selectionStart)) {
            node._h3PromptCursor = input.selectionStart;
        }
    };
    for (const name of ["focus", "click", "keyup", "select", "input"]) {
        input?.addEventListener(name, rememberCursor);
    }

    const root = document.createElement("div");
    root.className = "h3tag-root";
    root.innerHTML = "<div class='h3tag-title'>INSERISCI REFERENCE NEL PROMPT</div>";
    const help = document.createElement("div");
    help.className = "h3tag-help";
    help.textContent = "Posiziona il cursore nel prompt, poi clicca un input: il tag viene inserito esattamente e resta modificabile.";
    const roleHelp = document.createElement("div");
    roleHelp.className = "h3tag-role-help";
    roleHelp.innerHTML = "<b>SECONDO BOX — REFERENCE ROLES</b><br>Spiega soltanto il ruolo dei file, non la scena. Esempio: &lt;Picture 1&gt; = protagonista, preserva identità; &lt;Picture 2&gt; = abito soltanto; &lt;Picture 3&gt; = sfondo; &lt;Video 1&gt; = movimento; &lt;Audio 1&gt; = voce. Con T2V o riferimenti ovvi puoi lasciare AUTO.";
    const status = document.createElement("div");
    status.className = "h3tag-status";
    status.textContent = "Pronto";
    root.append(help, roleHelp);
    makeGroup(node, root, "IMMAGINI", "Picture", 9, status);
    makeGroup(node, root, "VIDEO", "Video", 3, status);
    makeGroup(node, root, "AUDIO", "Audio", 3, status);
    root.append(status);
    stopGraphShortcuts(root);

    const domWidget = node.addDOMWidget?.(
        "h3_reference_tag_inserter", "custom", root,
        { serialize: false, hideOnZoom: false, getHeight: () => 278 });
    if (!domWidget) return;

    const style = document.createElement("style");
    style.textContent = `
        .h3tag-root{box-sizing:border-box;width:100%;padding:7px;background:#171f2b;border:1px solid #506985;border-radius:7px;color:#dcecff;font:11px system-ui,sans-serif;display:flex;flex-direction:column;gap:5px}
        .h3tag-title{font-size:12px;font-weight:800;color:#bfe3ff}
        .h3tag-help{color:#9fb3c7;line-height:1.25}
        .h3tag-role-help{padding:6px;border-left:3px solid #e7c98e;background:#27231c;color:#e9dfc8;line-height:1.3}
        .h3tag-group{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
        .h3tag-label{width:62px;color:#e7c98e;font-weight:800}
        .h3tag-root button{padding:3px 6px;border-radius:4px;border:1px solid #52789b;background:#263d55;color:#eaf6ff;cursor:pointer;font-size:10px}
        .h3tag-root button:hover{background:#386286;border-color:#8ec7f2}
        .h3tag-status{color:#9ee3b2;min-height:14px}
    `;
    root.append(style);
    node.setSize?.([
        Math.max(node.size?.[0] ?? 0, 820),
        Math.max(node.size?.[1] ?? 0, node.computeSize?.()[1] ?? 0, 1440),
    ]);
}

app.registerExtension({
    name: "h3_multishot.aio_reference_tag_inserter",
    async beforeRegisterNodeDef(nodeTypeDef, nodeData) {
        if (nodeData.name !== NODE_NAME) return;
        const created = nodeTypeDef.prototype.onNodeCreated;
        nodeTypeDef.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            requestAnimationFrame(() => mount(this));
            return result;
        };
    },
    async nodeCreated(node) {
        if (nodeType(node) === NODE_NAME) requestAnimationFrame(() => mount(node));
    },
    async loadedGraphNode(node) {
        if (nodeType(node) === NODE_NAME) requestAnimationFrame(() => mount(node));
    },
});
