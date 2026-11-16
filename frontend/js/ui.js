// toasts and modal dialogs shared by the pages
const TOAST_DURATION_MS = 4500;

const MODAL_ICONS = {
    danger: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/><path d="M10 11v5M14 11v5"/></svg>',
    info: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>',
};

// create the toast container on first use
function toastContainer() {
    let container = document.querySelector(".toasts");
    if (!container) {
        container = document.createElement("div");
        container.className = "toasts";
        container.setAttribute("role", "status");
        container.setAttribute("aria-live", "polite");
        document.body.append(container);
    }
    return container;
}

// show a temporary notification, errors stay twice as long
function toast(message, kind = "info") {
    const item = document.createElement("div");
    item.className = `toast toast-${kind}`;
    const text = document.createElement("span");
    text.textContent = message;
    item.append(text);
    toastContainer().append(item);

    const duration = kind === "error" ? TOAST_DURATION_MS * 2 : TOAST_DURATION_MS;
    setTimeout(() => {
        item.classList.add("is-leaving");
        setTimeout(() => item.remove(), 250);
    }, duration);
}

// build the confirmation dialog once
function buildModal() {
    const modal = document.createElement("dialog");
    modal.className = "modal";
    modal.setAttribute("aria-labelledby", "modal-title");
    modal.setAttribute("aria-describedby", "modal-message");

    const form = document.createElement("form");
    form.method = "dialog";
    form.className = "modal-form";

    const icon = document.createElement("div");
    icon.className = "modal-icon";

    const title = document.createElement("h2");
    title.id = "modal-title";

    const message = document.createElement("p");
    message.id = "modal-message";

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const cancel = document.createElement("button");
    cancel.value = "cancel";
    cancel.className = "button button-ghost";
    const confirm = document.createElement("button");
    confirm.value = "confirm";
    actions.append(cancel, confirm);

    form.append(icon, title, message, actions);
    modal.append(form);
    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            modal.close("cancel");
        }
    });
    document.body.append(modal);
    return { modal, icon, title, message, cancel, confirm };
}

let modalParts = null;

// ask for a confirmation, resolves to true or false
function confirmDialog({ title, message, confirmLabel = "Confirmer", cancelLabel = "Annuler", danger = false }) {
    modalParts = modalParts || buildModal();
    const { modal, icon, cancel, confirm } = modalParts;

    modal.classList.toggle("is-danger", danger);
    icon.innerHTML = danger ? MODAL_ICONS.danger : MODAL_ICONS.info;
    modalParts.title.textContent = title;
    modalParts.message.textContent = message;
    cancel.textContent = cancelLabel;
    confirm.textContent = confirmLabel;
    confirm.className = `button ${danger ? "button-danger" : "button-primary"}`;

    return new Promise((resolve) => {
        modal.addEventListener("close", () => resolve(modal.returnValue === "confirm"), { once: true });
        modal.returnValue = "";
        modal.showModal();
        (danger ? cancel : confirm).focus();
    });
}

// build an empty dialog with a title, a body and actions
function buildFormModal(className) {
    const modal = document.createElement("dialog");
    modal.className = `modal ${className}`;
    const form = document.createElement("form");
    form.className = "modal-form";
    form.noValidate = true;
    const icon = document.createElement("div");
    icon.className = "modal-icon";
    icon.innerHTML = MODAL_ICONS.info;
    const title = document.createElement("h2");
    const message = document.createElement("p");
    const body = document.createElement("div");
    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "button button-ghost";
    cancel.textContent = "Annuler";
    cancel.addEventListener("click", () => modal.close());
    actions.append(cancel);
    form.append(icon, title, message, body, actions);
    modal.append(form);
    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            modal.close();
        }
    });
    document.body.append(modal);
    return { modal, form, title, message, body, actions };
}

let promptParts = null;

