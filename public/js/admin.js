let electionStatus = "DRAFT";
let publishedState = false;
let candidates = [];
let voterConfig = { roles: [], classes: [], departments: [], codes: [] };
let editingCandidateId = null;

/* Password disimpan di sessionStorage agar tetap ada selama tab terbuka */
const SESSION_KEY = "pilketos_admin_pw";
let sessionPassword = sessionStorage.getItem(SESSION_KEY) || null;

document.addEventListener("DOMContentLoaded", async function () {
    await loadElectionStatus();
    await loadCandidates();
    updateStatus();
    renderCandidates();
    renderVoterConfig();
    /* Muat voter config setelah UI sudah tampil — password diminta via modal custom */
    await loadVoterConfig();
    renderVoterConfig();
});

function goDashboard() { window.location.href = "/"; }

async function loadElectionStatus() {
    try {
        const r = await fetch("/api/election", { cache: "no-store" });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);
        electionStatus = d.status || "DRAFT";
        publishedState = d.published === true;
        /* Tampilkan wallpaper di preview admin jika ada */
        const preview = document.getElementById("heroPreview");
        const deleteBtn = document.getElementById("deleteHeroButton");
        if (preview) {
            if (d.heroImage) {
                preview.innerHTML = `<img src="${esc(d.heroImage)}" alt="Hero wallpaper">`;
                if (deleteBtn) deleteBtn.style.display = "";
            } else {
                preview.innerHTML = '<span class="hero-preview-placeholder">Belum ada wallpaper</span>';
                if (deleteBtn) deleteBtn.style.display = "none";
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function loadCandidates() {
    try {
        const r = await fetch("/api/candidates", { cache: "no-store" });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);
        candidates = d.candidates || [];
    } catch (e) {
        console.error(e);
        candidates = [];
    }
}

async function loadVoterConfig() {
    const pw = await ensurePassword();
    if (!pw) return;
    try {
        const r = await fetch("/api/admin/voter-config", {
            cache: "no-store",
            headers: { "x-admin-password": pw }
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);
        voterConfig.roles = d.roles || [];
        voterConfig.classes = d.classes || [];
        voterConfig.departments = d.departments || [];
        voterConfig.codes = d.codes || [];
    } catch (e) {
        console.error(e);
        if (String(e.message).includes("401") || String(e.message).includes("Password")) {
            sessionPassword = null;
            try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
        }
        toast(e.message || "Gagal memuat konfigurasi pemilih.", "error");
    }
}

async function ensurePassword() {
    if (sessionPassword) return sessionPassword;

    /* Pakai modal custom, bukan prompt() native */
    const pw = await appPromptPassword();
    if (!pw) return null;

    /* appPromptPassword sudah verifikasi ke server — tinggal simpan */
    sessionPassword = pw;
    try { sessionStorage.setItem(SESSION_KEY, pw); } catch (e) { /* private mode */ }
    return pw;
}

async function verifyAdminPassword(pw) {
    try {
        const r = await fetch("/api/admin/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: pw })
        });
        if (!r.headers.get("content-type")?.includes("application/json"))
            throw new Error("Bukan JSON. Buka via http://localhost:3000.");
        const d = await r.json();
        return d.success === true;
    } catch (e) { console.error(e); return false; }
}

async function adminRequest(url, method, body, pw) {
    const headers = { "Content-Type": "application/json" };
    if (pw) headers["x-admin-password"] = pw;
    const r = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!r.headers.get("content-type")?.includes("application/json"))
        throw new Error("Bukan JSON. Buka via http://localhost:3000.");
    const d = await r.json();
    if (!d.success) throw new Error(d.message || "Permintaan gagal.");
    return d;
}

function updateStatus() {
    const labels = {
        DRAFT: "DRAFT — Konfigurasi terbuka",
        READY: "READY — Menunggu dibuka",
        OPEN: "OPEN — Pemilihan berlangsung",
        CLOSED: "CLOSED — Pemilihan selesai"
    };
    const el = (id) => document.getElementById(id);

    if (el("statusText")) el("statusText").textContent = labels[electionStatus] || electionStatus;
    if (el("statusBadge")) { el("statusBadge").textContent = electionStatus; el("statusBadge").className = "status-badge " + electionStatus.toLowerCase(); }
    if (el("statusDot")) el("statusDot").className = "status-dot " + electionStatus.toLowerCase();

    const isDraft = electionStatus === "DRAFT";
    const isReady = electionStatus === "READY";
    const isOpen  = electionStatus === "OPEN";
    const isClosed = electionStatus === "CLOSED";

    if (el("readyButton"))          el("readyButton").disabled          = !isDraft;
    if (el("openButton"))           el("openButton").disabled           = !isReady;
    if (el("unlockButton"))         el("unlockButton").disabled         = !isReady;
    if (el("closeButton"))          el("closeButton").disabled          = !isOpen;
    if (el("resetButton"))          el("resetButton").disabled          = !isClosed;
    if (el("addCandidateButton"))   el("addCandidateButton").disabled   = !isDraft;
    if (el("addClassButton"))       el("addClassButton").disabled       = !isDraft;
    if (el("addDepartmentButton"))  el("addDepartmentButton").disabled  = !isDraft;
    if (el("generateCodeButton"))   el("generateCodeButton").disabled   = !isDraft;

    const publishBtn = el("publishButton");
    if (publishBtn) {
        publishBtn.disabled = !(isClosed || publishedState);
        publishBtn.textContent = publishedState ? "SEMBUNYIKAN HASIL" : "PUBLIKASIKAN HASIL";
        publishBtn.className = publishedState
            ? "danger-button"
            : "secondary-button";
    }
}

function isDraftCheck() {
    if (electionStatus !== "DRAFT") {
        toast("Konfigurasi hanya dapat diubah saat status DRAFT.", "error");
        return false;
    }
    return true;
}

async function setReady() {
    if (!isDraftCheck()) return;
    if (candidates.length < 2) { toast("Minimal 2 Paslon sebelum disiapkan.", "error"); return; }
    const activeCodes = voterConfig.codes.filter(c => !c.used);
    if (activeCodes.length < 1) { toast("Buat minimal 1 kode pemilih terlebih dahulu.", "error"); return; }

    const ok = await appConfirm(
        "Setelah READY, konfigurasi dikunci sampai Anda membuka kembali.",
        { title: "Siapkan Pemilihan?", okLabel: "SIAPKAN", danger: false, icon: "✓" }
    );
    if (!ok) return;

    const pw = await ensurePassword();
    if (!pw) return;
    try {
        await adminRequest("/api/election/ready", "POST", {}, pw);
        electionStatus = "READY";
        updateStatus();
        toast("Pemilihan berhasil disiapkan. Status sekarang READY.", "success");
    } catch (e) { toast(e.message || "Gagal menyiapkan pemilihan.", "error"); }
}

async function openElection() {
    if (electionStatus !== "READY") return;
    const ok = await appConfirm(
        "Setelah dibuka, pemilih dapat menggunakan kode pemilih mereka.",
        { title: "Buka Pemilihan?", okLabel: "BUKA SEKARANG", danger: false, icon: "▶" }
    );
    if (!ok) return;
    const pw = await ensurePassword();
    if (!pw) return;
    try {
        await adminRequest("/api/election/open", "POST", {}, pw);
        electionStatus = "OPEN";
        updateStatus();
        toast("Pemilihan berhasil dibuka.", "success");
    } catch (e) { toast(e.message || "Gagal membuka pemilihan.", "error"); }
}

async function closeElection() {
    if (electionStatus !== "OPEN") return;
    const ok = await appConfirm(
        "Setelah ditutup, pemilih tidak dapat mengirim suara lagi.\n\nTindakan ini tidak dapat dibatalkan.",
        { title: "Selesaikan Pemilihan?", okLabel: "SELESAIKAN", danger: true, icon: "■" }
    );
    if (!ok) return;
    const pw = await ensurePassword();
    if (!pw) return;
    try {
        await adminRequest("/api/election/close", "POST", {}, pw);
        electionStatus = "CLOSED";
        updateStatus();
        toast("Pemilihan selesai. Status sekarang CLOSED.", "success");
    } catch (e) { toast(e.message || "Gagal menyelesaikan pemilihan.", "error"); }
}

async function resetElection() {
    if (electionStatus !== "CLOSED") return;

    const voteCount = voterConfig.codes.filter(function (c) { return c.used; }).length;

    /* P2C — konfirmasi ketik frasa */
    const confirmed = await appTypedConfirm(
        `Status akan dikembalikan ke DRAFT untuk pemilihan baru.\n\n${voteCount} data suara akan diarsip (bisa dipulihkan jika perlu).\n\nSemua kode pemilih akan dihapus permanen.`,
        { title: "Reset untuk Pemilihan Baru?", confirmPhrase: "RESET PEMILIHAN", okLabel: "RESET", danger: true, icon: "↺" }
    );
    if (!confirmed) return;

    const pw = await ensurePassword();
    if (!pw) return;
    try {
        await adminRequest("/api/election/reset", "POST", { confirmPhrase: "RESET PEMILIHAN" }, pw);
        electionStatus = "DRAFT";
        updateStatus();
        toast("Pemilihan direset ke DRAFT. Data suara diarsip.", "success");
    } catch (e) { toast(e.message || "Gagal mereset pemilihan.", "error"); }
}

function unlockElection() {
    if (electionStatus !== "READY") return;
    const m = document.getElementById("unlockModal");
    if (m) m.classList.add("active");
}
function closeUnlockModal() {
    const m = document.getElementById("unlockModal");
    if (m) m.classList.remove("active");
    const i = document.getElementById("unlockPassword");
    if (i) i.value = "";
}
async function submitUnlock() {
    const i = document.getElementById("unlockPassword");
    const pw = i ? i.value.trim() : "";
    if (!pw) { toast("Masukkan password.", "error"); return; }
    const ok = await verifyAdminPassword(pw);
    if (!ok) { toast("Password salah.", "error"); return; }
    try {
        await adminRequest("/api/election/unlock", "POST", {}, pw);
        electionStatus = "DRAFT";
        sessionPassword = pw;
        try { sessionStorage.setItem(SESSION_KEY, pw); } catch (_) {}
        updateStatus();
        closeUnlockModal();
        toast("Konfigurasi terbuka kembali. Status sekarang DRAFT.", "success");
    } catch (e) { toast(e.message || "Gagal membuka konfigurasi.", "error"); }
}

function renderCandidates() {
    const c = document.getElementById("candidateList");
    if (!c) return;
    c.innerHTML = "";
    if (!candidates.length) {
        c.innerHTML = `<div class="empty-state"><h3>Belum ada Paslon</h3><p>Tambahkan pasangan calon menggunakan tombol + TAMBAH PASLON.</p></div>`;
        return;
    }
    candidates.forEach(function (cd) {
        const card = document.createElement("div");
        card.className = "candidate-card";
        const dis = electionStatus !== "DRAFT" ? "disabled" : "";
        card.innerHTML = `
            <div class="candidate-photo">
                ${cd.photo ? `<img src="${esc(cd.photo)}" alt="Foto ${esc(cd.name)}">` : `<span class="photo-placeholder">FOTO PASLON</span>`}
            </div>
            <div class="candidate-info">
                <p class="candidate-number">PASLON ${String(cd.number).padStart(2,"0")}</p>
                <h3>${esc(cd.name||"-")}</h3>
                <p>Ketua: <strong>${esc(cd.chairman||"-")}</strong></p>
                <p>Wakil: <strong>${esc(cd.vice||"-")}</strong></p>
                <div class="candidate-actions">
                    <button class="secondary-button" onclick="editCandidate(${cd.id})" ${dis}
                        aria-label="Edit Paslon ${String(cd.number).padStart(2,'0')}">EDIT</button>
                    <button class="danger-button" onclick="deleteCandidate(${cd.id})" ${dis}
                        aria-label="Hapus Paslon ${String(cd.number).padStart(2,'0')}">HAPUS</button>
                </div>
            </div>`;
        c.appendChild(card);
    });
}

function openCandidateModal() {
    if (!isDraftCheck()) return;
    editingCandidateId = null;
    const m = document.getElementById("candidateModal");
    const t = document.getElementById("candidateModalTitle");
    if (t) t.textContent = "Tambah Paslon";
    if (m) m.classList.add("active");
    resetCandidateForm();
}
function closeCandidateModal() {
    const m = document.getElementById("candidateModal");
    if (m) m.classList.remove("active");
    editingCandidateId = null;
    resetCandidateForm();
}
function resetCandidateForm() {
    ["candidateId","candidateNumber","candidateName","candidateChairman","candidateVice"].forEach(function(id) {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    const pi = document.getElementById("candidatePhoto");
    if (pi) pi.value = "";
    const pv = document.getElementById("candidatePhotoPreview");
    if (pv) pv.innerHTML = '<span class="photo-placeholder">FOTO PASLON</span>';
    const note = document.getElementById("candidateCurrentPhotoNote");
    if (note) note.textContent = "";
    const lbl = document.getElementById("candidatePhotoLabel");
    if (lbl) lbl.textContent = "📷 Pilih Foto";
}
function previewPhoto(event) {
    const file = event.target.files && event.target.files[0];
    const pv = document.getElementById("candidatePhotoPreview");
    if (!pv) return;
    if (!file) { pv.innerHTML = '<span class="photo-placeholder">FOTO PASLON</span>'; return; }
    const fr = new FileReader();
    fr.onload = function(e) { pv.innerHTML = `<img src="${e.target.result}" alt="Preview">`; };
    fr.readAsDataURL(file);
}
function editCandidate(id) {
    if (!isDraftCheck()) return;
    const cd = candidates.find(c => Number(c.id) === Number(id));
    if (!cd) return;
    editingCandidateId = cd.id;
    const m = document.getElementById("candidateModal");
    const t = document.getElementById("candidateModalTitle");
    if (t) t.textContent = "Edit Paslon";
    if (m) m.classList.add("active");
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    set("candidateId", cd.id);
    set("candidateNumber", cd.number || "");
    set("candidateName", cd.name || "");
    set("candidateChairman", cd.chairman || "");
    set("candidateVice", cd.vice || "");
    const pi = document.getElementById("candidatePhoto");
    if (pi) pi.value = "";
    const pv = document.getElementById("candidatePhotoPreview");
    if (pv) pv.innerHTML = cd.photo ? `<img src="${esc(cd.photo)}" alt="Preview">` : '<span class="photo-placeholder">FOTO PASLON</span>';
    const note = document.getElementById("candidateCurrentPhotoNote");
    if (note) note.textContent = cd.photo ? "Foto terpasang — klik tombol di atas untuk mengganti." : "Belum ada foto — klik tombol di atas untuk mengunggah.";
    const lbl = document.getElementById("candidatePhotoLabel");
    if (lbl) lbl.textContent = cd.photo ? "📷 Ganti Foto" : "📷 Pilih Foto";
}
async function saveCandidate() {
    if (!isDraftCheck()) return;
    const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
    const number = val("candidateNumber"), name = val("candidateName"), chairman = val("candidateChairman"), vice = val("candidateVice");
    if (!number || !name || !chairman || !vice) { toast("Semua field wajib diisi.", "error"); return; }
    if (isNaN(Number(number)) || Number(number) <= 0) { toast("Nomor harus angka positif.", "error"); return; }
    const pw = await ensurePassword();
    if (!pw) return;
    const pi = document.getElementById("candidatePhoto");
    const hasPhoto = pi && pi.files && pi.files.length > 0;
    try {
        let photoUrl = null;
        if (hasPhoto) {
            const numToUse = editingCandidateId
                ? (candidates.find(c => Number(c.id) === Number(editingCandidateId))?.number || Number(number))
                : Number(number);
            if (!editingCandidateId) {
                const createData = await adminRequest("/api/admin/candidates", "POST", { number: Number(number), name, chairman, vice, photo: null }, pw);
                const newId = createData.candidate?.id;
                const newNum = createData.candidate?.number || Number(number);
                const fd = new FormData();
                fd.append("photo", pi.files[0]);
                const ur = await fetch(`/api/admin/candidates/upload/${newNum}`, { method: "POST", headers: { "x-admin-password": pw }, body: fd });
                const ud = await ur.json();
                if (!ud.success) throw new Error(ud.message || "Gagal upload foto.");
                photoUrl = ud.photo || null;
                if (newId) await adminRequest(`/api/admin/candidates/${newId}`, "PUT", { number: Number(number), name, chairman, vice, photo: photoUrl }, pw);
                await loadCandidates();
                renderCandidates();
                closeCandidateModal();
                toast("Paslon berhasil ditambahkan.", "success");
                return;
            } else {
                const fd = new FormData();
                fd.append("photo", pi.files[0]);
                const ur = await fetch(`/api/admin/candidates/upload/${numToUse}`, { method: "POST", headers: { "x-admin-password": pw }, body: fd });
                const ud = await ur.json();
                if (!ud.success) throw new Error(ud.message || "Gagal upload foto.");
                photoUrl = ud.photo || null;
            }
        }
        const body = { number: Number(number), name, chairman, vice };
        if (photoUrl !== null) body.photo = photoUrl;
        let data;
        if (editingCandidateId) {
            data = await adminRequest(`/api/admin/candidates/${editingCandidateId}`, "PUT", body, pw);
            if (data.candidate) candidates = candidates.map(c => Number(c.id) === Number(editingCandidateId) ? data.candidate : c);
        } else {
            data = await adminRequest("/api/admin/candidates", "POST", body, pw);
            if (data.candidate) candidates.push(data.candidate);
        }
        renderCandidates();
        closeCandidateModal();
        toast(editingCandidateId ? "Paslon diperbarui." : "Paslon ditambahkan.", "success");
    } catch (e) { console.error(e); toast(e.message || "Gagal menyimpan Paslon.", "error"); }
}
async function deleteCandidate(id) {
    if (!isDraftCheck()) return;
    const cd = candidates.find(c => Number(c.id) === Number(id));
    if (!cd) return;
    const ok = await appConfirm(
        `Paslon ${String(cd.number).padStart(2,"00")} — ${cd.name} akan dihapus permanen.`,
        { title: "Hapus Paslon ini?", okLabel: "HAPUS", danger: true }
    );
    if (!ok) return;
    const pw = await ensurePassword();
    if (!pw) return;
    try {
        await adminRequest(`/api/admin/candidates/${id}`, "DELETE", undefined, pw);
        candidates = candidates.filter(c => Number(c.id) !== Number(id));
        renderCandidates();
        toast("Paslon dihapus.", "success");
    } catch (e) { toast(e.message || "Gagal menghapus.", "error"); }
}

function renderVoterConfig() {
    renderRoles();
    renderClasses();
    renderCodes();
}

function renderRoles() {
    const c = document.getElementById("roleList");
    if (!c) return;
    c.innerHTML = "";
    if (!voterConfig.roles.length) { c.innerHTML = '<div class="config-empty">Memuat...</div>'; return; }
    voterConfig.roles.forEach(function (role) {
        const isActive = role.active === 1 || role.active === true;
        const dis = electionStatus !== "DRAFT" ? "disabled" : "";
        const row = document.createElement("div");
        row.className = "config-item";
        row.innerHTML = `
            <span class="config-name">${esc(role.name)}</span>
            <span class="config-status ${isActive ? "badge-active" : "badge-inactive"}">${isActive ? "AKTIF" : "NONAKTIF"}</span>
            <button class="small-button" onclick="toggleRole(${role.id},${isActive})" ${dis}
                aria-label="${isActive ? "Nonaktifkan" : "Aktifkan"} jenis pemilih ${esc(role.name)}">
                ${isActive ? "NONAKTIFKAN" : "AKTIFKAN"}
            </button>`;
        c.appendChild(row);
    });
}

function renderClasses() {
    const c = document.getElementById("classList");
    if (!c) return;
    c.innerHTML = "";
    if (!voterConfig.classes.length) { c.innerHTML = '<div class="config-empty">Belum ada kelas.</div>'; return; }
    voterConfig.classes.forEach(function (item) {
        const dis = electionStatus !== "DRAFT" ? "disabled" : "";
        const row = document.createElement("div");
        row.className = "config-item";
        row.innerHTML = `
            <span class="config-name">${esc(item.name)}</span>
            <button class="danger-button small-button" onclick="deleteClass(${item.id})" ${dis}
                aria-label="Hapus kelas ${esc(item.name)}">HAPUS</button>`;
        c.appendChild(row);
    });
}

function renderDepartments() {
    const c = document.getElementById("departmentList");
    if (!c) return;
    c.innerHTML = "";
    if (!voterConfig.departments.length) { c.innerHTML = '<div class="config-empty">Belum ada jurusan.</div>'; return; }
    voterConfig.departments.forEach(function (item) {
        const dis = electionStatus !== "DRAFT" ? "disabled" : "";
        const row = document.createElement("div");
        row.className = "config-item";
        row.innerHTML = `
            <div>
                <span class="config-name">${esc(item.name)}</span>
                <span class="config-sub">${esc(item.className||"")}</span>
            </div>
            <button class="danger-button small-button" onclick="deleteDepartment(${item.id})" ${dis}
                aria-label="Hapus jurusan ${esc(item.name)}">HAPUS</button>`;
        c.appendChild(row);
    });
}

/* ── FILTER STATE untuk kode pemilih ── */
let codeFilter = { text: "", status: "all" };

function renderCodes() {
    const stats = document.getElementById("codeStats");
    const toolbar = document.getElementById("codeBulkToolbar");
    const clearBar = document.getElementById("clearVotesBar");
    const clearLabel = document.getElementById("clearVotesLabel");
    const c = document.getElementById("codeList");
    if (!c) return;

    const total  = voterConfig.codes.length;
    const used   = voterConfig.codes.filter(x => x.used).length;
    const active = total - used;

    if (stats) stats.innerHTML = `
        <div class="stat-item"><strong>${total}</strong><span>Total</span></div>
        <div class="stat-item"><strong>${active}</strong><span>Aktif</span></div>
        <div class="stat-item"><strong>${used}</strong><span>Digunakan</span></div>`;

    /* Tampilkan clearVotesBar jika ada kode yang sudah digunakan */
    if (clearBar) {
        if (used > 0) {
            clearBar.style.display = "flex";
            if (clearLabel) clearLabel.textContent = `${used} kode sudah digunakan. Reset data pemilihan agar kode bisa dipakai lagi.`;
        } else {
            clearBar.style.display = "none";
        }
    }

    const canEdit = electionStatus === "DRAFT";

    if (toolbar) {
        toolbar.style.display = (canEdit && active > 0) ? "flex" : "none";
    }

    /* render filter bar */
    let filterBar = document.getElementById("codeFilterBar");
    if (!filterBar) {
        filterBar = document.createElement("div");
        filterBar.id = "codeFilterBar";
        filterBar.className = "code-filter-bar";
        filterBar.innerHTML = `
            <input type="search" id="codeFilterText" placeholder="Cari kode, role, kelas, jurusan…"
                aria-label="Cari kode pemilih"
                oninput="onCodeFilterChange()">
            <select id="codeFilterStatus" aria-label="Filter status kode" onchange="onCodeFilterChange()">
                <option value="all">Semua Status</option>
                <option value="active">Belum Dipakai</option>
                <option value="used">Sudah Dipakai</option>
            </select>`;
        c.before(filterBar);

        /* restore previous filter values */
        const textEl = document.getElementById("codeFilterText");
        const statusEl = document.getElementById("codeFilterStatus");
        if (textEl) textEl.value = codeFilter.text;
        if (statusEl) statusEl.value = codeFilter.status;
    }

    applyCodeFilter();
}

function onCodeFilterChange() {
    const textEl = document.getElementById("codeFilterText");
    const statusEl = document.getElementById("codeFilterStatus");
    codeFilter.text   = textEl   ? textEl.value.trim().toLowerCase()   : "";
    codeFilter.status = statusEl ? statusEl.value : "all";
    applyCodeFilter();
}

function applyCodeFilter() {
    const c = document.getElementById("codeList");
    if (!c) return;
    c.innerHTML = "";

    const q = codeFilter.text;
    const st = codeFilter.status;
    const canEdit = electionStatus === "DRAFT";

    const filtered = voterConfig.codes.filter(function (code) {
        if (st === "active" && code.used) return false;
        if (st === "used"   && !code.used) return false;
        if (q) {
            const meta = [code.code, code.role, code.className, code.department]
                .filter(Boolean).join(" ").toLowerCase();
            if (!meta.includes(q)) return false;
        }
        return true;
    });

    if (!filtered.length) {
        c.innerHTML = voterConfig.codes.length
            ? '<div class="config-empty">Tidak ada kode yang cocok dengan filter.</div>'
            : '<div class="config-empty">Belum ada kode. Klik GENERATE KODE untuk membuat.</div>';
        return;
    }

    filtered.forEach(function (code) {
        const canDelete = canEdit && !code.used;
        const row = document.createElement("div");
        row.className = "code-item" + (code.used ? " code-used" : "");
        row.dataset.id = code.id;

        const meta = [code.role, code.className, code.department].filter(Boolean).join(" · ");

        row.innerHTML = `
            <label class="code-check-wrap">
                <input type="checkbox" class="code-checkbox" data-id="${code.id}"
                    ${canDelete ? "" : "disabled"}
                    aria-label="Pilih kode ${esc(code.code)}"
                    onchange="onCodeCheckChange()">
            </label>
            <div class="code-info">
                <strong class="code-text">${esc(code.code)}</strong>
                ${meta ? `<span class="code-meta">${esc(meta)}</span>` : ""}
            </div>
            <div class="code-right">
                <span class="code-status ${code.used ? "status-used" : "status-active"}">${code.used ? "DIGUNAKAN" : "AKTIF"}</span>
                <button class="danger-button small-button" onclick="deleteCode(${code.id})"
                    ${canDelete ? "" : "disabled"}
                    aria-label="Hapus kode ${esc(code.code)}">HAPUS</button>
            </div>`;
        c.appendChild(row);
    });

    updateBulkToolbar();
}

function onCodeCheckChange() { updateBulkToolbar(); }

function updateBulkToolbar() {
    const checkboxes = document.querySelectorAll(".code-checkbox:not(:disabled)");
    const checked    = document.querySelectorAll(".code-checkbox:checked");
    const selectAllBtn  = document.getElementById("selectAllCodesBtn");
    const deleteSelBtn  = document.getElementById("deleteSelectedCodesBtn");
    const countLabel    = document.getElementById("selectedCodeCount");

    const allChecked = checkboxes.length > 0 && checked.length === checkboxes.length;
    if (selectAllBtn) selectAllBtn.textContent = allChecked ? "BATAL PILIH" : "PILIH SEMUA";
    if (deleteSelBtn) deleteSelBtn.disabled = checked.length === 0;
    if (countLabel)   countLabel.textContent = checked.length > 0 ? `${checked.length} dipilih` : "";
}

function toggleSelectAllCodes() {
    const checkboxes = document.querySelectorAll(".code-checkbox:not(:disabled)");
    const checked    = document.querySelectorAll(".code-checkbox:checked");
    const shouldCheck = checked.length < checkboxes.length;
    checkboxes.forEach(function (cb) { cb.checked = shouldCheck; });
    updateBulkToolbar();
}

async function deleteSelectedCodes() {
    if (!isDraftCheck()) return;
    const checked = document.querySelectorAll(".code-checkbox:checked");
    if (!checked.length) { toast("Pilih kode yang ingin dihapus.", "error"); return; }
    const ids = Array.from(checked).map(function (cb) { return Number(cb.dataset.id); });
    const ok = await appConfirm(
        `${ids.length} kode terpilih akan dihapus.\n\nKode yang sudah digunakan tidak akan terpengaruh.`,
        { title: `Hapus ${ids.length} kode?`, okLabel: "HAPUS", danger: true }
    );
    if (!ok) return;
    const pw = await ensurePassword();
    if (!pw) return;
    try {
        const data = await adminRequest("/api/admin/voter-codes", "DELETE", { ids }, pw);
        await loadVoterConfig();
        renderCodes();
        toast(`${data.deleted} kode berhasil dihapus.`, "success");
    } catch (e) { toast(e.message || "Gagal menghapus kode.", "error"); }
}

async function clearVotesData() {
    const status = electionStatus;
    if (status === "OPEN" || status === "READY") {
        toast(`Tidak dapat menghapus data suara saat status ${status}. Selesaikan pemilihan dulu.`, "error");
        return;
    }

    const used = voterConfig.codes.filter(function (c) { return c.used; }).length;

    /* P2C — konfirmasi kata kunci */
    const confirmed = await appTypedConfirm(
        `Semua data suara (${used > 0 ? used + " suara" : "0 suara"}) akan dihapus dan diarsip.\n\nKode pemilih akan direset menjadi AKTIF kembali.\n\nTindakan ini tidak dapat dibatalkan langsung — arsip tersedia untuk pemulihan darurat.`,
        {
            title:        "Hapus Data Suara?",
            confirmPhrase: "HAPUS SEMUA SUARA",
            okLabel:       "HAPUS",
            danger:        true,
            icon:          "🗑"
        }
    );
    if (!confirmed) return;

    const pw = await ensurePassword();
    if (!pw) return;

    try {
        const data = await adminRequest("/api/admin/votes/clear", "POST", { confirmPhrase: "HAPUS SEMUA SUARA" }, pw);
        toast(data.message || "Data pemilihan berhasil dihapus.", "success");
        await loadVoterConfig();
        renderCodes();
    } catch (e) {
        toast(e.message || "Gagal menghapus data pemilihan.", "error");
    }
}

async function deleteAllActiveCodes() {
    if (!isDraftCheck()) return;
    const active = voterConfig.codes.filter(function (c) { return !c.used; });
    if (!active.length) { toast("Tidak ada kode aktif.", "error"); return; }
    const ok = await appConfirm(
        `Semua ${active.length} kode aktif akan dihapus permanen.\n\nTindakan ini tidak dapat dibatalkan.`,
        { title: "Hapus Semua Kode Aktif?", okLabel: "HAPUS SEMUA", danger: true }
    );
    if (!ok) return;
    const pw = await ensurePassword();
    if (!pw) return;
    try {
        const data = await adminRequest("/api/admin/voter-codes", "DELETE", { all: true }, pw);
        await loadVoterConfig();
        renderCodes();
        toast(`${data.deleted} kode berhasil dihapus.`, "success");
    } catch (e) { toast(e.message || "Gagal menghapus kode.", "error"); }
}

async function toggleRole(id, currentlyActive) {
    if (!isDraftCheck()) return;
    const pw = await ensurePassword();
    if (!pw) return;
    try {
        await adminRequest(`/api/admin/voter-roles/${id}`, "PUT", { active: !currentlyActive }, pw);
        await loadVoterConfig();
        renderRoles();
    } catch (e) { toast(e.message || "Gagal mengubah status.", "error"); }
}

function openAddClassModal() {
    if (!isDraftCheck()) return;
    const m = document.getElementById("addClassModal");
    if (m) m.classList.add("active");
    const i = document.getElementById("newClassName");
    if (i) { i.value = ""; setTimeout(() => i.focus(), 50); }
}
function closeAddClassModal() {
    const m = document.getElementById("addClassModal");
    if (m) m.classList.remove("active");
}
async function submitAddClass() {
    const i = document.getElementById("newClassName");
    const name = i ? i.value.trim() : "";
    if (!name) { toast("Masukkan nama kelas.", "error"); return; }
    const pw = await ensurePassword();
    if (!pw) return;
    try {
        await adminRequest("/api/admin/voter-classes", "POST", { name }, pw);
        closeAddClassModal();
        await loadVoterConfig();
        renderClasses();
        renderDepartments();
        populateDeptClassSelect();
        toast("Kelas berhasil ditambahkan.", "success");
    } catch (e) { toast(e.message || "Gagal menambahkan kelas.", "error"); }
}
async function deleteClass(id) {
    if (!isDraftCheck()) return;
    const ok = await appConfirm(
        "Jurusan yang terdaftar di kelas ini juga akan dihapus.",
        { title: "Hapus kelas ini?", okLabel: "HAPUS", danger: true }
    );
    if (!ok) return;
    const pw = await ensurePassword();
    if (!pw) return;
    try {
        await adminRequest(`/api/admin/voter-classes/${id}`, "DELETE", undefined, pw);
        await loadVoterConfig();
        renderClasses();
        renderDepartments();
        toast("Kelas dihapus.", "success");
    } catch (e) { toast(e.message || "Gagal menghapus kelas.", "error"); }
}

function populateDeptClassSelect() {
    const sel = document.getElementById("newDepartmentClass");
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">Pilih Kelas</option>';
    voterConfig.classes.forEach(function (item) {
        const o = document.createElement("option");
        o.value = item.id;
        o.textContent = item.name;
        sel.appendChild(o);
    });
    if (cur) sel.value = cur;
}
function openAddDepartmentModal() {
    if (!isDraftCheck()) return;
    const m = document.getElementById("addDepartmentModal");
    if (m) m.classList.add("active");
    populateDeptClassSelect();
    const ni = document.getElementById("newDepartmentName");
    if (ni) { ni.value = ""; setTimeout(() => ni.focus(), 50); }
}
function closeAddDepartmentModal() {
    const m = document.getElementById("addDepartmentModal");
    if (m) m.classList.remove("active");
}
async function submitAddDepartment() {
    const sel = document.getElementById("newDepartmentClass");
    const ni  = document.getElementById("newDepartmentName");
    const classId = sel ? sel.value : "";
    const name = ni ? ni.value.trim() : "";
    if (!classId) { toast("Pilih kelas.", "error"); return; }
    if (!name)    { toast("Masukkan nama jurusan.", "error"); return; }
    const pw = await ensurePassword();
    if (!pw) return;
    try {
        await adminRequest("/api/admin/voter-departments", "POST", { class_id: Number(classId), name }, pw);
        closeAddDepartmentModal();
        await loadVoterConfig();
        renderDepartments();
        toast("Jurusan berhasil ditambahkan.", "success");
    } catch (e) { toast(e.message || "Gagal menambahkan jurusan.", "error"); }
}
async function deleteDepartment(id) {
    if (!isDraftCheck()) return;
    const ok = await appConfirm(
        "Jurusan ini akan dihapus permanen.",
        { title: "Hapus jurusan ini?", okLabel: "HAPUS", danger: true }
    );
    if (!ok) return;
    const pw = await ensurePassword();
    if (!pw) return;
    try {
        await adminRequest(`/api/admin/voter-departments/${id}`, "DELETE", undefined, pw);
        await loadVoterConfig();
        renderDepartments();
        toast("Jurusan dihapus.", "success");
    } catch (e) { toast(e.message || "Gagal menghapus jurusan.", "error"); }
}

function openGenerateModal() {
    if (!isDraftCheck()) return;
    const m = document.getElementById("generateModal");
    if (m) m.classList.add("active");

    const roleEl = document.getElementById("genRole");
    if (roleEl) {
        roleEl.innerHTML = '<option value="">Pilih Jenis Pemilih</option>';
        voterConfig.roles.forEach(function (r) {
            if (!r.active) return;
            const o = document.createElement("option");
            o.value = r.id;
            o.textContent = r.name;
            roleEl.appendChild(o);
        });
        roleEl.value = "";
    }

    /* Populate kelas dropdown */
    const classEl = document.getElementById("genClass");
    if (classEl) {
        classEl.innerHTML = '<option value="">Pilih Kelas</option><option value="ALL">— Semua Kelas (10 + 11 + 12) —</option>';
        voterConfig.classes.forEach(function (cl) {
            const o = document.createElement("option");
            o.value = cl.id;
            o.textContent = cl.name;
            classEl.appendChild(o);
        });
        classEl.value = "";
    }

    /* Sembunyikan kelas dulu */
    const classGroup = document.getElementById("genClassGroup");
    if (classGroup) classGroup.style.display = "none";

    const a = document.getElementById("codeAmount");
    if (a) a.value = "1";

    const hint = document.getElementById("genAmountHint");
    if (hint) hint.textContent = "";

    setTimeout(function () {
        if (roleEl) roleEl.focus();
    }, 50);
}

function onGenRoleChange() {
    const roleEl = document.getElementById("genRole");
    const classGroup = document.getElementById("genClassGroup");
    if (!roleEl || !classGroup) return;
    const selectedRole = voterConfig.roles.find(function (r) { return String(r.id) === String(roleEl.value); });
    const isSiswa = selectedRole && selectedRole.name === "SISWA";
    classGroup.style.display = isSiswa ? "" : "none";
    if (!isSiswa) {
        const classEl = document.getElementById("genClass");
        if (classEl) classEl.value = "";
    }
    /* Update hint jumlah kode */
    const classEl = document.getElementById("genClass");
    const hint = document.getElementById("genAmountHint");
    if (hint && classEl && classEl.value === "ALL") {
        hint.textContent = "(per kelas × 3 kelas)";
    } else if (hint) {
        hint.textContent = "";
    }
    _updateGenAmountHint();
}

function _updateGenAmountHint() {
    const classEl = document.getElementById("genClass");
    const hint = document.getElementById("genAmountHint");
    if (!hint || !classEl) return;
    hint.textContent = classEl.value === "ALL" ? "(jumlah ini × 3 kelas)" : "";
}

function closeGenerateModal() {
    const m = document.getElementById("generateModal");
    if (m) m.classList.remove("active");
}

async function submitGenerateCodes() {
    const roleEl   = document.getElementById("genRole");
    const classEl  = document.getElementById("genClass");
    const amountEl = document.getElementById("codeAmount");

    const roleId  = roleEl  ? roleEl.value  : "";
    const classId = classEl ? classEl.value : "";
    const amount  = amountEl ? Number(amountEl.value) : 0;

    if (!roleId) { toast("Pilih jenis pemilih.", "error"); return; }

    const role = voterConfig.roles.find(function (r) { return String(r.id) === String(roleId); });
    if (!role) { toast("Jenis pemilih tidak ditemukan.", "error"); return; }

    /* Kelas wajib untuk SISWA */
    const isSiswa = role.name === "SISWA";
    if (isSiswa && !classId) { toast("Pilih kelas untuk pemilih Siswa.", "error"); return; }

    if (!Number.isInteger(amount) || amount < 1 || amount > 5000) {
        toast("Jumlah kode harus antara 1 sampai 5000.", "error");
        return;
    }

    const isAllClass = classId === "ALL";

    /* Siapkan daftar kelas yang akan di-generate */
    let classTargets = [];
    if (isSiswa && isAllClass) {
        classTargets = voterConfig.classes.map(function (c) { return { id: c.id, name: c.name }; });
    } else if (isSiswa && classId) {
        const classObj = voterConfig.classes.find(function (c) { return String(c.id) === String(classId); });
        if (classObj) classTargets = [{ id: classObj.id, name: classObj.name }];
    }

    const labelKelas = isAllClass
        ? ` — Semua Kelas (${voterConfig.classes.map(function(c){return c.name;}).join(", ")})`
        : (classTargets.length ? ` — ${classTargets[0].name}` : "");

    const totalKode = isSiswa ? amount * classTargets.length : amount;

    const ok = await appConfirm(
        `Akan dibuat ${isSiswa && isAllClass ? `${amount} kode × ${classTargets.length} kelas = ${totalKode} kode total` : `${amount} kode`} untuk ${role.name}${labelKelas}.\n\nSetiap kode hanya dapat digunakan satu kali.`,
        { title: "Generate Kode Pemilih?", okLabel: "GENERATE", danger: false, icon: "✦" }
    );
    if (!ok) return;

    const pw = await ensurePassword();
    if (!pw) return;

    try {
        if (isSiswa && isAllClass) {
            /* Generate per kelas satu per satu */
            let totalGenerated = 0;
            for (const cls of classTargets) {
                const data = await adminRequest("/api/admin/voter-codes/generate", "POST", {
                    roleId: Number(roleId),
                    classId: cls.id,
                    amount
                }, pw);
                totalGenerated += data.amount || amount;
            }
            closeGenerateModal();
            await loadVoterConfig();
            renderCodes();
            toast(`${totalGenerated} kode berhasil dibuat untuk semua kelas.`, "success");
        } else {
            const body = { roleId: Number(roleId), amount };
            if (isSiswa && classId) body.classId = Number(classId);
            const data = await adminRequest("/api/admin/voter-codes/generate", "POST", body, pw);
            closeGenerateModal();
            await loadVoterConfig();
            renderCodes();
            toast(`${data.amount || amount} kode berhasil dibuat.`, "success");
        }
    } catch (e) { toast(e.message || "Gagal membuat kode.", "error"); }
}

async function deleteCode(id) {
    if (!isDraftCheck()) return;
    const ok = await appConfirm(
        "Kode ini akan dihapus permanen.",
        { title: "Hapus kode ini?", okLabel: "HAPUS", danger: true }
    );
    if (!ok) return;
    const pw = await ensurePassword();
    if (!pw) return;
    try {
        await adminRequest(`/api/admin/voter-codes/${id}`, "DELETE", undefined, pw);
        await loadVoterConfig();
        renderCodes();
        toast("Kode dihapus.", "success");
    } catch (e) { toast(e.message || "Gagal menghapus kode.", "error"); }
}

function openPrintModal() {
    const active = voterConfig.codes.filter(function (c) { return !c.used; });
    if (!active.length) { toast("Tidak ada kode aktif untuk dicetak.", "error"); return; }

    const modal = document.getElementById("printModal");
    if (modal) modal.classList.add("active");

    updatePrintEstimate();

    ["printCols","printHeight","printGap","printMargin","printFontSize"].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.addEventListener("input", updatePrintEstimate);
    });
}

function closePrintModal() {
    const modal = document.getElementById("printModal");
    if (modal) modal.classList.remove("active");
}

function updatePrintEstimate() {
    const el = document.getElementById("printEstimate");
    if (!el) return;

    const cols   = Math.max(1, Number(document.getElementById("printCols")?.value)   || 5);
    const height = Math.max(10, Number(document.getElementById("printHeight")?.value) || 28);
    const gap    = Math.max(0, Number(document.getElementById("printGap")?.value)     || 3);
    const margin = Math.max(3, Number(document.getElementById("printMargin")?.value)  || 6);

    const pageH     = 297 - margin * 2;
    const rowHeight = height + gap;
    const rows      = Math.floor((pageH + gap) / rowHeight);
    const perPage   = cols * rows;

    const active = voterConfig.codes.filter(function (c) { return !c.used; }).length;
    const pages  = perPage > 0 ? Math.ceil(active / perPage) : "-";

    el.textContent = `${active} kode aktif · ${perPage} kartu/halaman · estimasi ${pages} halaman`;
}

function printCodes() {
    const active = voterConfig.codes.filter(function (c) { return !c.used; });
    if (!active.length) { toast("Tidak ada kode aktif untuk dicetak.", "error"); return; }

    const cols      = Math.max(1,  Number(document.getElementById("printCols")?.value)     || 5);
    const height    = Math.max(10, Number(document.getElementById("printHeight")?.value)   || 28);
    const widthVal  = document.getElementById("printWidth")?.value  || "1fr";
    const radius    = Math.max(0,  Number(document.getElementById("printRadius")?.value)   || 2);
    const gap       = Math.max(0,  Number(document.getElementById("printGap")?.value)      || 3);
    const margin    = Math.max(3,  Number(document.getElementById("printMargin")?.value)   || 6);
    const fontSize  = Math.max(8,  Number(document.getElementById("printFontSize")?.value) || 17);
    const border    = document.getElementById("printBorder")?.value || "1px solid #333";

    const colTemplate = widthVal === "1fr" ? `repeat(${cols}, 1fr)` : `repeat(${cols}, ${widthVal})`;
    const labelSize   = Math.max(5, Math.round(fontSize * 0.38));
    const metaSize    = Math.max(5, Math.round(fontSize * 0.35));
    const letterSp    = Math.max(1, Math.round(fontSize * 0.18));

    /* P5: sort per Role → Kelas → Jurusan */
    const sorted = active.slice().sort(function (a, b) {
        const ra = (a.role || "").toUpperCase();
        const rb = (b.role || "").toUpperCase();
        if (ra !== rb) return ra < rb ? -1 : 1;
        const ca = (a.className || "").toUpperCase();
        const cb = (b.className || "").toUpperCase();
        if (ca !== cb) return ca < cb ? -1 : 1;
        const da = (a.department || "").toUpperCase();
        const db = (b.department || "").toUpperCase();
        return da < db ? -1 : da > db ? 1 : 0;
    });

    closePrintModal();

    const win = window.open("", "_blank", "width=1000,height=800");
    if (!win) { toast("Popup diblokir. Izinkan popup untuk mencetak.", "error"); return; }

    const cards = sorted.map(function (item) {
        const meta = [item.role, item.className, item.department].filter(Boolean).join(" · ");
        return `<div class="code-card">
            <div class="title">PEMILIHAN MPK 2026</div>
            <div class="code">${esc(item.code)}</div>
            <div class="label">KODE PEMILIH</div>
            ${meta ? `<div class="meta">${esc(meta)}</div>` : ""}
        </div>`;
    }).join("");

    win.document.write(`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8">
    <title>Kode Pemilih - Pemilihan MPK 2026</title>
    <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{padding:${margin}mm;font-family:Arial,sans-serif;background:var(--surface, #fff)}
        .grid{display:grid;grid-template-columns:${colTemplate};gap:${gap}mm}
        .code-card{
            height:${height}mm;
            border:${border};
            border-radius:${radius}mm;
            display:flex;flex-direction:column;
            align-items:center;justify-content:center;
            page-break-inside:avoid;break-inside:avoid;
            text-align:center;padding:2mm 3mm;
        }
        .title{font-size:${labelSize}px;font-weight:700;letter-spacing:1px;color:var(--muted,#888);margin-bottom:${Math.round(fontSize*0.25)}px;text-transform:uppercase}
        .code{font-size:${fontSize}px;font-weight:800;letter-spacing:${letterSp}px;line-height:1}
        .label{margin-top:${Math.round(fontSize*0.22)}px;font-size:${labelSize}px;letter-spacing:1.5px;color:var(--muted,#888);text-transform:uppercase}
        .meta{margin-top:3px;font-size:${metaSize}px;letter-spacing:0.3px;color:var(--muted,#555)}
        @media print{body{padding:${margin}mm}@page{size:A4 portrait;margin:${margin}mm}}
    </style></head><body>
    <div class="grid">${cards}</div>
    <script>window.onload=function(){window.print();}<\/script>
    </body></html>`);
    win.document.close();
}

async function togglePublish() {
    const endpoint = publishedState ? "/api/election/unpublish" : "/api/election/publish";
    const title    = publishedState ? "Sembunyikan Hasil?" : "Publikasikan Hasil Suara?";
    const msg      = publishedState
        ? "Hasil suara akan disembunyikan dari halaman publik."
        : "Hasil suara akan dapat dilihat semua orang melalui halaman Hasil Suara publik.";
    const label    = publishedState ? "SEMBUNYIKAN" : "PUBLIKASIKAN";

    const ok = await appConfirm(msg, { title, okLabel: label, danger: publishedState, icon: publishedState ? "👁" : "📢" });
    if (!ok) return;

    const pw = await ensurePassword();
    if (!pw) return;

    try {
        const data = await adminRequest(endpoint, "POST", {}, pw);
        publishedState = data.published === true;
        updateStatus();
        toast(data.message, "success");
    } catch (e) { toast(e.message || "Gagal mengubah status publikasi.", "error"); }
}

function previewHeroImage(event) {
    const file = event.target.files && event.target.files[0];
    const preview = document.getElementById("heroPreview");
    if (!preview) return;
    if (!file) return;
    const fr = new FileReader();
    fr.onload = function (e) {
        preview.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
    };
    fr.readAsDataURL(file);
}

async function uploadHeroImage() {
    const input = document.getElementById("heroImageInput");
    if (!input || !input.files || !input.files.length) {
        toast("Pilih gambar terlebih dahulu.", "error");
        return;
    }

    const pw = await ensurePassword();
    if (!pw) return;

    const fd = new FormData();
    fd.append("image", input.files[0]);

    try {
        const r = await fetch("/api/admin/hero-image", {
            method: "POST",
            headers: { "x-admin-password": pw },
            body: fd
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.message || "Gagal mengunggah wallpaper.");

        const preview = document.getElementById("heroPreview");
        if (preview) preview.innerHTML = `<img src="${esc(d.heroImage)}" alt="Hero wallpaper">`;

        const deleteBtn = document.getElementById("deleteHeroButton");
        if (deleteBtn) deleteBtn.style.display = "";

        input.value = "";
        toast("Wallpaper berhasil disimpan.", "success");
    } catch (e) { toast(e.message || "Gagal mengunggah wallpaper.", "error"); }
}

async function deleteHeroImage() {
    const ok = await appConfirm(
        "Wallpaper hero akan dihapus dan diganti kembali ke tampilan default.",
        { title: "Hapus Wallpaper?", okLabel: "HAPUS", danger: true }
    );
    if (!ok) return;

    const pw = await ensurePassword();
    if (!pw) return;

    try {
        const data = await adminRequest("/api/admin/hero-image", "DELETE", undefined, pw);
        const preview = document.getElementById("heroPreview");
        if (preview) preview.innerHTML = '<span class="hero-preview-placeholder">Belum ada wallpaper</span>';
        const deleteBtn = document.getElementById("deleteHeroButton");
        if (deleteBtn) deleteBtn.style.display = "none";
        const input = document.getElementById("heroImageInput");
        if (input) input.value = "";
        toast(data.message || "Wallpaper dihapus.", "success");
    } catch (e) { toast(e.message || "Gagal menghapus wallpaper.", "error"); }
}

function esc(v) {
    const d = document.createElement("div");
    d.textContent = v ?? "";
    return d.innerHTML;
}
