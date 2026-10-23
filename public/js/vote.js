let verifiedVoter    = null;
let selectedCandidate = null;
let selectedRoleId    = null;
let candidates        = [];
let allRoles          = [];

document.addEventListener("DOMContentLoaded", async function () {
    const open = await checkElection();
    if (!open) return;
    await loadCandidates();
    await loadRoles();
    setupEvents();
});

async function checkElection() {
    try {
        const r = await fetch("/api/election", { cache: "no-store" });
        const d = await r.json();
        if (!d.success || d.status !== "OPEN") {
            window.location.href = "/";
            return false;
        }
        return true;
    } catch (e) {
        console.error(e);
        window.location.href = "/";
        return false;
    }
}

async function loadCandidates() {
    try {
        const r = await fetch("/api/candidates", { cache: "no-store" });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);
        candidates = d.candidates || [];
        renderVoteCandidates();
    } catch (e) {
        console.error(e);
        const c = document.getElementById("voteCandidateList");
        if (c) c.innerHTML = `<div style="color:var(--red-600,#D62839);padding:20px">Gagal memuat data Paslon.</div>`;
    }
}

async function loadRoles() {
    try {
        const r = await fetch("/api/voter-config", { cache: "no-store" });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);
        allRoles = (d.roles || []).filter(function (ro) { return ro.active; });
    } catch (e) {
        console.error(e);
        allRoles = [];
    }
}

function setupEvents() {
    const codeInput = document.getElementById("codeInput");
    if (codeInput) {
        codeInput.addEventListener("input", function () {
            this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
            clearError("codeError");
        });
        codeInput.addEventListener("keydown", function (e) {
            if (e.key === "Enter") { e.preventDefault(); verifyCode(); }
        });
        codeInput.focus();
    }

    const verifyBtn = document.getElementById("verifyButton");
    if (verifyBtn) verifyBtn.addEventListener("click", verifyCode);

    const confirmRoleBtn = document.getElementById("confirmRoleButton");
    if (confirmRoleBtn) confirmRoleBtn.addEventListener("click", confirmRole);

    const backFromRoleBtn = document.getElementById("backFromRoleButton");
    if (backFromRoleBtn) backFromRoleBtn.addEventListener("click", backToCode);

    /* submitVoteButton di-bind langsung di buildSubmitCard() setelah di-render */

    const doneBtn = document.getElementById("doneVoteButton");
    if (doneBtn) doneBtn.addEventListener("click", resetVotePage);
}

async function verifyCode() {
    clearError("codeError");

    const codeInput = document.getElementById("codeInput");
    const code = codeInput ? codeInput.value.trim().toUpperCase() : "";

    if (!/^[A-Z0-9]{5}$/.test(code)) {
        showError("codeError", "Masukkan kode pemilih 5 karakter.");
        if (codeInput) codeInput.focus();
        return;
    }

    const btn = document.getElementById("verifyButton");
    if (btn) { btn.disabled = true; btn.textContent = "MEMVERIFIKASI..."; }

    try {
        const r = await fetch("/api/vote/verify-code", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code })
        });

        if (!r.headers.get("content-type")?.includes("application/json"))
            throw new Error("Server tidak mengembalikan JSON. Buka via http://localhost:3000.");

        const d = await r.json();
        if (!d.success) throw new Error(d.message || "Kode pemilih tidak valid.");

        verifiedVoter = d.voter;
        if (!verifiedVoter || !verifiedVoter.voteToken) throw new Error("Data sesi tidak valid.");

        /* Jika kode sudah punya role → langsung ke pilih paslon */
        if (verifiedVoter.roleId) {
            selectedRoleId = verifiedVoter.roleId;
            showCandidateStep();
        } else {
            /* Kode universal → pemilih pilih rolenya sendiri */
            showRoleStep();
        }
    } catch (e) {
        console.error(e);
        verifiedVoter = null;
        showError("codeError", e.message || "Gagal memverifikasi kode.");
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "VERIFIKASI KODE"; }
    }
}

