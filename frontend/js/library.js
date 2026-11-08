const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const UPLOAD_ERRORS = {
    400: "fichier vide",
    401: "session expirée",
    413: "trop lourd (10 Mo maximum)",
    415: "format non accepté",
};

const elements = {
    libraryBar: document.getElementById("library-bar"),
    toolbar: document.getElementById("library-toolbar"),
    selectionToolbar: document.getElementById("selection-toolbar"),
    fileInput: document.getElementById("file-input"),
    importButton: document.getElementById("import-button"),
    importLabel: document.querySelector("#import-button span"),
    statPhotos: document.getElementById("stat-photos"),
    statDuplicates: document.getElementById("stat-duplicates"),
    chipDuplicates: document.getElementById("chip-duplicates"),
    statSpace: document.getElementById("stat-space"),
    banner: document.getElementById("duplicate-banner"),
    bannerText: document.getElementById("duplicate-text"),
    cleanButton: document.getElementById("clean-button"),
    emptyState: document.getElementById("empty-state"),
    grid: document.getElementById("photo-grid"),
    dropOverlay: document.getElementById("drop-overlay"),
    selectionCount: document.getElementById("selection-count"),
    selectAllButton: document.getElementById("select-all-button"),
    cancelSelectionButton: document.getElementById("cancel-selection-button"),
    deleteSelectionButton: document.getElementById("delete-selection-button"),
    viewer: document.getElementById("viewer"),
    viewerName: document.getElementById("viewer-name"),
    viewerMeta: document.getElementById("viewer-meta"),
    viewerImage: document.getElementById("viewer-image"),
    viewerDuplicate: document.getElementById("viewer-duplicate"),
    viewerPosition: document.getElementById("viewer-position"),
    viewerPrev: document.getElementById("viewer-prev"),
    viewerNext: document.getElementById("viewer-next"),
    viewerClose: document.getElementById("viewer-close"),
};

const state = {
    photos: [],
    duplicateIds: new Set(),
    extraCopies: [],
    selected: new Set(),
    viewerIndex: -1,
    uploading: false,
};

function plural(count, singular, pluralForm = `${singular}s`) {
    return `${count} ${count > 1 ? pluralForm : singular}`;
}

function formatBytes(bytes) {
    if (bytes < 1024) {
        return `${bytes} o`;
    }
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 1024)} Ko`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

function formatDate(value, withTime = false) {
    const options = { day: "numeric", month: "short", year: "numeric" };
    if (withTime) {
        options.hour = "2-digit";
        options.minute = "2-digit";
    }
    return new Date(value).toLocaleString("fr-BE", options);
}

function contentUrl(photo) {
    return `${API_URL}photos/${photo.id}/content`;
}

function goToLogin() {
    const params = new URLSearchParams({ next: PAGES.library });
    window.location.replace(`${PAGES.login}?${params}`);
}

function buildCard(photo) {
    const isDuplicate = state.duplicateIds.has(photo.id);
    const isSelected = state.selected.has(photo.id);

    const card = document.createElement("li");
    card.className = "photo-card";
    card.dataset.id = photo.id;
    card.classList.toggle("is-duplicate", isDuplicate);
    card.classList.toggle("is-selected", isSelected);

    const open = document.createElement("button");
    open.type = "button";
    open.className = "photo-open";
    open.setAttribute("aria-label", `Voir ${photo.filename}`);
    open.title = `${photo.filename} · ${formatBytes(photo.size)} · ${formatDate(photo.created_at)}`;
    open.addEventListener("click", () => {
        if (state.selected.size > 0) {
            toggleSelection(photo.id);
        } else {
            openViewer(photo.id);
        }
    });

    const frame = document.createElement("div");
    frame.className = "photo-frame";
    const image = document.createElement("img");
    image.src = contentUrl(photo);
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    frame.append(image);
    if (isDuplicate) {
        const badge = document.createElement("span");
        badge.className = "photo-badge";
        badge.textContent = "Doublon";
        frame.append(badge);
    }
    open.append(frame);

    const check = document.createElement("label");
    check.className = "photo-check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = isSelected;
    box.setAttribute("aria-label", `Sélectionner ${photo.filename}`);
    box.addEventListener("change", () => toggleSelection(photo.id));
    check.append(box);

    card.append(open, check);
    return card;
}

function renderGrid() {
    elements.grid.replaceChildren(...state.photos.map(buildCard));
    renderSelection();
}

function syncCards() {
    for (const card of elements.grid.children) {
        const selected = state.selected.has(card.dataset.id);
        card.classList.toggle("is-selected", selected);
        card.querySelector(".photo-check input").checked = selected;
    }
    renderSelection();
}

function renderSelection() {
    const count = state.selected.size;
    const selecting = count > 0;
    elements.toolbar.hidden = selecting;
    elements.selectionToolbar.hidden = !selecting;
    elements.libraryBar.classList.toggle("is-selecting", selecting);
    elements.grid.classList.toggle("selecting", selecting);
    elements.selectionCount.textContent = plural(count, "photo sélectionnée", "photos sélectionnées");
    elements.selectAllButton.hidden = count === state.photos.length;
}

function render(photos, report) {
    state.photos = photos;
    state.extraCopies = report.groups.flatMap((group) => group.photos.slice(1).map((photo) => photo.id));
    state.duplicateIds = new Set(state.extraCopies);
    const existing = new Set(photos.map((photo) => photo.id));
    state.selected = new Set([...state.selected].filter((id) => existing.has(id)));

    elements.statPhotos.textContent = String(photos.length);
    elements.statDuplicates.textContent = String(report.duplicate_count);
    document.getElementById("label-photos").textContent = photos.length > 1 ? "photos" : "photo";
    document.getElementById("label-duplicates").textContent = report.duplicate_count > 1 ? "doublons" : "doublon";
    elements.statSpace.textContent = formatBytes(report.recoverable_bytes);
    elements.chipDuplicates.classList.toggle("chip-alert", report.duplicate_count > 0);

    elements.banner.hidden = report.duplicate_count === 0;
    elements.bannerText.textContent =
        `${plural(report.duplicate_count, "doublon trouvé", "doublons trouvés")} : ` +
        `${formatBytes(report.recoverable_bytes)} à récupérer. L'original de chaque photo est conservé.`;

    elements.emptyState.hidden = photos.length > 0;
    elements.grid.hidden = photos.length === 0;
    renderGrid();
}

