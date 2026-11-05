async function initLibraryPage() {
    const username = await initSession();
    if (!username) {
        const params = new URLSearchParams({ next: PAGES.library });
        window.location.replace(`${PAGES.login}?${params}`);
        return;
    }
    document.getElementById("contenu").hidden = false;
}

initLibraryPage();
