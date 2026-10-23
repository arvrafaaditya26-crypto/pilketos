let resultsPassword = null;
let lastData        = null;
let chartMode       = "bar";
let isAdminMode     = false;

const DEFAULT_COLORS = [
    "#12377A", "#E8B923", "#1F7A3D", "#D62839",
    "#2E56A6", "#a07000", "#145c2e", "#9b1c28"
];
let candidateColors = DEFAULT_COLORS.slice();

document.addEventListener("DOMContentLoaded", async function () {
    /* Cek dulu apakah hasil sudah dipublikasikan — jika iya, langsung tampil */
    try {
        const r = await fetch("/api/results", { cache: "no-store" });
        if (r.ok) {
            const d = await r.json();
            if (d.success) {
                isAdminMode = false;
                document.getElementById("loginView").style.display = "none";
                document.getElementById("resultsView").style.display = "block";
                lastData = d;
                renderResults(d);
                return;
            }
        }
    } catch (e) { /* belum published */ }

    /* Belum published — tampilkan form login */
    const loginDesc = document.getElementById("loginDesc");
    if (loginDesc) loginDesc.textContent = "Hasil suara belum dipublikasikan. Masukkan password administrator untuk melihat.";
    const inp = document.getElementById("loginPassword");
    if (inp) inp.focus();
});

async function submitLogin() {
    const inp   = document.getElementById("loginPassword");
    const errEl = document.getElementById("loginError");
    const pw    = inp ? inp.value.trim() : "";

    if (errEl) errEl.textContent = "";
    if (!pw) { if (errEl) errEl.textContent = "Masukkan password."; return; }

    const btn = document.querySelector("#loginView .primary-button");
    if (btn) { btn.disabled = true; btn.textContent = "MEMERIKSA..."; }

    try {
        const r = await fetch("/api/admin/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: pw })
        });
        const d = await r.json();
        if (!d.success) throw new Error("Password salah.");
        resultsPassword = pw;
        document.getElementById("loginView").style.display = "none";
        document.getElementById("resultsView").style.display = "block";
        await loadResults();
    } catch (e) {
        if (errEl) errEl.textContent = e.message || "Password salah.";
        if (btn) { btn.disabled = false; btn.textContent = "LIHAT HASIL"; }
    }
}

async function refreshResults() {
    const btn = document.querySelector(".refresh-btn");
    if (btn) { btn.disabled = true; btn.querySelector("svg").style.animation = "spin 0.8s linear infinite"; }
    await loadResults();
    if (btn) { btn.disabled = false; btn.querySelector("svg").style.animation = ""; }
}

async function loadResults() {
    try {
        /* Coba publik dulu */
        const pubR = await fetch("/api/results", { cache: "no-store" });
        if (pubR.ok) {
            const pubD = await pubR.json();
            if (pubD.success) {
                lastData = pubD;
                renderResults(pubD);
                return;
            }
        }

        /* Fallback ke admin endpoint jika punya password */
        if (!resultsPassword) return;
        const r = await fetch("/api/admin/results", {
            cache: "no-store",
            headers: { "x-admin-password": resultsPassword }
        });
        if (!r.headers.get("content-type")?.includes("application/json"))
            throw new Error("Server tidak mengembalikan JSON.");
        const d = await r.json();
        if (!d.success) throw new Error(d.message || "Gagal memuat hasil.");
        lastData = d;
        renderResults(d);
    } catch (e) {
        console.error(e);
        toast(e.message || "Gagal memuat hasil suara.", "error");
    }
}

function toggleChart() {
    chartMode = chartMode === "bar" ? "pie" : "bar";
    const btn = document.getElementById("toggleChartBtn");
    if (btn) btn.textContent = chartMode === "bar" ? "Lihat Diagram Lingkaran" : "Lihat Diagram Batang";
    if (lastData) renderCandidateChart(lastData.candidates || [], lastData.totalVotes || 0);
}

