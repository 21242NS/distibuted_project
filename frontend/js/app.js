
const API_URL = window.location.port === "5500"
    ? "http://localhost:8000/api/"
    : "/api/";

const messageEl = document.getElementById("message");
const refreshBtn = document.getElementById("refresh");

async function loadMessage() {
    messageEl.textContent = "Chargement...";
    messageEl.classList.remove("error");

    try {
        const response = await fetch(API_URL);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        messageEl.textContent = data.message;
    } catch (err) {
        messageEl.textContent = `Erreur : impossible de joindre l'API (${err.message})`;
        messageEl.classList.add("error");
    }
}

refreshBtn.addEventListener("click", loadMessage);
loadMessage();
