document.addEventListener("DOMContentLoaded", async function () {
    setupMenu();
    await loadElectionInfo();
    await loadCandidates();
});

function setupMenu() {
    /* Menu sudah hardcode di HTML, tidak perlu setup */
}

function goToResults() {
    window.location.href = "/results.html";
}

function goToMonitor() {
    window.location.href = "/monitor-mpk.html";
}

function toggleMenu() {
    const menu = document.getElementById("menu");
    if (!menu) return;
    menu.classList.toggle("active");

    /* Tutup menu jika klik di luar */
    if (menu.classList.contains("active")) {
        const outside = function (e) {
            if (!menu.contains(e.target) && !document.querySelector(".menu-button")?.contains(e.target)) {
                menu.classList.remove("active");
                document.removeEventListener("click", outside);
            }
        };
        setTimeout(function () { document.addEventListener("click", outside); }, 10);
    }
}

function showMessage(message) {
    const box  = document.getElementById("messageBox");
    const text = document.getElementById("messageText");
    if (!box || !text) return;
    text.textContent = message;
    box.classList.add("active");
}

function closeMessage() {
    const box = document.getElementById("messageBox");
    if (!box) return;
    box.classList.remove("active");
}

async function loadElectionInfo() {
    try {
        const response = await fetch("/api/election", { cache: "no-store" });
        const data = await response.json();
        if (!data.success) throw new Error(data.message || "Gagal mengambil status.");

        updatePublicStatus(data.status);
        applyHeroImage(data.heroImage);
        updateHeroStatusPill(data.status);

        /* Tampilkan tombol Hasil Suara hanya jika published */
        const menuResultsBtn    = document.getElementById("menuResultsBtn");
        const quickResultsCard  = document.getElementById("quickResultsCard");
        const quickResultsDesc  = document.getElementById("quickResultsDesc");

        if (!data.published) {
            if (menuResultsBtn) {
                menuResultsBtn.style.opacity = "0.5";
                menuResultsBtn.onclick = function () {
                    toggleMenu();
                    showMessage("Hasil suara belum dipublikasikan oleh administrator.");
                };
            }
            if (quickResultsCard) {
                quickResultsCard.style.opacity = "0.55";
                quickResultsCard.style.cursor   = "default";
                quickResultsCard.onclick = function () {
                    showMessage("Hasil suara belum dipublikasikan oleh administrator.");
                };
            }
            if (quickResultsDesc) {
                quickResultsDesc.textContent = "Belum dipublikasikan";
            }
        } else {
            if (menuResultsBtn)   { menuResultsBtn.style.opacity   = ""; menuResultsBtn.onclick = goToResults; }
            if (quickResultsCard) { quickResultsCard.style.opacity  = ""; quickResultsCard.style.cursor = ""; quickResultsCard.onclick = goToResults; }
            if (quickResultsDesc) quickResultsDesc.textContent = "Lihat perolehan suara";
        }
    } catch (error) {
        console.error(error);
        updatePublicStatus("DRAFT");
    }
}

function updateHeroStatusPill(status) {
    const pill  = document.getElementById("heroStatusPill");
    const dot   = document.getElementById("heroStatusDot");
    const label = document.getElementById("heroStatusLabel");
    if (!pill || !dot || !label) return;

    const map = {
        DRAFT:  { text: "Belum Dimulai",       cls: "" },
        READY:  { text: "Siap Dimulai",         cls: "ready" },
        OPEN:   { text: "Sedang Berlangsung",   cls: "open" },
        CLOSED: { text: "Pemilihan Selesai",    cls: "closed" }
    };
    const info = map[status] || map.DRAFT;
    label.textContent = info.text;
    dot.className = "hero-status-dot" + (info.cls ? " " + info.cls : "");
}

function applyHeroImage(heroImage) {
    const heroSection = document.getElementById("heroSection");
    const overlay     = document.getElementById("heroImageOverlay");

    if (!heroSection || !overlay) return;

    if (heroImage) {
        overlay.style.display      = "block";
        overlay.style.backgroundImage = `url(${heroImage})`;
        heroSection.classList.add("has-wallpaper");
    } else {
        overlay.style.display = "none";
        heroSection.classList.remove("has-wallpaper");
    }
}

function updatePublicStatus(status) {
    const statusText = document.getElementById("statusText");
    const statusDot  = document.querySelector(".status-card .status-dot");
    if (!statusText || !statusDot) return;

    statusText.className = "";
    statusDot.className  = "status-dot";

    const map = {
        DRAFT:  ["Belum Dimulai",       ""],
        READY:  ["Siap Dimulai",        "ready"],
        OPEN:   ["Sedang Berlangsung",  "open"],
        CLOSED: ["Pemilihan Selesai",   "closed"]
    };

    const [label, dotClass] = map[status] || ["Belum Dimulai", ""];
    statusText.textContent = label;
    if (dotClass) statusDot.classList.add(dotClass);
}

async function loadCandidates() {
    const container = document.getElementById("candidateList");
    if (!container) return;
    try {
        const response = await fetch("/api/candidates");
        const data     = await response.json();
        if (!data.success) throw new Error(data.message || "Gagal mengambil Paslon.");
        renderCandidates(data.candidates || []);
    } catch (error) {
        console.error(error);
        container.innerHTML = `<div class="candidate-loading">Gagal memuat data Paslon.</div>`;
    }
}

function renderCandidates(candidates) {
    const container = document.getElementById("candidateList");
    if (!container) return;
    container.innerHTML = "";

    if (!candidates.length) {
        container.innerHTML = `<div class="candidate-loading">Belum ada Paslon yang ditetapkan.</div>`;
        return;
    }

    candidates.forEach(function (candidate) {
        const card = document.createElement("article");
        card.className = "candidate-card";

        const photoHTML = candidate.photo
            ? `<div class="candidate-photo"><img src="${escapeHTML(candidate.photo)}" alt="${escapeHTML(candidate.name)}"></div>`
            : `<div class="candidate-photo"><span class="photo-placeholder">FOTO PASLON</span></div>`;

        card.innerHTML = `
            ${photoHTML}
            <div class="candidate-info">
                <p class="candidate-number">PASLON ${String(candidate.number).padStart(2, "0")}</p>
                <h3>${escapeHTML(candidate.name)}</h3>
                <p>Ketua: <strong>${escapeHTML(candidate.chairman || "-")}</strong></p>
                <p>Wakil: <strong>${escapeHTML(candidate.vice || "-")}</strong></p>
            </div>`;

        container.appendChild(card);
    });
}

async function startVoting() {
    toggleMenu();
    try {
        const response = await fetch("/api/election");
        const data     = await response.json();
        if (!data.success || data.status !== "OPEN") {
            showMessage("Pemilihan belum dibuka oleh administrator.");
            return;
        }
        window.location.href = "/vote.html";
    } catch (error) {
        console.error(error);
        showMessage("Gagal memeriksa status pemilihan.");
    }
}

function escapeHTML(value) {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
}



