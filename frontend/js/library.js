const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PARALLEL_UPLOADS = 3;
const FAILED_CARD_DELAY_MS = 450;

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
    report: { groups: [], duplicate_count: 0, recoverable_bytes: 0 },
    activeUploads: 0,
    refreshSeq: 0,
    pendingSeq: 0,
};

const previews = new Map();

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
    return previews.get(photo.id) || `${API_URL}photos/${photo.id}/content`;
}

function confirmedPhotos() {
    return state.photos.filter((photo) => !photo.pending);
}

function forgetPreview(id) {
    const url = previews.get(id);
    if (url) {
        URL.revokeObjectURL(url);
        previews.delete(id);
    }
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
    card.classList.toggle("is-pending", Boolean(photo.pending));
    card.setAttribute("aria-busy", photo.pending ? "true" : "false");

    const open = document.createElement("button");
    open.type = "button";
    open.className = "photo-open";
    open.setAttribute("aria-label", `Voir ${photo.filename}`);
    open.title = photo.pending
        ? `${photo.filename} · import en cours…`
        : `${photo.filename} · ${formatBytes(photo.size)} · ${formatDate(photo.created_at)}`;
    open.addEventListener("click", () => {
        if (state.selected.size === 0) {
            openViewer(photo.id);
        } else if (!photo.pending) {
            toggleSelection(photo.id);
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
    if (photo.pending) {
        const progress = document.createElement("span");
        progress.className = "photo-progress";
        progress.setAttribute("aria-hidden", "true");
        frame.append(progress);
    }
    open.append(frame);

    if (photo.pending) {
        card.append(open);
        return card;
    }

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
        const box = card.querySelector(".photo-check input");
        if (!box) {
            continue;
        }
        const selected = state.selected.has(card.dataset.id);
        card.classList.toggle("is-selected", selected);
        box.checked = selected;
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
    elements.selectAllButton.hidden = count === confirmedPhotos().length;
}

function applyServerState(photos, report) {
    const pending = state.photos.filter((photo) => photo.pending);
    state.photos = [...pending, ...photos];
    state.report = report;
    state.extraCopies = report.groups.flatMap((group) => group.photos.slice(1).map((photo) => photo.id));
    state.duplicateIds = new Set(state.extraCopies);
    const existing = new Set(photos.map((photo) => photo.id));
    state.selected = new Set([...state.selected].filter((id) => existing.has(id)));
    for (const id of [...previews.keys()]) {
        if (!existing.has(id) && !id.startsWith("pending-")) {
            forgetPreview(id);
        }
    }
    render();
}

function render() {
    const photos = state.photos;
    const report = state.report;
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
    const seq = ++state.refreshSeq;
    const [list, duplicates] = await Promise.all([callApi("photos"), callApi("photos/duplicates")]);
    if (seq !== state.refreshSeq) {
        return;
    }
    if (list.status === 401 || duplicates.status === 401) {
        goToLogin();
        return;
    }
    if (!list.ok || !duplicates.ok) {
        toast("Impossible de charger vos photos. Réessayez dans un instant.", "error");
        return;
    }
    applyServerState(list.data.photos, duplicates.data);
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
    state.selected = new Set(confirmedPhotos().map((photo) => photo.id));
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
        if (ok || status === 404) {
            removed += 1;
            forgetPreview(id);
        }
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

function rejectionReason(file) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
        return UPLOAD_ERRORS[415];
    }
    if (file.size > MAX_PHOTO_BYTES) {
        return UPLOAD_ERRORS[413];
    }
    if (file.size === 0) {
        return UPLOAD_ERRORS[400];
    }
    return null;
}

function addPendingPhoto(file) {
    state.pendingSeq += 1;
    const entry = {
        id: `pending-${state.pendingSeq}`,
        pending: true,
        filename: file.name,
        content_type: file.type,
        size: file.size,
        created_at: new Date().toISOString(),
    };
    previews.set(entry.id, URL.createObjectURL(file));
    state.photos.unshift(entry);
    return entry;
}

function confirmPendingPhoto(entry, photo, duplicate) {
    const index = state.photos.indexOf(entry);
    previews.set(photo.id, previews.get(entry.id));
    previews.delete(entry.id);
    if (index !== -1) {
        state.photos[index] = photo;
    }
    if (duplicate && !state.duplicateIds.has(photo.id)) {
        state.duplicateIds.add(photo.id);
        state.extraCopies.push(photo.id);
        state.report = {
            ...state.report,
            duplicate_count: state.report.duplicate_count + 1,
            recoverable_bytes: state.report.recoverable_bytes + photo.size,
        };
    }
    if (state.viewerIndex === index) {
        showInViewer(index);
    }
    render();
}

function dropPendingPhoto(entry) {
    const index = state.photos.indexOf(entry);
    if (index !== -1) {
        state.photos.splice(index, 1);
    }
    if (elements.viewer.open && state.viewerIndex === index) {
        elements.viewer.close();
    } else if (state.viewerIndex > index) {
        state.viewerIndex -= 1;
    }
    const card = elements.grid.querySelector(`[data-id="${entry.id}"]`);
    const finish = () => {
        forgetPreview(entry.id);
        render();
    };
    if (!card || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        finish();
        return;
    }
    card.classList.add("is-failed");
    setTimeout(finish, FAILED_CARD_DELAY_MS);
}

async function sendPhoto(entry, file) {
    const form = new FormData();
    form.append("file", file);
    const { ok, status, data } = await callApi("photos", { method: "POST", body: form });
    if (ok) {
        confirmPendingPhoto(entry, data.photo, data.duplicate);
        return { ok: true, duplicate: data.duplicate };
    }
    dropPendingPhoto(entry);
    return { ok: false, status, reason: `${file.name} (${UPLOAD_ERRORS[status] || "erreur du serveur"})` };
}

async function runWithLimit(jobs, limit) {
    const results = [];
    let next = 0;
    const worker = async () => {
        while (next < jobs.length) {
            const index = next++;
            results[index] = await jobs[index]();
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
    return results;
}

function reportBatch(results, rejected) {
    const imported = results.filter((result) => result.ok);
    const duplicates = imported.filter((result) => result.duplicate).length;
    const failures = [...rejected, ...results.filter((result) => !result.ok).map((result) => result.reason)];

    if (imported.length > 0) {
        const suffix = duplicates > 0 ? `, dont ${plural(duplicates, "doublon")}` : "";
        toast(`${plural(imported.length, "photo importée", "photos importées")}${suffix}.`, "success");
    }
    if (failures.length > 0) {
        toast(`Non importé : ${failures.join(", ")}.`, "error");
    }
}

async function uploadFiles(files) {
    elements.fileInput.value = "";
    if (files.length === 0) {
        return;
    }
    const rejected = [];
    const accepted = [];
    for (const file of files) {
        const reason = rejectionReason(file);
        if (reason) {
            rejected.push(`${file.name} (${reason})`);
        } else {
            accepted.push(file);
        }
    }

    const entries = accepted.map((file) => ({ file, entry: addPendingPhoto(file) }));
    if (entries.length > 0) {
        render();
    }

    state.activeUploads += entries.length;
    const results = await runWithLimit(
        entries.map(({ file, entry }) => async () => {
            const result = await sendPhoto(entry, file);
            state.activeUploads -= 1;
            return result;
        }),
        PARALLEL_UPLOADS,
    );

    if (results.some((result) => result.status === 401)) {
        goToLogin();
        return;
    }
    reportBatch(results, rejected);
    if (state.activeUploads === 0 && results.length > 0) {
        await refresh();
    }
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
    elements.viewerMeta.textContent = photo.pending
        ? `${formatBytes(photo.size)} · ${photo.content_type} · import en cours…`
        : `${formatBytes(photo.size)} · ${photo.content_type} · importée le ${formatDate(photo.created_at, true)}`;
    elements.viewerDuplicate.hidden = !state.duplicateIds.has(photo.id);
    elements.viewerPosition.textContent = `${index + 1} / ${state.photos.length}`;
    elements.viewerPrev.disabled = index === 0;
    elements.viewerNext.disabled = index === state.photos.length - 1;
    if (!photo.pending) {
        history.replaceState(null, "", `#photo=${photo.id}`);
    }
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