/* ── STEP: PILIH ROLE ── */
function showRoleStep() {
    const voter = verifiedVoter;

    const infoCode = document.getElementById("roleStepCode");
    if (infoCode) infoCode.textContent = voter.code || "-";

    /* Populate tombol role */
    const roleOptions = document.getElementById("roleOptions");
    if (roleOptions) {
        roleOptions.innerHTML = "";
        allRoles.forEach(function (ro) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "role-option-btn";
            btn.dataset.roleId = ro.id;
            btn.setAttribute("aria-label", "Pilih sebagai " + ro.name);
            btn.textContent = ro.name;
            btn.addEventListener("click", function () {
                document.querySelectorAll(".role-option-btn").forEach(function (b) {
                    b.classList.remove("selected");
                    b.setAttribute("aria-pressed", "false");
                });
                btn.classList.add("selected");
                btn.setAttribute("aria-pressed", "true");
                selectedRoleId = Number(ro.id);
                clearError("roleError");
            });
            roleOptions.appendChild(btn);
        });
    }

    selectedRoleId = null;
    document.getElementById("codeStep").classList.add("hidden");
    document.getElementById("roleStep").classList.remove("hidden");
    clearError("roleError");
}

function confirmRole() {
    clearError("roleError");

    if (!selectedRoleId) {
        showError("roleError", "Pilih jenis pemilih terlebih dahulu.");
        return;
    }
    if (!verifiedVoter) {
        showError("roleError", "Sesi habis. Masukkan kode kembali.");
        backToCode();
        return;
    }
    showCandidateStep();
}

function backToCode() {
    verifiedVoter    = null;
    selectedCandidate = null;
    selectedRoleId   = null;

    ["roleStep", "deptStep"].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.classList.add("hidden");
    });
    document.getElementById("codeStep").classList.remove("hidden");
    clearError("codeError");
    clearError("roleError");

    const ci = document.getElementById("codeInput");
    if (ci) { ci.value = ""; ci.focus(); }
}

function showCandidateStep() {
    document.getElementById("codeStep").classList.add("hidden");
    const roleStep = document.getElementById("roleStep");
    if (roleStep) roleStep.classList.add("hidden");
    const deptStep = document.getElementById("deptStep");
    if (deptStep) deptStep.classList.add("hidden");

    document.getElementById("candidateStep").classList.remove("hidden");
    document.getElementById("candidateStep").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderVoteCandidates() {
    const container = document.getElementById("voteCandidateList");
    if (!container) return;
    container.innerHTML = "";

    if (!candidates.length) {
        container.innerHTML = `<div style="color:var(--muted,#6B6F76);padding:20px;text-align:center">Belum ada Paslon yang ditetapkan.</div>`;
        return;
    }

    candidates.forEach(function (cd) {
        const card = document.createElement("article");
        card.className = "vote-candidate";
        card.dataset.id = cd.id;
        card.setAttribute("role", "button");
        card.setAttribute("tabindex", "0");
        card.setAttribute("aria-label", `Pilih Paslon ${String(cd.number).padStart(2,"0")}: ${cd.name}`);

        let photoHTML = '<div class="vote-candidate-placeholder">FOTO PASLON</div>';
        if (cd.photo) {
            photoHTML = `<img src="${esc(cd.photo)}" alt="Foto ${esc(cd.name)}" loading="lazy">`;
        }

        card.innerHTML = `
            ${photoHTML}
            <div class="vote-candidate-info">
                <div class="vote-candidate-number">PASLON ${String(cd.number).padStart(2,"0")}</div>
                <h3>${esc(cd.name)}</h3>
                <p>Ketua: <strong>${esc(cd.chairman || "-")}</strong></p>
                <p>Wakil: <strong>${esc(cd.vice || "-")}</strong></p>
            </div>`;

        card.addEventListener("click", function () { selectCandidate(cd); });
        card.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectCandidate(cd); }
        });
        container.appendChild(card);
    });

    /* Tambahkan submit card di akhir grid */
    buildSubmitCard(container);
}

function buildSubmitCard(container) {
    /* Hapus submit card lama kalau ada */
    const old = document.getElementById("voteSubmitCard");
    if (old) old.remove();

    const card = document.createElement("div");
    card.id = "voteSubmitCard";
    card.className = "vote-submit-card";
    card.setAttribute("aria-live", "polite");

    card.innerHTML = `
        <div class="vote-submit-card-label" id="submitCardLabel">Pilih paslon dulu</div>
        <div class="vote-submit-card-choice" id="submitCardChoice">—</div>
        <button id="submitVoteButton"
            disabled
            aria-label="Kirim suara">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2.5"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
            KIRIM SUARA
        </button>
        <div class="error-message" id="voteError" style="font-size:11px;text-align:center"></div>`;

    container.appendChild(card);

    /* Sambungkan event listener ke tombol baru */
    const btn = card.querySelector("#submitVoteButton");
    if (btn) btn.addEventListener("click", submitVote);
}

