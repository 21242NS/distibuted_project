// Live Server (port 5500) talks to the local API, otherwise same origin behind the ingress
const API_URL = window.location.port === "5500"
    ? "http://localhost:8000/api/"
    : "/api/";

// call the API with the session cookie and always return { ok, status, data }
async function callApi(path, { method = "GET", body } = {}) {
    const options = { method, credentials: "include", headers: { Accept: "application/json" } };
    if (body instanceof FormData) {
        options.body = body;
    } else if (body !== undefined) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
    }

    let response;
    try {
        response = await fetch(API_URL + path, options);
    } catch {
        return { ok: false, status: 0, data: { error: "Impossible de joindre le serveur." } };  // network error: the server is unreachable
    }

    let data = {};
    try {
        data = await response.json();
    } catch {
        data = {};
    }
    return { ok: response.ok, status: response.status, data };
}