function renderResults(data) {
    const total          = data.totalVotes    || 0;
    const candidates     = data.candidates    || [];
    const roles          = data.roles         || [];
    const nonStudents    = data.nonStudents   || [];
    const studentClasses = data.studentClasses || [];

    setText("sumTotal",        total.toLocaleString("id"));
    setText("sumCandidates",   candidates.length);
    setText("sumRoles",        roles.filter(function (r) { return r.total > 0; }).length);
    setText("sumParticipation", total > 0 ? total.toLocaleString("id") + " suara" : "0 suara");
    setText("candidateTotalBadge", total + " total suara");

    while (candidateColors.length < candidates.length) {
        candidateColors.push(DEFAULT_COLORS[candidateColors.length % DEFAULT_COLORS.length]);
    }

    renderColorPanel(candidates);
    renderCandidateChart(candidates, total);

    renderTable("roleTableBody", roles, total, function (r) {
        return `<td>${esc(r.role || r.name || "-")}</td>`;
    }, 4);

    /* Tabel kelompok: Guru, Staff di atas → lalu Siswa Kelas 10/11/12 */
    renderGroupTable(nonStudents, studentClasses, total);

    const now = new Date();
    const fmt = now.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })
              + " " + now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setText("lastUpdatedText", "Terakhir diperbarui: " + fmt);
}

/* ── Tabel per kelompok: Guru, Staff, lalu Siswa Kelas 10/11/12 ── */
function renderGroupTable(nonStudents, studentClasses, total) {
    const tb = document.getElementById("classTableBody");
    if (!tb) return;

    /* Gabungkan: nonStudents + tiap kelas siswa */
    const rows = [];
    nonStudents.forEach(function (r) {
        rows.push({ label: r.role || r.displayName || "-", sub: null, total: r.total });
    });
    studentClasses.forEach(function (cl) {
        const name = cl.name || cl.displayName || "-";
        /* id=0 artinya fallback "Tanpa Kelas" dari kode lama */
        const label = (cl.id === 0 || cl.name === "Tanpa Kelas")
            ? "Siswa (Kode Lama)"
            : "Siswa — " + name;
        rows.push({ label: label, sub: name, total: cl.total });
    });

    if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="4" class="no-data">Tidak ada data.</td></tr>';
        return;
    }

    const maxVal = rows.reduce(function (m, r) { return Math.max(m, r.total); }, 0);
    tb.innerHTML = "";

    rows.forEach(function (row) {
        const pct  = total > 0 ? ((row.total / total) * 100).toFixed(1) : "0.0";
        const barW = maxVal > 0 ? ((row.total / maxVal) * 100).toFixed(1) : 0;
        const tr   = document.createElement("tr");
        tr.innerHTML = `
            <td><strong style="color:var(--navy-900)">${esc(row.label)}</strong></td>
            <td class="mini-bar-cell">
                <div class="mini-bar"><div class="mini-bar-fill" style="width:${barW}%"></div></div>
            </td>
            <td class="td-num">${row.total.toLocaleString("id")}</td>
            <td class="td-pct">${pct}%</td>`;
        tb.appendChild(tr);
    });
}

/* ── COLOR PANEL ── */
function renderColorPanel(candidates) {
    const panel = document.getElementById("colorPanel");
    if (!panel) return;
    panel.innerHTML = "";

    if (!candidates.length) { panel.style.display = "none"; return; }
    panel.style.display = "flex";

    candidates.forEach(function (cd, idx) {
        const color = candidateColors[idx] || DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
        const item  = document.createElement("div");
        item.className = "color-panel-item";
        item.innerHTML = `
            <input type="color" value="${color}" id="colorPicker_${idx}"
                aria-label="Warna Paslon ${String(cd.number).padStart(2,'0')}">
            <label for="colorPicker_${idx}">Paslon ${String(cd.number).padStart(2,"0")}</label>`;

        /* Pakai addEventListener bukan onchange inline agar tidak ada masalah scope */
        const inp = item.querySelector("input[type=color]");
        inp.addEventListener("input", function () {
            candidateColors[idx] = this.value;
            if (lastData) renderCandidateChart(lastData.candidates || [], lastData.totalVotes || 0);
        });
        panel.appendChild(item);
    });

    const resetBtn = document.createElement("button");
    resetBtn.className = "color-reset-btn";
    resetBtn.textContent = "Reset Warna";
    resetBtn.addEventListener("click", function () {
        candidateColors = DEFAULT_COLORS.slice();
        /* Update semua picker ke nilai default */
        candidates.forEach(function (_, idx) {
            const pk = document.getElementById("colorPicker_" + idx);
            if (pk) pk.value = candidateColors[idx] || DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
        });
        if (lastData) renderCandidateChart(lastData.candidates || [], lastData.totalVotes || 0);
    });
    panel.appendChild(resetBtn);
}

/* ── CHART ROUTER ── */
function renderCandidateChart(candidates, total) {
    if (chartMode === "pie") {
        renderCandidatePie(candidates, total);
    } else {
        renderCandidateColumns(candidates, total);
    }
}

