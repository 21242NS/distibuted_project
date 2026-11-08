const signupForm = document.getElementById("signup-form");
const signupFeedback = document.getElementById("feedback");

function validateSignup(username, password, confirm) {
    if (!USERNAME_RULE.test(username)) return MESSAGES.usernameFormat;
    if (!PASSWORD_RULE.test(password)) return MESSAGES.passwordFormat;
    if (password !== confirm) return "Les deux mots de passe ne correspondent pas.";
    return null;
}

async function handleSignup(event) {
    event.preventDefault();
    const username = signupForm.username.value.trim();
    const password = signupForm.password.value;
    const confirm = signupForm.confirm.value;

    const problem = validateSignup(username, password, confirm);
    if (problem) {
        showFeedback(signupFeedback, problem, "error");
        return;
    }

    clearFeedback(signupFeedback);
    setBusy(signupForm, true, "Création…");
    const { ok, data } = await callApi("signup", { method: "POST", body: { username, password } });
    setBusy(signupForm, false);

    if (!ok) {
        showFeedback(signupFeedback, errorMessage(data, "L'inscription a échoué. Réessayez."), "error");
        return;
    }
    window.location.assign(safeNextPage());
}

async function initSignupPage() {
    if (await initSession()) {
        window.location.replace(safeNextPage());
        return;
    }
    signupForm.addEventListener("submit", handleSignup);
}

initSignupPage();
