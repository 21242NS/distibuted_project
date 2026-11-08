const API_URL = window.location.port === "5500"
    ? "http://localhost:8000/api/"
    : "/api/";

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
