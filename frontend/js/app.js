const API_URL = window.location.port === "5500"
    ? "http://localhost:8000/api/"
    : "/api/";

async function callApi(path, { method = "GET", body } = {}) {
    const options = { method, headers: { Accept: "application/json" } };
    if (body !== undefined) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
    }

    let response;
    try {
        response = await fetch(API_URL + path, options);
    } catch {
        return { ok: false, status: 0, data: { error: "Impossible de joindre le serveur." } };
    }

    let data = {};
    try {
        data = await response.json();
    } catch {
        data = {};
    }
    return { ok: response.ok, status: response.status, data };
}

const messageEl = document.getElementById("message");
const refreshBtn = document.getElementById("refresh");

async function loadMessage() {
    messageEl.textContent = "Chargement...";
    messageEl.classList.remove("error");

    const { ok, status, data } = await callApi("");
    if (ok) {
        messageEl.textContent = `${data.message} (pod : ${data.pod_name})`;
    } else {
        messageEl.textContent = `Erreur : impossible de joindre l'API (${status || "réseau"})`;
        messageEl.classList.add("error");
    }
}

refreshBtn.addEventListener("click", loadMessage);
loadMessage();
