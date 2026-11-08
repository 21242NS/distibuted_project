const USERNAME_RULE = /^[a-zA-Z0-9_]{3,20}$/;
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$/;

const MESSAGES = {
    usernameFormat: "Nom d'utilisateur invalide : 3 à 20 caractères (lettres, chiffres ou _).",
    passwordFormat: "Mot de passe trop faible : au moins 8 caractères, dont une lettre et un chiffre.",
};

const SERVER_MESSAGES = {
    "Invalid username format": MESSAGES.usernameFormat,
    "Invalid password format": MESSAGES.passwordFormat,
    "Username already exists": "Ce nom d'utilisateur est déjà pris.",
    "Invalid username or password": "Nom d'utilisateur ou mot de passe incorrect.",
};

function errorMessage(data, fallback) {
    if (typeof data.error === "string") return SERVER_MESSAGES[data.error] || data.error;
    if (typeof data.detail === "string") return SERVER_MESSAGES[data.detail] || data.detail;
    if (Array.isArray(data.detail)) return "Requête invalide : vérifiez les champs saisis.";
    return fallback;
}

function showFeedback(element, text, kind) {
    element.textContent = text;
    element.className = `feedback feedback-${kind}`;
    element.hidden = false;
}

function clearFeedback(element) {
    element.hidden = true;
    element.textContent = "";
}

function setBusy(form, busy, busyLabel) {
    const button = form.querySelector('button[type="submit"]');
    if (busy) {
        button.dataset.label = button.textContent;
        button.textContent = busyLabel;
    } else if (button.dataset.label) {
        button.textContent = button.dataset.label;
    }
    button.disabled = busy;
    form.setAttribute("aria-busy", String(busy));
}

function safeNextPage() {
    const next = new URLSearchParams(window.location.search).get("next");
    return Object.values(PAGES).includes(next) ? next : PAGES.library;
}

function bindPasswordToggles() {
    for (const button of document.querySelectorAll("[data-toggle-password]")) {
        const input = document.getElementById(button.dataset.togglePassword);
        button.addEventListener("click", () => {
            const reveal = input.type === "password";
            input.type = reveal ? "text" : "password";
            button.textContent = reveal ? "Masquer" : "Afficher";
            button.setAttribute("aria-pressed", String(reveal));
            input.focus();
        });
    }
}

bindPasswordToggles();