/* ── VERTICAL COLUMN CHART (tabung terisi air) ── */
function renderCandidateColumns(candidates, total) {
    const c = document.getElementById("candidateBars");
    if (!c) return;

    if (!candidates.length) {
        c.innerHTML = '<div class="no-data">Belum ada data paslon.</div>';
        return;
    }

    const maxVotes = candidates.reduce(function (m, x) { return Math.max(m, x.total); }, 0);
    const hasTie   = maxVotes > 0 && candidates.filter(function (x) { return x.total === maxVotes; }).length > 1;

    c.innerHTML = "";

    const wrap = document.createElement("div");
    wrap.className = "col-chart-wrap";

    candidates.forEach(function (cd, idx) {
        const pct      = total > 0 ? (cd.total / total * 100).toFixed(1) : "0.0";
        const fillPct  = maxVotes > 0 ? (cd.total / maxVotes * 100) : 0;
        const isWinner = cd.total === maxVotes && maxVotes > 0 && !hasTie;
        const color    = candidateColors[idx] || DEFAULT_COLORS[idx % DEFAULT_COLORS.length];

        const col = document.createElement("div");
        col.className = "col-chart-col";

        col.innerHTML = `
            <div class="col-chart-count">${cd.total.toLocaleString("id")}</div>
            <div class="col-chart-pct">${pct}%</div>
            <div class="col-chart-tube">
                <div class="col-chart-fill" data-target="${fillPct}"
                     style="height:0%;background:${color}">
                </div>
            </div>
            <div class="col-chart-label">
                <span class="col-chart-num">PASLON ${String(cd.number).padStart(2,"0")}</span>
                <span class="col-chart-name">${esc(cd.name || "-")}${isWinner ? ' <span class="winner-crown">&#9733;</span>' : ""}</span>
            </div>`;

        wrap.appendChild(col);
    });

    c.appendChild(wrap);

    /* Animasi fill setelah render */
    requestAnimationFrame(function () {
        requestAnimationFrame(function () {
            wrap.querySelectorAll(".col-chart-fill").forEach(function (el, i) {
                const target = parseFloat(el.dataset.target) || 0;
                setTimeout(function () {
                    el.style.transition = "height 0.8s cubic-bezier(0.4,0,0.2,1)";
                    el.style.height = target + "%";
                }, i * 100 + 50);
            });
        });
    });
}

/* ── PIE CHART ── */
function renderCandidatePie(candidates, total) {
    const c = document.getElementById("candidateBars");
    if (!c) return;

    if (!candidates.length) {
        c.innerHTML = '<div class="no-data">Belum ada data paslon.</div>';
        return;
    }

    const maxVotes = candidates.reduce(function (m, x) { return Math.max(m, x.total); }, 0);
    const hasTie   = candidates.filter(function (x) { return x.total === maxVotes && maxVotes > 0; }).length > 1;
    const SIZE = 240, R = 100, CX = SIZE / 2, CY = SIZE / 2;

    function polarToXY(angle, r) {
        const rad = (angle - 90) * Math.PI / 180;
        return { x: +(CX + r * Math.cos(rad)).toFixed(3), y: +(CY + r * Math.sin(rad)).toFixed(3) };
    }

    let pathsHTML = "";

    if (total === 0) {
        /* Semua 0 — tampilkan lingkaran abu kosong */
        pathsHTML = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="#eaecef"/>
                     <text x="${CX}" y="${CY + 6}" text-anchor="middle" font-size="13" fill="#6B6F76" font-family="Inter,sans-serif">Belum ada suara</text>`;
    } else {
        let startAngle = 0;
        const sliceData = candidates.map(function (cd, idx) {
            const pct      = total > 0 ? cd.total / total : 0;
            const angle    = pct * 360;
            const endAngle = startAngle + angle;
            const isWinner = cd.total === maxVotes && maxVotes > 0 && !hasTie;
            const color    = candidateColors[idx] || DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
            const sl = { cd, pct, angle, startAngle, endAngle, color, isWinner };
            startAngle = endAngle;
            return sl;
        });

        sliceData.forEach(function (s, i) {
            if (s.angle < 0.5) return; /* slice terlalu kecil, skip */
            let dPath;
            if (s.angle >= 359.9) {
                /* Full circle — pakai <circle> bukan arc */
                dPath = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="${s.color}" opacity="0">
                    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="${i * 0.1}s" fill="freeze"/>
                </circle>`;
            } else {
                const large = s.pct > 0.5 ? 1 : 0;
                const p1 = polarToXY(s.startAngle, R);
                const p2 = polarToXY(s.endAngle, R);
                dPath = `<path d="M ${CX} ${CY} L ${p1.x} ${p1.y} A ${R} ${R} 0 ${large} 1 ${p2.x} ${p2.y} Z"
                    fill="${s.color}" stroke="#fff" stroke-width="2" opacity="0">
                    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="${i * 0.1}s" fill="freeze"/>
                </path>`;
            }
            pathsHTML += dPath;
        });
    }

    const legend = candidates.map(function (cd, idx) {
        const pctNum = total > 0 ? (cd.total / total * 100) : 0;
        const pctStr = pctNum.toFixed(1);
        const isWinner = cd.total === maxVotes && maxVotes > 0 && !hasTie;
        const color    = candidateColors[idx] || DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
        return `<div class="pie-legend-item">
            <span class="pie-legend-swatch" style="background:${color}"></span>
            <div class="pie-legend-info">
                <span class="pie-legend-name">Paslon ${String(cd.number).padStart(2,"0")} — ${esc(cd.name)}${isWinner && maxVotes > 0 ? ' <span class="winner-crown">&#9733;</span>' : ""}</span>
                <span class="pie-legend-stat">${cd.total.toLocaleString("id")} suara &nbsp;(${pctStr}%)</span>
            </div>
        </div>`;
    }).join("");

    c.innerHTML = `
        <div class="pie-chart-wrap">
            <div class="pie-svg-wrap">
                <svg xmlns="http://www.w3.org/2000/svg"
                     viewBox="0 0 ${SIZE} ${SIZE}"
                     width="${SIZE}" height="${SIZE}"
                     style="display:block;overflow:visible;min-width:${SIZE}px">
                    ${pathsHTML}
                </svg>
            </div>
            <div class="pie-legend">${legend}</div>
        </div>`;
}

