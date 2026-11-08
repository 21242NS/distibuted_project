const loginForm = document.getElementById("login-form");
const loginFeedback = document.getElementById("feedback");

async function handleLogin(event) {
    event.preventDefault();
    const username = loginForm.username.value.trim();
    const password = loginForm.password.value;

    if (!username || !password) {
        showFeedback(loginFeedback, "Renseignez votre nom d'utilisateur et votre mot de passe.", "error");
        return;
    }

    clearFeedback(loginFeedback);
    setBusy(loginForm, true, "Connexion…");
    const { ok, data } = await callApi("login", { method: "POST", body: { username, password } });
    setBusy(loginForm, false);

    if (!ok) {
        loginForm.password.value = "";
        showFeedback(loginFeedback, errorMessage(data, "Nom d'utilisateur ou mot de passe incorrect."), "error");
        return;
    }
    window.location.assign(safeNextPage());
}

async function initLoginPage() {
    if (await initSession()) {
        window.location.replace(safeNextPage());
        return;
    }
    loginForm.addEventListener("submit", handleLogin);
}

initLoginPage();
