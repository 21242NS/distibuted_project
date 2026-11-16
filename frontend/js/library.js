// same limits as the backend (app/routers/photos.py)
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PARALLEL_UPLOADS = 3;
const FAILED_CARD_DELAY_MS = 450;

// upload error messages by HTTP status
const UPLOAD_ERRORS = {
    400: "fichier vide",
    401: "session expirée",
    413: "trop lourd (10 Mo maximum)",
    415: "format non accepté",
};

// DOM elements of the library page
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
    heading: document.getElementById("library-heading"),
    chipSpace: document.getElementById("chip-space"),
    albumTabs: document.getElementById("album-tabs"),
    renameAlbumButton: document.getElementById("rename-album-button"),
    deleteAlbumButton: document.getElementById("delete-album-button"),
    addToAlbumButton: document.getElementById("add-to-album-button"),
    removeFromAlbumButton: document.getElementById("remove-from-album-button"),
    emptyTitle: document.getElementById("empty-title"),
    emptyText: document.getElementById("empty-text"),
};

const EMPTY_REPORT = { groups: [], duplicate_count: 0, recoverable_bytes: 0 };

// album error messages by HTTP status
const ALBUM_ERRORS = {
    409: "Un album porte déjà ce nom.",
    422: "Le nom doit faire entre 1 et 60 caractères.",
};

// page state, the DOM is rebuilt from it by render()
const state = {
    photos: [],
    duplicateIds: new Set(),
    extraCopies: [],
    selected: new Set(),
    viewerIndex: -1,
    report: EMPTY_REPORT,
    albums: [],
    albumsAvailable: true,
    libraryCount: 0,
    albumId: new URLSearchParams(window.location.search).get("album"),
    activeUploads: 0,
    refreshSeq: 0,
    pendingSeq: 0,
};

// blob URLs of local previews, by photo id
const previews = new Map();

// pick the singular or plural form of a word
function plural(count, singular, pluralForm = `${singular}s`) {
    return `${count} ${count > 1 ? pluralForm : singular}`;
}

