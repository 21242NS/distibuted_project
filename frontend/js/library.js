const UPLOAD_ERRORS = {
    400: "fichier vide",
    401: "session expirée",
    413: "fichier trop lourd (10 Mo maximum)",
    415: "format non accepté (JPEG, PNG, GIF ou WebP)",
};

const elements = {
    feedback: document.getElementById("feedback"),
    fileInput: document.getElementById("file-input"),
    importButton: document.getElementById("import-button"),
    statPhotos: document.getElementById("stat-photos"),
    statDuplicates: document.getElementById("stat-duplicates"),
    statSpace: document.getElementById("stat-space"),
    banner: document.getElementById("duplicate-banner"),
    bannerText: document.getElementById("duplicate-text"),
    cleanButton: document.getElementById("clean-button"),
    emptyState: document.getElementById("empty-state"),
    grid: document.getElementById("photo-grid"),
};

let extraCopies = [];

function formatBytes(bytes) {
    if (bytes < 1024) {
        return `${bytes} o`;
    }
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 1024)} Ko`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

function formatDate(value) {
    return new Date(value).toLocaleDateString("fr-BE", { day: "numeric", month: "short", year: "numeric" });
}

function goToLogin() {
    const params = new URLSearchParams({ next: PAGES.library });
    window.location.replace(`${PAGES.login}?${params}`);
}

function buildCard(photo, isDuplicate) {
    const card = document.createElement("li");
    card.className = isDuplicate ? "photo-card is-duplicate" : "photo-card";

    const frame = document.createElement("div");
    frame.className = "photo-frame";
    const image = document.createElement("img");
    image.src = `${API_URL}photos/${photo.id}/content`;
    image.alt = photo.filename;
    image.loading = "lazy";
    frame.append(image);
    if (isDuplicate) {
        const badge = document.createElement("span");
        badge.className = "photo-badge";
        badge.textContent = "Doublon";
        frame.append(badge);
    }

    const info = document.createElement("div");
    info.className = "photo-info";
    const name = document.createElement("p");
    name.className = "photo-name";
    name.textContent = photo.filename;
    name.title = photo.filename;
    const meta = document.createElement("p");
    meta.className = "photo-meta";
    meta.textContent = `${formatBytes(photo.size)} · ${formatDate(photo.created_at)}`;
    info.append(name, meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "photo-delete";
    remove.textContent = "Supprimer";
    remove.setAttribute("aria-label", `Supprimer ${photo.filename}`);
    remove.addEventListener("click", () => deletePhoto(photo));

    card.append(frame, info, remove);
    return card;
}

function render(photos, report) {
    extraCopies = report.groups.flatMap((group) => group.photos.slice(1).map((photo) => photo.id));
    const duplicateIds = new Set(extraCopies);

    elements.statPhotos.textContent = String(photos.length);
    elements.statDuplicates.textContent = String(report.duplicate_count);
    elements.statSpace.textContent = formatBytes(report.recoverable_bytes);

    elements.banner.hidden = report.duplicate_count === 0;
    elements.bannerText.textContent =
        `${report.duplicate_count} doublon(s) trouvé(s) : ${formatBytes(report.recoverable_bytes)} à récupérer. ` +
        "La copie la plus ancienne de chaque photo est conservée.";

    elements.emptyState.hidden = photos.length > 0;
    elements.grid.replaceChildren(...photos.map((photo) => buildCard(photo, duplicateIds.has(photo.id))));
}

async function refresh() {
    const [list, duplicates] = await Promise.all([callApi("photos"), callApi("photos/duplicates")]);
    if (list.status === 401 || duplicates.status === 401) {
        goToLogin();
        return;
    }
    if (!list.ok || !duplicates.ok) {
        showFeedback(elements.feedback, "Impossible de charger vos photos. Réessayez dans un instant.", "error");
        return;
    }
    render(list.data.photos, duplicates.data);
}

async function uploadFiles(files) {
    if (files.length === 0) {
        return;
    }
    clearFeedback(elements.feedback);
    elements.importButton.disabled = true;

    let imported = 0;
    let duplicates = 0;
    const failures = [];
    for (const [index, file] of files.entries()) {
        elements.importButton.textContent = `Import ${index + 1}/${files.length}…`;
        const form = new FormData();
        form.append("file", file);
        const { ok, status, data } = await callApi("photos", { method: "POST", body: form });
        if (ok) {
            imported += 1;
            duplicates += data.duplicate ? 1 : 0;
        } else {
            failures.push(`${file.name} : ${UPLOAD_ERRORS[status] || "erreur du serveur"}`);
        }
    }

    elements.importButton.textContent = "Importer des photos";
    elements.importButton.disabled = false;
    elements.fileInput.value = "";

    const parts = [`${imported} photo(s) importée(s)`];
    if (duplicates > 0) {
        parts.push(`dont ${duplicates} doublon(s)`);
    }
    let message = parts.join(", ") + ".";
    if (failures.length > 0) {
        message += ` Refusé : ${failures.join(" ; ")}.`;
    }
    showFeedback(elements.feedback, message, failures.length > 0 ? "error" : "success");
    await refresh();
}

async function deletePhoto(photo) {
    if (!window.confirm(`Supprimer « ${photo.filename} » ?`)) {
        return;
    }
    const { ok, status } = await callApi(`photos/${photo.id}`, { method: "DELETE" });
    if (ok || status === 404) {
        showFeedback(elements.feedback, `« ${photo.filename} » a été supprimée.`, "success");
    } else {
        showFeedback(elements.feedback, "La suppression a échoué.", "error");
    }
    await refresh();
}

async function removeDuplicates() {
    const ids = [...extraCopies];
    if (ids.length === 0 || !window.confirm(`Supprimer ${ids.length} doublon(s) ? Les originaux sont conservés.`)) {
        return;
    }
    elements.cleanButton.disabled = true;
    let removed = 0;
    for (const id of ids) {
        const { ok } = await callApi(`photos/${id}`, { method: "DELETE" });
        removed += ok ? 1 : 0;
    }
    elements.cleanButton.disabled = false;
    showFeedback(elements.feedback, `${removed} doublon(s) supprimé(s).`, "success");
    await refresh();
}

function openFilePicker() {
    elements.fileInput.click();
}

async function initLibraryPage() {
    const username = await initSession();
    if (!username) {
        goToLogin();
        return;
    }
    elements.importButton.addEventListener("click", openFilePicker);
    for (const button of document.querySelectorAll('[data-action="import"]')) {
        button.addEventListener("click", openFilePicker);
    }
    elements.fileInput.addEventListener("change", () => uploadFiles([...elements.fileInput.files]));
    elements.cleanButton.addEventListener("click", removeDuplicates);
    await refresh();
    document.getElementById("contenu").hidden = false;
}

initLibraryPage();
