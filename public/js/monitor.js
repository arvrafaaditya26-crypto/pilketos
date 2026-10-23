"use strict";

let adminPassword = "";
let refreshTimer = null;

const byId = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", "\"":"&quot;" }[ch]));

document.addEventListener("DOMContentLoaded", () => {
    byId("loginForm").addEventListener("submit", unlockMonitor);
    byId("refreshButton").addEventListener("click", () => loadResults(true));
    byId("lockButton").addEventListener("click", lockMonitor);
    byId("togglePassword").addEventListener("click", () => {
        const input = byId("password");
        input.type = input.type === "password" ? "text" : "password";
        input.focus();
    });
    byId("password").focus();
});

async function unlockMonitor(event) {
    event.preventDefault();
    const password = byId("password").value.trim();
    const error = byId("loginError");
    const button = document.querySelector(".unlock-button");
    error.textContent = "";
    if (!password) { error.textContent = "Masukkan password administrator terlebih dahulu."; return; }
    button.disabled = true;
    button.textContent = "MEMERIKSA…";
    try {
        const response = await fetch("/api/monitor/verify", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ password }) });
        const data = await response.json();
        if (!data.success) throw new Error(data.message || "Password tidak tepat.");
        adminPassword = password;
        byId("loginView").hidden = true;
        byId("monitorView").hidden = false;
        await loadResults();
        refreshTimer = window.setInterval(() => loadResults(), 5000);
    } catch (err) {
        error.textContent = err.message || "Tidak dapat membuka monitor.";
        button.disabled = false;
        button.innerHTML = "BUKA MONITOR <span>→</span>";
    }
}

function lockMonitor() {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
    adminPassword = "";
    byId("password").value = "";
    byId("monitorView").hidden = true;
    byId("loginView").hidden = false;
    byId("password").focus();
}

async function loadResults(showError = false) {
    try {
        const response = await fetch("/api/monitor/results", { cache:"no-store", headers:{"x-admin-password":adminPassword} });
        if (response.status === 401) { lockMonitor(); return; }
        const data = await response.json();
        if (!data.success) throw new Error(data.message || "Data tidak dapat dimuat.");
        render(data);
    } catch (err) {
        if (showError) alert(err.message || "Gagal memuat data.");
    }
}

function render(data) {
    const total = Number(data.totalVotes || 0);
    byId("totalVotes").textContent = total.toLocaleString("id-ID");
    byId("candidateCount").textContent = `${(data.candidates || []).length} PASLON`;
    byId("lastUpdated").textContent = `Diperbarui ${new Date().toLocaleTimeString("id-ID", {hour:"2-digit",minute:"2-digit",second:"2-digit"})} · otomatis tiap 5 dtk`;
    byId("candidateRows").innerHTML = (data.candidates || []).map((candidate, index) => {
        const votes = Number(candidate.total || 0);
        const percent = total ? (votes / total) * 100 : 0;
        const hue = 215 + (index * 37) % 80;
        return `<article class="candidate-row"><div class="candidate-header"><div class="candidate-name"><span class="candidate-number">${String(candidate.number || index + 1).padStart(2,"0")}</span>${esc(`Pasangan ${String(candidate.number || index + 1).padStart(2,"0")}`)}</div><div class="candidate-meta"><span>${percent.toFixed(1)}%</span><strong>${votes.toLocaleString("id-ID")}</strong></div></div><div class="bar"><i style="width:${percent}%;background:linear-gradient(90deg,hsl(${hue},78%,63%),hsl(${hue + 18},90%,76%))"></i></div></article>`;
    }).join("") || '<p class="empty">Belum ada pasangan calon.</p>';
    byId("roleRows").innerHTML = (data.roles || []).map(role => `<div class="role-row"><span>${esc(role.role || role.name || "-")}</span><strong>${Number(role.total || 0).toLocaleString("id-ID")} suara</strong></div>`).join("") || '<p class="empty">Belum ada data.</p>';
    byId("classRows").innerHTML = (data.classes || []).map(row => `<div class="class-row"><span>${esc(row.name || "Tanpa kelas")}</span><strong>${Number(row.total || 0).toLocaleString("id-ID")}</strong></div>`).join("") || '<p class="empty">Belum ada data kelas.</p>';
}