function selectCandidate(cd) {
    selectedCandidate = cd;

    document.querySelectorAll(".vote-candidate").forEach(function (c) {
        const sel = Number(c.dataset.id) === Number(cd.id);
        c.classList.toggle("selected", sel);
        c.setAttribute("aria-pressed", String(sel));
    });

    /* Update submit card */
    const submitCard  = document.getElementById("voteSubmitCard");
    const cardLabel   = document.getElementById("submitCardLabel");
    const cardChoice  = document.getElementById("submitCardChoice");
    const submitBtn   = document.getElementById("submitVoteButton");

    if (cardLabel)  cardLabel.textContent  = "Pilihan Anda";
    if (cardChoice) cardChoice.textContent = `Paslon ${String(cd.number).padStart(2,"0")}\n${cd.name}`;
    if (submitCard) submitCard.classList.add("ready");
    if (submitBtn)  {
        submitBtn.disabled = false;
        submitBtn.classList.add("pulse");
    }

    /* Tetap update hidden confirm (kompabilitas) */
    const confirmEl = document.getElementById("voteConfirm");
    if (confirmEl) confirmEl.classList.remove("hidden");
    const txt = document.getElementById("selectedCandidateText");
    if (txt) txt.textContent = `Paslon ${String(cd.number).padStart(2,"0")} — ${cd.name}`;

    clearError("voteError");
}

async function submitVote() {
    clearError("voteError");

    if (!verifiedVoter) { showError("voteError", "Sesi pemilih tidak valid. Silakan mulai ulang."); return; }
    if (!selectedCandidate) { showError("voteError", "Pilih Paslon terlebih dahulu."); return; }
    if (!selectedRoleId) { showError("voteError", "Jenis pemilih belum dipilih."); return; }

    const ok = await appConfirm(
        `Anda memilih Paslon ${String(selectedCandidate.number).padStart(2,"00")} — ${selectedCandidate.name}.\n\nPilihan tidak dapat diubah setelah dikirim.`,
        { title: "Konfirmasi Pilihan", okLabel: "KIRIM SUARA", danger: true, icon: "✓" }
    );
    if (!ok) return;

    const btn = document.getElementById("submitVoteButton");
    if (btn) { btn.disabled = true; btn.innerHTML = '<span style="opacity:0.7">MENGIRIM...</span>'; }

    try {
        const r = await fetch("/api/vote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                voteToken:   verifiedVoter.voteToken,   // token acak, bukan id internal
                candidateId: selectedCandidate.id,
                roleId:      selectedRoleId
            })
        });

        if (!r.headers.get("content-type")?.includes("application/json"))
            throw new Error("Server tidak mengembalikan JSON.");

        const d = await r.json();
        if (!d.success) throw new Error(d.message || "Gagal mengirim suara.");

        /* Tampilkan animasi pesawat, lalu showSuccess */
        playPlaneLaunch(selectedCandidate);
    } catch (e) {
        console.error(e);
        showError("voteError", e.message || "Gagal mengirim suara.");
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2.5"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg> KIRIM SUARA`;
        }
    }
}

/* ── ANIMASI KONFETI BURST ── */
function playPlaneLaunch(candidate) {
    const overlay = document.getElementById("planeOverlay");
    const titleEl = document.getElementById("planeOverlayText");
    const subEl   = document.getElementById("burstSub");

    if (!overlay) { showSuccess(candidate); return; }

    /* Update teks */
    if (titleEl) titleEl.textContent = `Suara untuk Paslon ${String(candidate.number).padStart(2,"0")} berhasil dikirim! ✓`;
    if (subEl) subEl.textContent = `${candidate.name} — Terima kasih telah berpartisipasi.`;

    /* Reset & tampilkan overlay */
    overlay.classList.add("active");

    /* Tembak konfeti */
    spawnConfetti();

    /* Tutup setelah 1.6 detik → lanjut halaman sukses */
    setTimeout(function () {
        overlay.classList.remove("active");
        setTimeout(function () { showSuccess(candidate); }, 200);
    }, 1600);
}