// format a size in o, Ko or Mo
function formatBytes(bytes) {
    if (bytes < 1024) {
        return `${bytes} o`;
    }
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 1024)} Ko`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

// format a date in French
function formatDate(value, withTime = false) {
    const options = { day: "numeric", month: "short", year: "numeric" };
    if (withTime) {
        options.hour = "2-digit";
        options.minute = "2-digit";
    }
    return new Date(value).toLocaleString("fr-BE", options);
}

// URL of a photo, local preview while it is uploading
function contentUrl(photo) {
    return previews.get(photo.id) || `${API_URL}photos/${photo.id}/content`;
}

// album currently open, or null for all photos
function currentAlbum() {
    return state.albums.find((album) => album.id === state.albumId) || null;
}

// page URL of an album
function albumUrl(albumId) {
    return albumId ? `?album=${encodeURIComponent(albumId)}` : window.location.pathname;
}

// photos already saved on the server
function confirmedPhotos() {
    return state.photos.filter((photo) => !photo.pending);
}

// release the blob URL of a preview
function forgetPreview(id) {
    const url = previews.get(id);
    if (url) {
        URL.revokeObjectURL(url);
        previews.delete(id);
    }
}

// redirect to the login page and come back afterwards
function goToLogin() {
    const params = new URLSearchParams({ next: PAGES.library });
    window.location.replace(`${PAGES.login}?${params}`);
}

// build the grid card of a photo
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

// rebuild the photo grid
function renderGrid() {
    elements.grid.replaceChildren(...state.photos.map(buildCard));
    renderSelection();
}

// update the checkboxes without rebuilding the grid
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

// switch between the normal and the selection toolbar
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

// merge the server data with the local uploads and render
function applyServerState(photos, report) {
    // keep the uploads still in progress on top
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

// build one album tab with its cover and count
function buildAlbumTab({ id, label, count, cover }) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "album-tab";
    const active = (id || null) === (state.albumId || null);
    tab.classList.toggle("is-active", active);
    if (active) {
        tab.setAttribute("aria-current", "page");
    }
    if (cover) {
        const image = document.createElement("img");
        image.src = contentUrl({ id: cover });
        image.alt = "";
        tab.append(image);
    }
    const name = document.createElement("span");
    name.textContent = label;
    const total = document.createElement("span");
    total.className = "album-tab-count";
    total.textContent = String(count);
    tab.append(name, total);
    tab.addEventListener("click", () => openAlbum(id));
    return tab;
}

// rebuild the album tabs
function renderAlbumTabs() {
    elements.albumTabs.hidden = !state.albumsAvailable;
    elements.addToAlbumButton.hidden = !state.albumsAvailable;
    const tabs = [buildAlbumTab({ id: null, label: "Toutes les photos", count: state.libraryCount })];
    for (const album of state.albums) {
        tabs.push(buildAlbumTab({ id: album.id, label: album.name, count: album.photo_count, cover: album.cover_photo_id }));
    }
    const create = document.createElement("button");
    create.type = "button";
    create.className = "album-tab album-tab-new";
    create.textContent = "+ Nouvel album";
    create.addEventListener("click", createAlbumAndOpen);
    tabs.push(create);
    elements.albumTabs.replaceChildren(...tabs);
}

// render the whole page from the state
function render() {
    const photos = state.photos;
    const album = currentAlbum();
    const report = album ? EMPTY_REPORT : state.report;
    elements.heading.textContent = album ? album.name : "Ma bibliothèque";
    document.title = album ? `${album.name} · Photo Library` : "Ma bibliothèque · Photo Library";
    elements.chipDuplicates.hidden = Boolean(album);
    elements.chipSpace.hidden = Boolean(album);
    elements.renameAlbumButton.hidden = !album;
    elements.deleteAlbumButton.hidden = !album;
    elements.removeFromAlbumButton.hidden = !album;
    elements.emptyTitle.textContent = album ? "Cet album est vide" : "Votre bibliothèque est vide";
    elements.emptyText.textContent = album
        ? "Importez des photos ici, ou sélectionnez-les dans « Toutes les photos » puis choisissez « Ajouter à un album »."
        : "Glissez vos photos ici ou choisissez-les sur votre appareil. Les doublons seront repérés automatiquement.";
    renderAlbumTabs();
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

// reload albums, photos and duplicates from the API
async function refresh() {
    const seq = ++state.refreshSeq;
    const albumId = state.albumId;
    const [albums, library, duplicates, albumPhotos] = await Promise.all([
        callApi("albums"),
        callApi("photos"),
        albumId ? Promise.resolve({ ok: true, data: EMPTY_REPORT }) : callApi("photos/duplicates"),
        albumId ? callApi(`albums/${albumId}/photos`) : Promise.resolve(null),
    ]);
    // ignore responses of an older refresh
    if (seq !== state.refreshSeq) {
        return;
    }
    // older backend without albums: the page still works
    const albumsMissing = albums.status === 404;
    const responses = [albumsMissing ? null : albums, library, duplicates, albumPhotos].filter(Boolean);
    if (responses.some((response) => response.status === 401)) {
        goToLogin();
        return;
    }
    if (albumPhotos && albumPhotos.status === 404) {
        toast("Cet album n'existe plus.", "error");
        openAlbum(null, { replace: true });
        return;
    }
    if (responses.some((response) => !response.ok)) {
        toast("Impossible de charger vos photos. Réessayez dans un instant.", "error");
        return;
    }
    state.albumsAvailable = !albumsMissing;
    state.albums = albumsMissing ? [] : albums.data.albums;
    state.libraryCount = library.data.count;
    applyServerState(albumId ? albumPhotos.data.photos : library.data.photos, duplicates.data);
}

// show an album (or all photos) and update the URL
function openAlbum(albumId, { replace = false } = {}) {
    if ((albumId || null) === (state.albumId || null) && !replace) {
        return;
    }
    state.albumId = albumId || null;
    state.selected.clear();
    state.photos = state.photos.filter((photo) => photo.pending);
    const url = albumUrl(state.albumId);
    if (replace) {
        history.replaceState(null, "", url);
    } else {
        history.pushState(null, "", url);
    }
    render();
    refresh();
}

// message for a failed album request
function albumErrorMessage(status) {
    return ALBUM_ERRORS[status] || "Impossible d'enregistrer l'album. Réessayez.";
}

// ask for a name and create an album
async function createAlbum() {
    let created = null;
    await promptDialog({
        title: "Nouvel album",
        label: "Nom de l'album",
        confirmLabel: "Créer l'album",
        validate: async (name) => {
            const { ok, status, data } = await callApi("albums", { method: "POST", body: { name } });
            if (!ok) {
                return albumErrorMessage(status);
            }
            created = data;
            return null;
        },
    });
    return created;
}

// create an album and open it
async function createAlbumAndOpen() {
    const album = await createAlbum();
    if (album) {
        state.albums.push(album);
        toast(`Album « ${album.name} » créé.`, "success");
        openAlbum(album.id);
    }
}

// rename the current album
async function renameAlbum() {
    const album = currentAlbum();
    if (!album) {
        return;
    }
    const name = await promptDialog({
        title: "Renommer l'album",
        label: "Nom de l'album",
        value: album.name,
        confirmLabel: "Renommer",
        validate: async (value) => {
            const { ok, status } = await callApi(`albums/${album.id}`, { method: "PATCH", body: { name: value } });
            return ok ? null : albumErrorMessage(status);
        },
    });
    if (name) {
        album.name = name;
        render();
        toast(`Album renommé en « ${name} ».`, "success");
    }
}

// delete the current album, its photos are kept
async function deleteAlbum() {
    const album = currentAlbum();
    if (!album) {
        return;
    }
    const confirmed = await confirmDialog({
        title: `Supprimer l'album « ${album.name} » ?`,
        message: "L'album est supprimé, mais ses photos restent dans votre bibliothèque.",
        confirmLabel: "Supprimer l'album",
        danger: true,
    });
    if (!confirmed) {
        return;
    }
    const { ok, status } = await callApi(`albums/${album.id}`, { method: "DELETE" });
    if (!ok && status !== 404) {
        toast("Impossible de supprimer l'album. Réessayez.", "error");
        return;
    }
    state.albums = state.albums.filter((item) => item.id !== album.id);
    toast(`Album « ${album.name} » supprimé.`, "success");
    openAlbum(null);
}