async function refresh() {
    const [list, duplicates] = await Promise.all([callApi("photos"), callApi("photos/duplicates")]);
    if (list.status === 401 || duplicates.status === 401) {
        goToLogin();
        return;
    }
    if (!list.ok || !duplicates.ok) {
        toast("Impossible de charger vos photos. Réessayez dans un instant.", "error");
        return;
    }
    render(list.data.photos, duplicates.data);
}

function toggleSelection(id) {
    if (state.selected.has(id)) {
        state.selected.delete(id);
    } else {
        state.selected.add(id);
    }
    syncCards();
}

function selectAll() {
    state.selected = new Set(state.photos.map((photo) => photo.id));
    syncCards();
}

function clearSelection() {
    state.selected.clear();
    syncCards();
}

async function deletePhotos(ids) {
    let removed = 0;
    for (const id of ids) {
        const { ok, status } = await callApi(`photos/${id}`, { method: "DELETE" });
        removed += ok || status === 404 ? 1 : 0;
    }
    return removed;
}

async function deleteSelection() {
    const ids = [...state.selected];
    if (ids.length === 0) {
        return;
    }
    const confirmed = await confirmDialog({
        title: `Supprimer ${plural(ids.length, "photo")} ?`,
        message: "Les photos sélectionnées seront définitivement supprimées de votre bibliothèque.",
        confirmLabel: "Supprimer",
        danger: true,
    });
    if (!confirmed) {
        return;
    }
    elements.deleteSelectionButton.disabled = true;
    const removed = await deletePhotos(ids);
    elements.deleteSelectionButton.disabled = false;
    state.selected.clear();
    if (removed === ids.length) {
        toast(`${plural(removed, "photo supprimée", "photos supprimées")}.`, "success");
    } else {
        toast(`${removed} sur ${ids.length} supprimées : réessayez pour les autres.`, "error");
    }
    await refresh();
}

async function removeDuplicates() {
    const ids = [...state.extraCopies];
    if (ids.length === 0) {
        return;
    }
    const confirmed = await confirmDialog({
        title: `Supprimer ${plural(ids.length, "doublon")} ?`,
        message: "Seules les copies sont supprimées : la photo la plus ancienne de chaque groupe est conservée.",
        confirmLabel: "Supprimer les doublons",
        danger: true,
    });
    if (!confirmed) {
        return;
    }
    elements.cleanButton.disabled = true;
    const removed = await deletePhotos(ids);
    elements.cleanButton.disabled = false;
    toast(`${plural(removed, "doublon supprimé", "doublons supprimés")}.`, "success");
    await refresh();
}

function setUploading(uploading, label = "Importer des photos") {
    state.uploading = uploading;
    elements.importButton.disabled = uploading;
    elements.importLabel.textContent = label;
}

async function uploadFiles(files) {
    if (files.length === 0 || state.uploading) {
        return;
    }
    const images = files.filter((file) => ACCEPTED_TYPES.includes(file.type));
    const failures = files
        .filter((file) => !ACCEPTED_TYPES.includes(file.type))
        .map((file) => `${file.name} (${UPLOAD_ERRORS[415]})`);

    let imported = 0;
    let duplicates = 0;
    for (const [index, file] of images.entries()) {
        setUploading(true, `Import ${index + 1}/${images.length}…`);
        const form = new FormData();
        form.append("file", file);
        const { ok, status, data } = await callApi("photos", { method: "POST", body: form });
        if (ok) {
            imported += 1;
            duplicates += data.duplicate ? 1 : 0;
        } else {
            failures.push(`${file.name} (${UPLOAD_ERRORS[status] || "erreur du serveur"})`);
        }
    }
    setUploading(false);
    elements.fileInput.value = "";

    if (imported > 0) {
        const suffix = duplicates > 0 ? `, dont ${plural(duplicates, "doublon")}` : "";
        toast(`${plural(imported, "photo importée", "photos importées")}${suffix}.`, "success");
    }
    if (failures.length > 0) {
        toast(`Refusé : ${failures.join(", ")}.`, "error");
    }
    await refresh();
}