const CONFETTI_COLORS = [
    "#E8B923","#12377A","#1F7A3D","#D62839",
    "#2E56A6","#f5ce56","#6dd6a0","#ff7a85",
    "#fff","#a0c4ff","#ffd6a5"
];

function spawnConfetti() {
    const count = 70;
    const cx = window.innerWidth  / 2;
    const cy = window.innerHeight / 2;

    for (let i = 0; i < count; i++) {
        const el = document.createElement("div");
        el.className = "confetti-piece";

        /* Random arah & jarak */
        const angle  = (Math.random() * 360) * (Math.PI / 180);
        const dist   = 120 + Math.random() * 260;
        const tx     = Math.cos(angle) * dist;
        const ty     = Math.sin(angle) * dist - 60; /* sedikit ke atas */
        const rot    = (Math.random() * 720 - 360) + "deg";
        const size   = 7 + Math.random() * 10;
        const dur    = 0.7 + Math.random() * 0.5;
        const delay  = Math.random() * 0.15;
        const color  = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
        const isCircle = Math.random() > 0.5;

        Object.assign(el.style, {
            left:   cx + "px",
            top:    cy + "px",
            width:  size + "px",
            height: isCircle ? size + "px" : (size * 0.5) + "px",
            borderRadius: isCircle ? "50%" : "2px",
            background: color,
            "--tx": tx + "px",
            "--ty": ty + "px",
            "--rot": rot,
            animation: `confettiFly ${dur}s cubic-bezier(0.25,0.46,0.45,0.94) ${delay}s forwards`
        });

        document.body.appendChild(el);
        setTimeout(function () { el.remove(); }, (dur + delay) * 1000 + 100);
    }
}

function showSuccess(candidate) {
    ["codeStep","roleStep","deptStep","candidateStep"].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.classList.add("hidden");
    });

    const summaryEl = document.getElementById("successCandidateSummary");
    if (summaryEl && candidate) {
        summaryEl.textContent = `Paslon ${String(candidate.number).padStart(2,"0")} — ${candidate.name}`;
    }

    const s = document.getElementById("successStep");
    if (s) s.classList.remove("hidden");

    window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetVotePage() {
    verifiedVoter     = null;
    selectedCandidate = null;
    selectedRoleId    = null;

    const codeInput = document.getElementById("codeInput");
    if (codeInput) codeInput.value = "";

    const confirmEl = document.getElementById("voteConfirm");
    if (confirmEl) confirmEl.classList.add("hidden");

    const txt = document.getElementById("selectedCandidateText");
    if (txt) txt.textContent = "-";

    /* Reset submit card */
    const submitCard = document.getElementById("voteSubmitCard");
    const cardLabel  = document.getElementById("submitCardLabel");
    const cardChoice = document.getElementById("submitCardChoice");
    const submitBtn  = document.getElementById("submitVoteButton");

    if (submitCard) submitCard.classList.remove("ready");
    if (cardLabel)  cardLabel.textContent  = "Pilih paslon dulu";
    if (cardChoice) cardChoice.textContent = "—";
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.remove("pulse");
        submitBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2.5"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg> KIRIM SUARA`;
    }

    document.querySelectorAll(".vote-candidate").forEach(function (c) {
        c.classList.remove("selected");
        c.removeAttribute("aria-pressed");
    });

    document.querySelectorAll(".role-option-btn").forEach(function (b) {
        b.classList.remove("selected");
        b.setAttribute("aria-pressed", "false");
    });

    clearError("codeError");
    clearError("roleError");
    clearError("voteError");

    ["roleStep","deptStep","candidateStep","successStep"].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.classList.add("hidden");
    });

    const codeStep = document.getElementById("codeStep");
    if (codeStep) codeStep.classList.remove("hidden");

    window.scrollTo({ top: 0, behavior: "smooth" });

    setTimeout(function () {
        const ci = document.getElementById("codeInput");
        if (ci) ci.focus();
    }, 400);
}

function showError(id, msg) {
    const el = document.getElementById(id);
    if (el) el.textContent = msg || "";
}

function clearError(id) {
    const el = document.getElementById(id);
    if (el) el.textContent = "";
}

function esc(v) {
    const d = document.createElement("div");
    d.textContent = v ?? "";
    return d.innerHTML;
}