// add photos to an album through the API
async function addPhotosToAlbum(albumId, photoIds) {
    return callApi(`albums/${albumId}/photos`, { method: "POST", body: { photo_ids: photoIds } });
}

// add the selected photos to an album chosen in a dialog
async function addSelectionToAlbum() {
    const ids = [...state.selected];
    if (ids.length === 0) {
        return;
    }
    const choice = await chooseDialog({
        title: `Ajouter ${plural(ids.length, "photo")} à un album`,
        options: state.albums
            .filter((album) => album.id !== state.albumId)
            .map((album) => ({
                value: album.id,
                label: album.name,
                detail: plural(album.photo_count, "photo"),
                image: album.cover_photo_id ? contentUrl({ id: album.cover_photo_id }) : null,
            })),
        extraLabel: "Nouvel album…",
    });
    if (choice === null) {
        return;
    }
    const album = choice === chooseDialog.EXTRA ? await createAlbum() : state.albums.find((item) => item.id === choice);
    if (!album) {
        return;
    }
    const { ok, data } = await addPhotosToAlbum(album.id, ids);
    if (!ok) {
        toast("Impossible d'ajouter les photos à l'album. Réessayez.", "error");
        return;
    }
    const already = ids.length - data.changed;
    const suffix = already > 0 ? ` (${plural(already, "déjà présente", "déjà présentes")})` : "";
    toast(`${plural(data.changed, "photo ajoutée", "photos ajoutées")} à « ${data.album.name} »${suffix}.`, "success");
    clearSelection();
    await refresh();
}

// remove the selected photos from the album, optimistic with rollback
async function removeSelectionFromAlbum() {
    const album = currentAlbum();
    const ids = [...state.selected];
    if (!album || ids.length === 0) {
        return;
    }
    const removedIds = new Set(ids);
    const before = state.photos;
    state.photos = state.photos.filter((photo) => !removedIds.has(photo.id));
    state.selected.clear();
    render();
    const { ok } = await callApi(`albums/${album.id}/photos`, { method: "DELETE", body: { photo_ids: ids } });
    if (!ok) {
        state.photos = before;
        render();
        toast("Impossible de retirer les photos de l'album. Réessayez.", "error");
        return;
    }
    const kept = ids.length > 1 ? "Elles restent" : "Elle reste";
    toast(`${plural(ids.length, "photo retirée", "photos retirées")} de « ${album.name} ». ${kept} dans votre bibliothèque.`, "success");
    await refresh();
}

