const TOAST_DURATION_MS = 4500;

const MODAL_ICONS = {
    danger: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/><path d="M10 11v5M14 11v5"/></svg>',
    info: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>',
};

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