function renderTable(tbodyId, rows, total, renderNameCells, colspan) {
    const tb = document.getElementById(tbodyId);
    if (!tb) return;

    if (!rows.length) {
        tb.innerHTML = `<tr><td colspan="${colspan}" class="no-data">Tidak ada data.</td></tr>`;
        return;
    }

    const maxVal = rows.reduce(function (m, r) { return Math.max(m, r.total); }, 0);
    tb.innerHTML = "";

    rows.forEach(function (row) {
        const pct  = total > 0 ? ((row.total / total) * 100).toFixed(1) : "0.0";
        const barW = maxVal > 0 ? ((row.total / maxVal) * 100).toFixed(1) : 0;
        const tr   = document.createElement("tr");
        tr.innerHTML = `
            ${renderNameCells(row)}
            <td class="mini-bar-cell">
                <div class="mini-bar"><div class="mini-bar-fill" style="width:${barW}%"></div></div>
            </td>
            <td class="td-num">${row.total.toLocaleString("id")}</td>
            <td class="td-pct">${pct}%</td>`;
        tb.appendChild(tr);
    });
}

function renderDeptTable(departments, total) {
    const tb = document.getElementById("deptTableBody");
    if (!tb) return;

    if (!departments.length) {
        tb.innerHTML = '<tr><td colspan="5" class="no-data">Tidak ada data.</td></tr>';
        return;
    }

    const maxVal = departments.reduce(function (m, r) { return Math.max(m, r.total); }, 0);
    tb.innerHTML = "";

    departments.forEach(function (row) {
        const pct  = total > 0 ? ((row.total / total) * 100).toFixed(1) : "0.0";
        const barW = maxVal > 0 ? ((row.total / maxVal) * 100).toFixed(1) : 0;
        const tr   = document.createElement("tr");
        tr.innerHTML = `
            <td>${esc(row.name || "-")}</td>
            <td style="color:var(--muted);font-size:12px">${esc(row.className || "-")}</td>
            <td class="mini-bar-cell">
                <div class="mini-bar"><div class="mini-bar-fill" style="width:${barW}%"></div></div>
            </td>
            <td class="td-num">${row.total.toLocaleString("id")}</td>
            <td class="td-pct">${pct}%</td>`;
        tb.appendChild(tr);
    });
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function esc(v) {
    const d = document.createElement("div");
    d.textContent = v ?? "";
    return d.innerHTML;
}

/* ── EXPORT EXCEL ── */
function exportToCSV() {
    if (!lastData) { toast("Belum ada data untuk diekspor.", "error"); return; }

    const data           = lastData;
    const total          = data.totalVotes    || 0;
    const candidates     = data.candidates    || [];
    const roles          = data.roles         || [];
    const nonStudents    = data.nonStudents   || [];
    const studentClasses = data.studentClasses || [];
    const now            = new Date();
    const tanggal        = now.toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    const waktu          = now.toLocaleTimeString("id-ID");

    const T  = "\t";
    const NL = "\r\n";
    const lines = [];

    const sep = function (title) {
        lines.push("");
        lines.push(title);
        lines.push("=".repeat(title.length));
    };

    /* ── HEADER ── */
    lines.push("REKAPITULASI HASIL SUARA" + T + T + "PEMILIHAN MPK 2026");
    lines.push("SMK Negeri 1 Adiwerna" + T + T + "Diselenggarakan oleh MPK");
    lines.push("");
    lines.push("Tanggal Ekspor" + T + tanggal);
    lines.push("Waktu" + T + waktu);
    lines.push("Total Suara Masuk" + T + total);
    lines.push("Jumlah Paslon" + T + candidates.length);

    /* ── SUARA PER PASLON ── */
    sep("PEROLEHAN SUARA PER PASLON");
    lines.push("No. Paslon" + T + "Nama Paslon" + T + "Ketua" + T + "Wakil" + T + "Jumlah Suara" + T + "Persentase (%)");
    candidates.forEach(function (cd) {
        const pct = total > 0 ? (cd.total / total * 100).toFixed(2) : "0.00";
        lines.push(
            "Paslon " + String(cd.number).padStart(2, "0") + T +
            (cd.name || "-") + T +
            (cd.chairman || "-") + T +
            (cd.vice || "-") + T +
            cd.total + T +
            pct
        );
    });
    lines.push("" + T + "TOTAL" + T + "" + T + "" + T + total + T + "100.00");

    /* ── SUARA PER JENIS PEMILIH ── */
    sep("SUARA PER JENIS PEMILIH");
    lines.push("Jenis Pemilih" + T + "Jumlah Suara" + T + "Persentase (%)");
    let totalRoles = 0;
    roles.forEach(function (r) {
        const pct = total > 0 ? (r.total / total * 100).toFixed(2) : "0.00";
        totalRoles += r.total;
        lines.push((r.role || r.name || "-") + T + r.total + T + pct);
    });
    lines.push("TOTAL" + T + totalRoles + T + "100.00");

    /* ── SUARA PER KELOMPOK (Guru, Staff, Siswa Kelas) ── */
    sep("SUARA PER KELOMPOK PEMILIH");
    lines.push("Kelompok" + T + "Jumlah Suara" + T + "Persentase (%)");
    nonStudents.forEach(function (r) {
        const pct = total > 0 ? (r.total / total * 100).toFixed(2) : "0.00";
        lines.push((r.role || r.displayName || "-") + T + r.total + T + pct);
    });
    studentClasses.forEach(function (cl) {
        const pct = total > 0 ? (cl.total / total * 100).toFixed(2) : "0.00";
        lines.push("Siswa — " + (cl.name || cl.displayName || "-") + T + cl.total + T + pct);
    });

    lines.push("");
    lines.push("--- Akhir Dokumen ---");

    const tableRows = lines.map(function (line) {
        if (!line) return "<tr><td colspan='6'>&nbsp;</td></tr>";
        const cells = line.split("\t").map(function (cell) {
            return "<td>" + cell.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") + "</td>";
        }).join("");
        return "<tr>" + cells + "</tr>";
    }).join("\n");

    const xlsContent = `\uFEFF<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:x="urn:schemas-microsoft-com:office:excel"
xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8">
<style>
  table { border-collapse: collapse; font-family: Calibri, Arial, sans-serif; font-size: 11pt; }
  td { padding: 4px 10px; border: 1px solid #ccc; }
  tr:first-child td { font-weight: bold; font-size: 13pt; background: #12377A; color: #fff; border: none; }
  tr:nth-child(2) td, tr:nth-child(3) td { background: #1f4e9c; color: #fff; font-weight: 600; border: none; }
  tr:nth-child(4) td, tr:nth-child(5) td, tr:nth-child(6) td, tr:nth-child(7) td { background: #eef2fb; color: #333; font-size: 10pt; border: none; }
</style></head>
<body><table>${tableRows}</table></body></html>`;

    const blob = new Blob([xlsContent], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    const dateStr = now.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-");
    a.href     = url;
    a.download = `Rekap_Suara_Pemilihan_MPK_2026_${dateStr}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast("File Excel berhasil diunduh.", "success");
}