// select or unselect a photo
function toggleSelection(id) {
    if (state.selected.has(id)) {
        state.selected.delete(id);
    } else {
        state.selected.add(id);
    }
    syncCards();
}

// select every saved photo
function selectAll() {
    state.selected = new Set(confirmedPhotos().map((photo) => photo.id));
    syncCards();
}

// leave the selection mode
function clearSelection() {
    state.selected.clear();
    syncCards();
}

// delete photos one by one, return how many were deleted
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

// delete the selected photos after confirmation
async function deleteSelection() {
    const ids = [...state.selected];
    if (ids.length === 0) {
        return;
    }
    const confirmed = await confirmDialog({
        title: `Supprimer ${plural(ids.length, "photo")} ?`,
        message: state.albumId
            ? "Les photos sélectionnées seront définitivement supprimées de votre bibliothèque et de tous vos albums. Pour seulement les retirer de cet album, utilisez « Retirer de l'album »."
            : "Les photos sélectionnées seront définitivement supprimées de votre bibliothèque et de tous vos albums.",
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

// delete every extra copy, keeping the oldest one
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

// reason why a file is refused before upload, or null
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

// show a file immediately with a local preview (optimistic upload)
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

// replace the pending entry with the photo returned by the server
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

// remove a failed upload from the grid after a short animation
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

// upload one file and confirm or drop its pending entry
async function sendPhoto(entry, file) {
    const form = new FormData();
    form.append("file", file);
    const { ok, status, data } = await callApi("photos", { method: "POST", body: form });
    if (ok) {
        confirmPendingPhoto(entry, data.photo, data.duplicate);
        return { ok: true, duplicate: data.duplicate, id: data.photo.id };
    }
    dropPendingPhoto(entry);
    return { ok: false, status, reason: `${file.name} (${UPLOAD_ERRORS[status] || "erreur du serveur"})` };
}

// run async jobs with at most limit of them at the same time
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

// show one toast summarizing an upload batch
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

// validate, show and upload files, then add them to the open album
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

    const targetAlbum = currentAlbum();
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
    const importedIds = results.filter((result) => result.ok).map((result) => result.id);
    if (targetAlbum && importedIds.length > 0) {
        const { ok } = await addPhotosToAlbum(targetAlbum.id, importedIds);
        if (!ok) {
            toast(`Photos importées, mais pas ajoutées à « ${targetAlbum.name} ». Ajoutez-les depuis « Toutes les photos ».`, "error");
        }
    }
    if (state.activeUploads === 0 && results.length > 0) {
        await refresh();
    }
}

// accept files dropped on the page
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

// display a photo in the viewer
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

// open the viewer on a photo
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

// go to the previous or next photo
function stepViewer(offset) {
    const next = state.viewerIndex + offset;
    if (next >= 0 && next < state.photos.length) {
        showInViewer(next);
    }
}

// clean up when the viewer is closed
function onViewerClosed() {
    state.viewerIndex = -1;
    elements.viewerImage.removeAttribute("src");
    history.replaceState(null, "", window.location.pathname + window.location.search);
}

// photo id from #photo=<id>, or null
function photoIdFromHash() {
    const match = window.location.hash.match(/^#photo=([0-9a-f-]{36})$/i);
    return match ? match[1] : null;
}

// open the photo given in the URL hash
function openPhotoFromHash() {
    const wanted = photoIdFromHash();
    if (wanted && !openViewer(wanted)) {
        history.replaceState(null, "", window.location.pathname);
        toast("Cette photo n'existe pas ou a été supprimée.", "error");
    }
}

// viewer buttons, keyboard and swipe
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

// open the file picker
function openFilePicker() {
    elements.fileInput.click();
}

// check the session, bind the events and load the data
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
    elements.addToAlbumButton.addEventListener("click", addSelectionToAlbum);
    elements.removeFromAlbumButton.addEventListener("click", removeSelectionFromAlbum);
    elements.renameAlbumButton.addEventListener("click", renameAlbum);
    elements.deleteAlbumButton.addEventListener("click", deleteAlbum);
    window.addEventListener("popstate", () => {
        const albumId = new URLSearchParams(window.location.search).get("album");
        if ((albumId || null) !== (state.albumId || null)) {
            openAlbum(albumId, { replace: true });
        }
    });
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
