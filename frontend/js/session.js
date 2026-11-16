// pages of the site, also used to validate redirects
const PAGES = {
    home: "index.html",
    login: "login.html",
    signup: "signup.html",
    library: "library.html",
};

// return the username of the session, or null
async function fetchCurrentUser() {
    const { ok, data } = await callApi("me");
    return ok ? data.username : null;
}

// show the elements marked data-when="user" or "guest"
function renderHeader(username) {
    for (const element of document.querySelectorAll("[data-when]")) {
        const wanted = element.dataset.when === "user";
        element.hidden = wanted !== Boolean(username);
    }
    for (const element of document.querySelectorAll("[data-username]")) {
        element.textContent = username || "";
    }
    for (const element of document.querySelectorAll("[data-initial]")) {
        element.textContent = username ? username.charAt(0) : "";
    }
}

// close the session and go back to the home page
async function logout() {
    await callApi("logout", { method: "POST" });
    window.location.assign(PAGES.home);
}

// attach logout to every logout button
function bindLogoutButtons() {
    for (const button of document.querySelectorAll('[data-action="logout"]')) {
        button.addEventListener("click", logout);
    }
}

// load the session and update the header, shared by every page
async function initSession() {
    bindLogoutButtons();
    const username = await fetchCurrentUser();
    renderHeader(username);
    return username;
}
