const USERNAME_RULE = /^[a-zA-Z0-9_]{3,20}$/;
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$/;
const SESSION_KEY = "photo-library-user";
const SERVER_MESSAGES = {
    "Invalid username format": "Nom d'utilisateur invalide : 3 à 20 caractères (lettres, chiffres ou _).",
    "Invalid password format": "Mot de passe trop faible : au moins 8 caractères, dont une lettre et un chiffre.",
    "Username already exists": "Ce nom d'utilisateur est déjà pris.",
    "Invalid username or password": "Nom d'utilisateur ou mot de passe incorrect.",
};

const tabs = {
    login: document.getElementById("tab-login"),
    signup: document.getElementById("tab-signup"),
};
const panels = {
    login: document.getElementById("panel-login"),
    signup: document.getElementById("panel-signup"),
};
const feedbackEl = document.getElementById("feedback");
const authSection = document.getElementById("auth");
const welcomeSection = document.getElementById("welcome");
const sessionBar = document.getElementById("session");

function showFeedback(text, kind) {
    feedbackEl.textContent = text;
    feedbackEl.className = `feedback feedback-${kind}`;
    feedbackEl.hidden = false;
}

function clearFeedback() {
    feedbackEl.hidden = true;
    feedbackEl.textContent = "";
}

function selectTab(name) {
    for (const key of Object.keys(tabs)) {
        const active = key === name;
        tabs[key].setAttribute("aria-selected", String(active));
        tabs[key].tabIndex = active ? 0 : -1;
        panels[key].hidden = !active;
    }
    clearFeedback();
}

function errorMessage(data, fallback) {
    if (typeof data.error === "string") return SERVER_MESSAGES[data.error] || data.error;
    if (typeof data.detail === "string") return SERVER_MESSAGES[data.detail] || data.detail;
    if (Array.isArray(data.detail)) return "Requête invalide : vérifiez les champs saisis.";
    return fallback;
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

function validateSignup(username, password, confirm) {
    if (!USERNAME_RULE.test(username)) {
        return "Nom d'utilisateur invalide : 3 à 20 caractères (lettres, chiffres ou _).";
    }
    if (!PASSWORD_RULE.test(password)) {
        return "Mot de passe trop faible : au moins 8 caractères, dont une lettre et un chiffre.";
    }
    if (password !== confirm) {
        return "Les deux mots de passe ne correspondent pas.";
    }
    return null;
}

function renderSession() {
    let user = null;
    try {
        user = sessionStorage.getItem(SESSION_KEY);
    } catch {
        user = null;
    }

    const loggedIn = Boolean(user);
    authSection.hidden = loggedIn;
    welcomeSection.hidden = !loggedIn;
    sessionBar.hidden = !loggedIn;
    if (loggedIn) {
        document.getElementById("session-user").textContent = user;
        document.getElementById("welcome-user").textContent = user;
    }
}

function saveSession(username) {
    try {
        sessionStorage.setItem(SESSION_KEY, username);
    } catch {
        return;
    }
}

async function handleLogin(event) {
    event.preventDefault();
    const form = panels.login;
    const username = form.username.value.trim();
    const password = form.password.value;

    if (!username || !password) {
        showFeedback("Renseignez votre nom d'utilisateur et votre mot de passe.", "error");
        return;
    }

    clearFeedback();
    setBusy(form, true, "Connexion…");
    const { ok, data } = await callApi("login", { method: "POST", body: { username, password } });
    setBusy(form, false);

    if (!ok) {
        form.password.value = "";
        showFeedback(errorMessage(data, "Nom d'utilisateur ou mot de passe incorrect."), "error");
        return;
    }

    form.reset();
    saveSession(username);
    renderSession();
}

async function handleSignup(event) {
    event.preventDefault();
    const form = panels.signup;
    const username = form.username.value.trim();
    const password = form.password.value;
    const confirm = form.confirm.value;

    const problem = validateSignup(username, password, confirm);
    if (problem) {
        showFeedback(problem, "error");
        return;
    }

    clearFeedback();
    setBusy(form, true, "Création…");
    const { ok, data } = await callApi("signup", { method: "POST", body: { username, password } });
    setBusy(form, false);

    if (!ok) {
        showFeedback(errorMessage(data, "L'inscription a échoué. Réessayez."), "error");
        return;
    }

    form.reset();
    selectTab("login");
    panels.login.username.value = username;
    panels.login.password.focus();
    showFeedback("Compte créé : vous pouvez maintenant vous connecter.", "success");
}

function clearSession() {
    try {
        sessionStorage.removeItem(SESSION_KEY);
    } catch {
        return;
    }
}

function handleLogout() {
    clearSession();
    selectTab("login");
    renderSession();
}

function handleTabKeys(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const next = event.currentTarget === tabs.login ? "signup" : "login";
    selectTab(next);
    tabs[next].focus();
}

tabs.login.addEventListener("click", () => selectTab("login"));
tabs.signup.addEventListener("click", () => selectTab("signup"));
tabs.login.addEventListener("keydown", handleTabKeys);
tabs.signup.addEventListener("keydown", handleTabKeys);
panels.login.addEventListener("submit", handleLogin);
panels.signup.addEventListener("submit", handleSignup);
document.getElementById("logout").addEventListener("click", handleLogout);

renderSession();
