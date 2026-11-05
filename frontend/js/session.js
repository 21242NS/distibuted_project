const PAGES = {
    home: "index.html",
    login: "login.html",
    signup: "signup.html",
    library: "library.html",
};

async function fetchCurrentUser() {
    const { ok, data } = await callApi("me");
    return ok ? data.username : null;
}

function renderHeader(username) {
    for (const element of document.querySelectorAll("[data-when]")) {
        const wanted = element.dataset.when === "user";
        element.hidden = wanted !== Boolean(username);
    }
    for (const element of document.querySelectorAll("[data-username]")) {
        element.textContent = username || "";
    }
}

async function logout() {
    await callApi("logout", { method: "POST" });
    window.location.assign(PAGES.home);
}

function bindLogoutButtons() {
    for (const button of document.querySelectorAll('[data-action="logout"]')) {
        button.addEventListener("click", logout);
    }
}

async function initSession() {
    bindLogoutButtons();
    const username = await fetchCurrentUser();
    renderHeader(username);
    return username;
}