function bindDragAndDrop() {
    let depth = 0;
    const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes("Files");

    window.addEventListener("dragenter", (event) => {
        if (!hasFiles(event)) {
            return;
        }
        event.preventDefault();
        depth += 1;
        elements.dropOverlay.hidden = false;
    });
    window.addEventListener("dragover", (event) => {
        if (hasFiles(event)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
        }
    });
    window.addEventListener("dragleave", (event) => {
        if (!hasFiles(event)) {
            return;
        }
        depth = Math.max(0, depth - 1);
        if (depth === 0) {
            elements.dropOverlay.hidden = true;
        }
    });
    window.addEventListener("drop", (event) => {
        if (!hasFiles(event)) {
            return;
        }
        event.preventDefault();
        depth = 0;
        elements.dropOverlay.hidden = true;
        uploadFiles([...event.dataTransfer.files]);
    });
}

function showInViewer(index) {
    const photo = state.photos[index];
    state.viewerIndex = index;
    elements.viewerImage.src = contentUrl(photo);
    elements.viewerImage.alt = photo.filename;
    elements.viewerName.textContent = photo.filename;
    elements.viewerMeta.textContent =
        `${formatBytes(photo.size)} · ${photo.content_type} · importée le ${formatDate(photo.created_at, true)}`;
    elements.viewerDuplicate.hidden = !state.duplicateIds.has(photo.id);
    elements.viewerPosition.textContent = `${index + 1} / ${state.photos.length}`;
    elements.viewerPrev.disabled = index === 0;
    elements.viewerNext.disabled = index === state.photos.length - 1;
    history.replaceState(null, "", `#photo=${photo.id}`);
}

function openViewer(id) {
    const index = state.photos.findIndex((photo) => photo.id === id);
    if (index === -1) {
        return false;
    }
    showInViewer(index);
    if (!elements.viewer.open) {
        elements.viewer.showModal();
    }
    return true;
}

function stepViewer(offset) {
    const next = state.viewerIndex + offset;
    if (next >= 0 && next < state.photos.length) {
        showInViewer(next);
    }
}

function onViewerClosed() {
    state.viewerIndex = -1;
    elements.viewerImage.removeAttribute("src");
    history.replaceState(null, "", window.location.pathname + window.location.search);
}

function photoIdFromHash() {
    const match = window.location.hash.match(/^#photo=([0-9a-f-]{36})$/i);
    return match ? match[1] : null;
}

function openPhotoFromHash() {
    const wanted = photoIdFromHash();
    if (wanted && !openViewer(wanted)) {
        history.replaceState(null, "", window.location.pathname);
        toast("Cette photo n'existe pas ou a été supprimée.", "error");
    }
}

function bindViewer() {
    elements.viewerClose.addEventListener("click", () => elements.viewer.close());
    elements.viewerPrev.addEventListener("click", () => stepViewer(-1));
    elements.viewerNext.addEventListener("click", () => stepViewer(1));
    elements.viewer.addEventListener("close", onViewerClosed);
    elements.viewer.addEventListener("click", (event) => {
        if (event.target === elements.viewer) {
            elements.viewer.close();
        }
    });
    elements.viewer.addEventListener("keydown", (event) => {
        if (event.key === "ArrowLeft") {
            stepViewer(-1);
        } else if (event.key === "ArrowRight") {
            stepViewer(1);
        }
    });

    let touchStartX = null;
    elements.viewerImage.addEventListener("touchstart", (event) => {
        touchStartX = event.touches[0].clientX;
    }, { passive: true });
    elements.viewerImage.addEventListener("touchend", (event) => {
        if (touchStartX === null) {
            return;
        }
        const distance = event.changedTouches[0].clientX - touchStartX;
        touchStartX = null;
        if (Math.abs(distance) > 50) {
            stepViewer(distance < 0 ? 1 : -1);
        }
    });
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
    elements.selectAllButton.addEventListener("click", selectAll);
    elements.cancelSelectionButton.addEventListener("click", clearSelection);
    elements.deleteSelectionButton.addEventListener("click", deleteSelection);
    document.addEventListener("keydown", (event) => {
        const modalOpen = document.querySelector("dialog[open]");
        if (event.key === "Escape" && state.selected.size > 0 && !modalOpen) {
            clearSelection();
        }
    });
    bindViewer();
    bindDragAndDrop();

    await refresh();
    document.getElementById("contenu").hidden = false;

    openPhotoFromHash();
    window.addEventListener("hashchange", openPhotoFromHash);
}

initLibraryPage();