// ask for a text value, resolves to the cleaned value or null
function promptDialog({ title, message = "", label, value = "", confirmLabel = "Valider", maxLength = 60, validate }) {
    if (!promptParts) {
        promptParts = buildFormModal("modal-prompt");
        const field = document.createElement("div");
        field.className = "field";
        const fieldLabel = document.createElement("label");
        fieldLabel.htmlFor = "prompt-input";
        const input = document.createElement("input");
        input.id = "prompt-input";
        input.type = "text";
        input.autocomplete = "off";
        const error = document.createElement("p");
        error.className = "modal-error";
        error.setAttribute("role", "alert");
        field.append(fieldLabel, input, error);
        promptParts.body.append(field);
        const confirm = document.createElement("button");
        confirm.type = "submit";
        confirm.className = "button button-primary";
        promptParts.actions.append(confirm);
        Object.assign(promptParts, { fieldLabel, input, error, confirm });
    }
    const { modal, form, input, error, confirm } = promptParts;
    promptParts.title.textContent = title;
    promptParts.message.textContent = message;
    promptParts.message.hidden = !message;
    promptParts.fieldLabel.textContent = label;
    input.value = value;
    input.maxLength = maxLength;
    error.textContent = "";
    confirm.textContent = confirmLabel;
    confirm.disabled = false;

    return new Promise((resolve) => {
        let result = null;
        const onSubmit = async (event) => {
            event.preventDefault();
            const cleaned = input.value.split(/\s+/).filter(Boolean).join(" ");
            if (!cleaned) {
                error.textContent = "Ce champ ne peut pas être vide.";
                input.focus();
                return;
            }
            confirm.disabled = true;
            const problem = validate ? await validate(cleaned) : null;  // server side check, e.g. name already taken
            confirm.disabled = false;
            if (problem) {
                error.textContent = problem;
                input.focus();
                return;
            }
            result = cleaned;
            modal.close();
        };
        form.addEventListener("submit", onSubmit);
        modal.addEventListener("close", () => {
            form.removeEventListener("submit", onSubmit);
            resolve(result);
        }, { once: true });
        modal.showModal();
        input.focus();
        input.select();
    });
}

// the picker dialog is built once and reused
let pickerParts = null;

// let the user pick an option, resolves to its value, EXTRA or null
function chooseDialog({ title, message = "", options, extraLabel }) {
    pickerParts = pickerParts || buildFormModal("modal-picker");
    const { modal, body } = pickerParts;
    pickerParts.title.textContent = title;
    pickerParts.message.textContent = message;
    pickerParts.message.hidden = !message;

    return new Promise((resolve) => {
        let result = null;
        const list = document.createElement("ul");
        list.className = "picker-list";
        const choose = (value) => {
            result = value;
            modal.close();
        };
        for (const option of options) {
            const item = document.createElement("li");
            const button = document.createElement("button");
            button.type = "button";
            button.className = "picker-option";
            if (option.image) {
                const image = document.createElement("img");
                image.src = option.image;
                image.alt = "";
                button.append(image);
            } else {
                const placeholder = document.createElement("span");
                placeholder.className = "picker-placeholder";
                placeholder.setAttribute("aria-hidden", "true");
                button.append(placeholder);
            }
            const text = document.createElement("span");
            text.className = "picker-text";
            const name = document.createElement("strong");
            name.textContent = option.label;
            const detail = document.createElement("small");
            detail.textContent = option.detail || "";
            text.append(name, detail);
            button.append(text);
            button.addEventListener("click", () => choose(option.value));
            item.append(button);
            list.append(item);
        }
        if (extraLabel) {
            const item = document.createElement("li");
            const button = document.createElement("button");
            button.type = "button";
            button.className = "picker-option picker-new";
            button.innerHTML = '<span class="picker-placeholder" aria-hidden="true">+</span>';
            const text = document.createElement("strong");
            text.textContent = extraLabel;
            button.append(text);
            button.addEventListener("click", () => choose(chooseDialog.EXTRA));
            item.append(button);
            list.append(item);
        }
        body.replaceChildren(list);
        modal.addEventListener("close", () => resolve(result), { once: true });
        modal.showModal();
        list.querySelector("button")?.focus();
    });
}

chooseDialog.EXTRA = Symbol("extra");
