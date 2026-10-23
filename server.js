"use strict";

require("dotenv").config();

const express = require("express");
const path    = require("path");
const fs      = require("fs");
const multer  = require("multer");
const crypto  = require("crypto");
const db      = require("./db");

// ─────────────────────────────────────────────
//  KONFIGURASI
// ─────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

/* Password admin — wajib ada */
const ADMIN_PASSWORD_RAW = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD_RAW) {
    console.error("\n[FATAL] ADMIN_PASSWORD belum diatur di .env\n");
    process.exit(1);
}
const ADMIN_PASSWORD_HASH = crypto
    .createHash("sha256")
    .update(ADMIN_PASSWORD_RAW)
    .digest();

const MONITOR_PASSWORD_RAW = process.env.MONITOR_PASSWORD || "RAFADEV";
const MONITOR_PASSWORD_HASH = crypto.createHash("sha256").update(MONITOR_PASSWORD_RAW).digest();

const ROOT_DIR   = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const UPLOAD_DIR = path.join(ROOT_DIR, "uploads");

[PUBLIC_DIR, UPLOAD_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ─────────────────────────────────────────────
//  UPLOAD FILE (foto paslon & hero)
// ─────────────────────────────────────────────
const ALLOWED_IMG_SIGS = [
    { bytes: [0xFF, 0xD8, 0xFF], ext: ".jpg" },
    { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], ext: ".png" },
    { bytes: [0x52, 0x49, 0x46, 0x46], ext: ".webp", extra: [0x57, 0x45, 0x42, 0x50], extraOffset: 8 }
];

function detectImageType(filePath) {
    try {
        const fd  = fs.openSync(filePath, "r");
        const buf = Buffer.alloc(12);
        fs.readSync(fd, buf, 0, 12, 0);
        fs.closeSync(fd);
        for (const sig of ALLOWED_IMG_SIGS) {
            if (!sig.bytes.every((b, i) => buf[i] === b)) continue;
            if (sig.extra && !sig.extra.every((b, i) => buf[sig.extraOffset + i] === b)) continue;
            return sig.ext;
        }
        return null;
    } catch { return null; }
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename:    (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.tmp`)
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ["image/jpeg", "image/png", "image/webp"];
        if (!allowed.includes((file.mimetype || "").toLowerCase()))
            return cb(Object.assign(new Error("Format foto harus JPG, PNG, atau WEBP."), { isValidation: true }));
        cb(null, true);
    }
});

// ─────────────────────────────────────────────
//  AUTENTIKASI & RATE LIMIT
// ─────────────────────────────────────────────
const loginFails  = new Map();
const verifyFails = new Map();

function getIp(req) {
    return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
        .split(",")[0].trim().substring(0, 45);
}

function makeRateLimiter(maxFail, windowMs, lockoutMs) {
    return {
        check(ip) {
            const now = Date.now();
            const rec = loginFails.get(ip);
            if (!rec) return true;
            if (now > rec.resetAt) { loginFails.delete(ip); return true; }
            return rec.count < maxFail;
        },
        fail(ip, map = loginFails) {
            const now = Date.now();
            const rec = map.get(ip) || { count: 0, resetAt: now + lockoutMs };
            rec.count++;
            if (rec.count >= maxFail) rec.resetAt = now + lockoutMs;
            map.set(ip, rec);
        },
        clear(ip, map = loginFails) { map.delete(ip); }
    };
}

const loginRL  = makeRateLimiter(10, 60000, 300000);
const verifyRL = {
    check(ip) {
        const now = Date.now();
        const rec = verifyFails.get(ip);
        if (!rec) return true;
        if (now > rec.resetAt) { verifyFails.delete(ip); return true; }
        return rec.count < 10;
    },
    fail(ip) {
        const now = Date.now();
        const rec = verifyFails.get(ip) || { count: 0, resetAt: now + 60000 };
        rec.count++;
        if (rec.count >= 10) rec.resetAt = now + 60000;
        verifyFails.set(ip, rec);
    },
    clear(ip) { verifyFails.delete(ip); }
};

function checkMonitorPassword(req) {
    const raw = req.headers["x-monitor-password"] || req.headers["x-admin-password"] || req.body?.password;
    if (!raw) return false;
    try { return crypto.timingSafeEqual(crypto.createHash("sha256").update(String(raw)).digest(), MONITOR_PASSWORD_HASH); }
    catch { return false; }
}

function requireMonitor(req, res, next) {
    if (!checkMonitorPassword(req)) return res.status(401).json({ success: false, message: "Sandi monitor tidak valid." });
    next();
}
function checkAdminPassword(req) {
    const raw = req.headers["x-admin-password"] || req.body?.password || req.query?.password;
    if (!raw) return false;
    try {
        return crypto.timingSafeEqual(
            crypto.createHash("sha256").update(String(raw)).digest(),
            ADMIN_PASSWORD_HASH
        );
    } catch { return false; }
}

async function requireAdmin(req, res, next) {
    const ip = getIp(req);
    if (!loginRL.check(ip)) {
        return res.status(429).json({ success: false, message: "Terlalu banyak percobaan. Coba beberapa menit lagi." });
    }
    if (!checkAdminPassword(req)) {
        loginRL.fail(ip);
        return res.status(401).json({ success: false, message: "Password administrator tidak valid." });
    }
    loginRL.clear(ip);
    next();
}

async function requireDraft(req, res, next) {
    const status = await db.getElectionStatus();
    if (status !== "DRAFT") {
        return res.status(403).json({ success: false, message: "Pengaturan hanya dapat dilakukan saat status DRAFT." });
    }
    next();
}

// ─────────────────────────────────────────────
//  VOTE TOKEN (in-memory, TTL 10 menit)
// ─────────────────────────────────────────────
const voteTokens = new Map();
const TOKEN_TTL  = 10 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [t, d] of voteTokens) if (now > d.expiresAt) voteTokens.delete(t);
}, 5 * 60 * 1000);

function createVoteToken(voterCodeId, roleId, classId, departmentId) {
    const token = crypto.randomBytes(32).toString("hex");
    voteTokens.set(token, {
        voterCodeId,
        roleId:       roleId       || null,
        classId:      classId      || null,
        departmentId: departmentId || null,
        expiresAt:    Date.now() + TOKEN_TTL,
        used:         false
    });
    return token;
}

// ─────────────────────────────────────────────
//  MIDDLEWARE
// ─────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(PUBLIC_DIR, {
    setHeaders(res, fp) {
        if ([".js", ".css", ".html"].some(e => fp.endsWith(e))) res.setHeader("Cache-Control", "no-store");
    }
}));

// ─────────────────────────────────────────────
//  HELPER: utilitas kode pemilih
// ─────────────────────────────────────────────
function normalizeCode(code) {
    return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function generateCode(existingCodes) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    for (let i = 0; i < 10000; i++) {
        const bytes = crypto.randomBytes(5);
        let code = "";
        for (let j = 0; j < 5; j++) code += chars[bytes[j] % chars.length];
        if (!existingCodes.has(code)) { existingCodes.add(code); return code; }
    }
    throw new Error("Gagal membuat kode unik.");
}

// ─────────────────────────────────────────────
//  HELPER: audit log
// ─────────────────────────────────────────────
async function audit(action, detail, rows, req) {
    const status = await db.getElectionStatus().catch(() => "?");
    await db.writeAuditLog(action, detail, rows, req ? getIp(req) : null, status);
}

// ─────────────────────────────────────────────
//  ROUTES — HALAMAN STATIS
// ─────────────────────────────────────────────
app.get("/",             (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
app.get("/admin.html",   (req, res) => res.sendFile(path.join(PUBLIC_DIR, "admin.html")));
app.get("/vote.html",    (req, res) => res.sendFile(path.join(PUBLIC_DIR, "vote.html")));
app.get("/results.html", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "results.html")));
app.get("/monitor-mpk.html", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "monitor-mpk.html")));

// ─────────────────────────────────────────────
//  API PUBLIK
// ─────────────────────────────────────────────
app.get("/api/election", async (req, res) => {
    try {
        const s = await db.getElectionSettings();
        res.json({ success: true, status: s.status, published: s.published === 1, heroImage: s.heroImage });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: "Gagal mengambil status." }); }
});

app.get("/api/candidates", async (req, res) => {
    try {
        res.json({ success: true, candidates: await db.getCandidates() });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: "Gagal mengambil data Paslon." }); }
});

app.get("/api/voter-config", async (req, res) => {
    try {
        const [roles, classes] = await Promise.all([db.getRoles(true), db.getClasses(true)]);
        res.json({ success: true, roles, classes });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: "Gagal mengambil konfigurasi." }); }
});

app.get("/api/results", async (req, res) => {
    try {
        const s = await db.getElectionSettings();
        if (!s.published) return res.status(403).json({ success: false, message: "Hasil suara belum dipublikasikan." });
        res.json({ success: true, published: true, ...(await db.buildResultsData()) });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: "Gagal mengambil hasil." }); }
});

// ─────────────────────────────────────────────
//  VOTING
// ─────────────────────────────────────────────
app.post("/api/vote/verify-code", async (req, res) => {
    const ip = getIp(req);
    if (!verifyRL.check(ip)) {
        return res.status(429).json({ success: false, message: "Terlalu banyak percobaan. Coba lagi 1 menit." });
    }
    try {
        const status = await db.getElectionStatus();
        if (status !== "OPEN") return res.status(403).json({ success: false, message: "Pemilihan belum dibuka." });

        const code = normalizeCode(req.body.code);
        if (!/^[A-Z0-9]{5}$/.test(code)) {
            verifyRL.fail(ip);
            return res.status(400).json({ success: false, message: "Kode pemilih harus 5 karakter." });
        }

        const voter = await db.getCodeByString(code);
        if (!voter) { verifyRL.fail(ip); return res.status(404).json({ success: false, message: "Kode pemilih tidak ditemukan." }); }
        if (voter.used) { verifyRL.fail(ip); return res.status(400).json({ success: false, message: "Kode pemilih sudah digunakan." }); }

        // Validasi role
        const roleData  = voter.voter_roles;
        const classData = voter.voter_classes;
        const deptData  = voter.voter_departments;

        if (voter.role_id) {
            if (roleData && !roleData.active) return res.status(403).json({ success: false, message: "Jenis pemilih tidak aktif." });
        }

        verifyRL.clear(ip);
        const voteToken = createVoteToken(voter.id, voter.role_id, voter.class_id, voter.department_id);

        res.json({
            success: true,
            voter: {
                voteToken,
                code:           voter.code,
                roleId:         voter.role_id   || null,
                role:           roleData?.name   || null,
                classId:        voter.class_id  || null,
                className:      classData?.name  || null,
                departmentId:   voter.department_id || null,
                departmentName: deptData?.name   || null
            }
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: "Gagal memverifikasi kode." });
    }
});

app.post("/api/vote", async (req, res) => {
    try {
        const status = await db.getElectionStatus();
        if (status !== "OPEN") return res.status(403).json({ success: false, message: "Pemilihan belum dibuka." });

        const voteToken   = String(req.body.voteToken || "").trim();
        const candidateId = Number(req.body.candidateId);
        const bodyRoleId  = Number(req.body.roleId);

        if (!voteToken)                    return res.status(400).json({ success: false, message: "Token tidak valid." });
        if (!Number.isInteger(candidateId)) return res.status(400).json({ success: false, message: "Data Paslon tidak valid." });

        const tokenData = voteTokens.get(voteToken);
        if (!tokenData)              return res.status(400).json({ success: false, message: "Token tidak valid atau kedaluwarsa. Masukkan kode kembali." });
        if (tokenData.used)          return res.status(400).json({ success: false, message: "Token sudah digunakan." });
        if (Date.now() > tokenData.expiresAt) {
            voteTokens.delete(voteToken);
            return res.status(400).json({ success: false, message: "Sesi kedaluwarsa (10 menit). Masukkan kode kembali." });
        }

        const codeId = tokenData.voterCodeId;

        // Resolve role
        let finalRoleId = tokenData.roleId;
        if (!finalRoleId) {
            if (!Number.isInteger(bodyRoleId) || bodyRoleId <= 0)
                return res.status(400).json({ success: false, message: "Jenis pemilih wajib dipilih." });
            const chosenRole = await db.getRoleById(bodyRoleId);
            if (!chosenRole) return res.status(404).json({ success: false, message: "Jenis pemilih tidak ditemukan." });
            if (!chosenRole.active) return res.status(400).json({ success: false, message: "Jenis pemilih tidak aktif." });
            finalRoleId = bodyRoleId;
        }

        // Cast vote via stored function (atomik di Supabase)
        const result = await db.castVote(codeId, candidateId, finalRoleId, tokenData.classId, tokenData.departmentId);
        voteTokens.delete(voteToken);

        if (result === "ALREADY_USED")   return res.status(400).json({ success: false, message: "Kode pemilih sudah digunakan." });
        if (result === "CODE_NOT_FOUND") return res.status(404).json({ success: false, message: "Data pemilih tidak ditemukan." });
        if (result !== "OK")             return res.status(500).json({ success: false, message: "Gagal mengirim suara." });

        res.json({ success: true, message: "Suara berhasil dikirim." });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: "Gagal mengirim suara." });
    }
});

// ─────────────────────────────────────────────
//  ADMIN — AUTH
// ─────────────────────────────────────────────
app.post("/api/admin/verify", async (req, res) => {
    const ip = getIp(req);
    if (!loginRL.check(ip)) return res.status(429).json({ success: false, message: "Terlalu banyak percobaan." });
    if (!checkAdminPassword(req)) {
        loginRL.fail(ip);
        await audit("LOGIN_FAIL", null, 0, req);
        return res.status(401).json({ success: false, message: "Password salah." });
    }
    loginRL.clear(ip);
    res.json({ success: true, message: "Password benar." });
});

// ─────────────────────────────────────────────
//  MONITOR REALTIME — nama paslon disamarkan
// ─────────────────────────────────────────────
app.post("/api/monitor/verify", (req, res) => {
    if (!checkMonitorPassword(req)) return res.status(401).json({ success: false, message: "Sandi monitor tidak valid." });
    res.json({ success: true, message: "Akses monitor diterima." });
});

app.get("/api/monitor/results", requireMonitor, async (req, res) => {
    try {
        const data = await db.buildAdminResultsData();
        data.candidates = (data.candidates || []).map((candidate, index) => ({
            id: candidate.id,
            number: candidate.number || index + 1,
            name: `Pasangan ${String(candidate.number || index + 1).padStart(2, "0")}`,
            total: candidate.total || 0
        }));
        res.json({ success: true, ...data });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: "Gagal mengambil data monitor." }); }
});
//  ADMIN — STATUS PEMILIHAN
// ─────────────────────────────────────────────
app.post("/api/election/ready", requireAdmin, async (req, res) => {
    try {
        if (await db.getElectionStatus() !== "DRAFT") return res.status(400).json({ success: false, message: "Hanya bisa dari status DRAFT." });
        const [cands, codes] = await Promise.all([
            db.getCandidates(),
            db.countActiveCodesOnly()
        ]);
        if (cands.length < 2) return res.status(400).json({ success: false, message: "Minimal 2 Paslon." });
        if (codes < 1)        return res.status(400).json({ success: false, message: "Minimal 1 kode pemilih." });
        await db.setElectionStatus("READY");
        await audit("STATUS_CHANGE", "DRAFT → READY", 1, req);
        res.json({ success: true, status: "READY", message: "Pemilihan berhasil disiapkan." });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: e.message }); }
});

app.post("/api/election/open", requireAdmin, async (req, res) => {
    try {
        if (await db.getElectionStatus() !== "READY") return res.status(400).json({ success: false, message: "Hanya bisa dari status READY." });
        await db.setElectionStatus("OPEN");
        await audit("STATUS_CHANGE", "READY → OPEN", 1, req);
        res.json({ success: true, status: "OPEN", message: "Pemilihan berhasil dibuka." });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: e.message }); }
});

app.post("/api/election/unlock", requireAdmin, async (req, res) => {
    try {
        if (await db.getElectionStatus() !== "READY") return res.status(400).json({ success: false, message: "Hanya bisa saat status READY." });
        await db.setElectionStatus("DRAFT");
        await audit("STATUS_CHANGE", "READY → DRAFT (unlock)", 1, req);
        res.json({ success: true, status: "DRAFT", message: "Konfigurasi berhasil dibuka kembali." });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: e.message }); }
});

app.post("/api/election/close", requireAdmin, async (req, res) => {
    try {
        if (await db.getElectionStatus() !== "OPEN") return res.status(400).json({ success: false, message: "Hanya bisa saat status OPEN." });
        await db.setElectionStatus("CLOSED");
        await audit("STATUS_CHANGE", "OPEN → CLOSED", 1, req);
        res.json({ success: true, status: "CLOSED", message: "Pemilihan berhasil diselesaikan." });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: e.message }); }
});

app.post("/api/election/reset", requireAdmin, async (req, res) => {
    try {
        if (await db.getElectionStatus() !== "CLOSED") return res.status(400).json({ success: false, message: "Reset hanya saat status CLOSED." });
        if (String(req.body.confirmPhrase || "").trim() !== "RESET PEMILIHAN")
            return res.status(400).json({ success: false, message: "Ketik RESET PEMILIHAN untuk mengonfirmasi." });

        const voteCount = await db.countVotes();
        const batchId   = crypto.randomBytes(8).toString("hex");

        // Arsip suara → hapus suara → hapus semua kode
        await db.archiveAndClearVotes(batchId, "election_reset");
        await db.deleteAllActiveCodes();

        await db.setElectionStatus("DRAFT");
        await db.setPublished(false);
        await audit("ELECTION_RESET", `${voteCount} suara diarsip (batch ${batchId})`, voteCount, req);

        res.json({ success: true, status: "DRAFT", message: "Pemilihan berhasil direset. Data suara diarsip." });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: e.message }); }
});

app.post("/api/election/publish", requireAdmin, async (req, res) => {
    try {
        await db.setPublished(true);
        await audit("PUBLISH", "Hasil dipublikasikan", 1, req);
        res.json({ success: true, published: true, message: "Hasil suara berhasil dipublikasikan." });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: e.message }); }
});

app.post("/api/election/unpublish", requireAdmin, async (req, res) => {
    try {
        await db.setPublished(false);
        await audit("UNPUBLISH", "Hasil disembunyikan", 1, req);
        res.json({ success: true, published: false, message: "Hasil suara disembunyikan." });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: e.message }); }
});

// ─────────────────────────────────────────────
//  ADMIN — HAPUS DATA SUARA
// ─────────────────────────────────────────────
app.post("/api/admin/votes/clear", requireAdmin, async (req, res) => {
    try {
        const status = await db.getElectionStatus();
        if (status === "OPEN" || status === "READY") {
            return res.status(403).json({ success: false, message: `Tidak bisa hapus data saat status ${status}.` });
        }
        if (String(req.body.confirmPhrase || "").trim() !== "HAPUS SEMUA SUARA")
            return res.status(400).json({ success: false, message: "Ketik HAPUS SEMUA SUARA untuk mengonfirmasi." });

        const voteCount = await db.countVotes();
        const batchId   = crypto.randomBytes(8).toString("hex");

        await db.archiveAndClearVotes(batchId, "manual_clear");
        await db.resetAllCodes();
        await audit("VOTES_CLEAR", `${voteCount} suara diarsip (batch ${batchId})`, voteCount, req);

        res.json({ success: true, votesArchived: voteCount, batchId, message: `${voteCount} suara diarsip. Kode direset.` });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: e.message }); }
});

app.post("/api/admin/votes/restore-last", requireAdmin, async (req, res) => {
    try {
        const status = await db.getElectionStatus();
        if (status === "OPEN") return res.status(403).json({ success: false, message: "Tidak bisa restore saat OPEN." });
        const restored = await db.restoreLastBatch();
        if (restored === 0) return res.status(404).json({ success: false, message: "Tidak ada arsip untuk dipulihkan." });
        await audit("VOTES_RESTORE", `${restored} suara dipulihkan`, restored, req);
        res.json({ success: true, restored, message: `${restored} suara berhasil dipulihkan.` });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: e.message }); }
});

app.get("/api/admin/votes/archive-info", requireAdmin, async (req, res) => {
    try {
        const raw = await db.getArchiveBatches();
        // Group by batch_id
        const byBatch = {};
        raw.forEach(r => {
            if (!byBatch[r.batch_id]) byBatch[r.batch_id] = { batch_id: r.batch_id, n: 0, archivedAt: r.archived_at, deleted_reason: r.deleted_reason };
            byBatch[r.batch_id].n++;
        });
        res.json({ success: true, batches: Object.values(byBatch).slice(0, 5) });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: e.message }); }
});

// ─────────────────────────────────────────────
//  ADMIN — HERO IMAGE
// ─────────────────────────────────────────────
app.post("/api/admin/hero-image", requireAdmin, upload.single("image"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "File gambar belum dipilih." });
        const realExt = detectImageType(req.file.path);
        if (!realExt) { fs.unlinkSync(req.file.path); return res.status(400).json({ success: false, message: "File bukan gambar valid." }); }
        const finalName = req.file.filename.replace(".tmp", realExt);
        const finalPath = path.join(UPLOAD_DIR, finalName);
        fs.renameSync(req.file.path, finalPath);
        const imageUrl = `/uploads/${finalName}`;
        // Hapus gambar lama
        const cur = await db.getElectionSettings();
        if (cur.heroImage) {
            const old = path.join(ROOT_DIR, cur.heroImage.replace(/^\/+/, ""));
            if (fs.existsSync(old) && old.startsWith(UPLOAD_DIR)) try { fs.unlinkSync(old); } catch {}
        }
        await db.setHeroImage(imageUrl);
        res.json({ success: true, heroImage: imageUrl });
    } catch (e) {
        console.error(e);
        if (req.file && fs.existsSync(req.file.path)) try { fs.unlinkSync(req.file.path); } catch {}
        res.status(500).json({ success: false, message: "Gagal mengunggah gambar hero." });
    }
});

app.delete("/api/admin/hero-image", requireAdmin, async (req, res) => {
    try {
        const cur = await db.getElectionSettings();
        if (cur.heroImage) {
            const old = path.join(ROOT_DIR, cur.heroImage.replace(/^\/+/, ""));
            if (fs.existsSync(old) && old.startsWith(UPLOAD_DIR)) try { fs.unlinkSync(old); } catch {}
        }
        await db.setHeroImage(null);
        res.json({ success: true, message: "Gambar hero dihapus." });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: "Gagal menghapus gambar hero." }); }
});

// ─────────────────────────────────────────────
//  ADMIN — PASLON
// ─────────────────────────────────────────────
app.post("/api/admin/candidates", requireAdmin, requireDraft, async (req, res) => {
    try {
        const number   = Number(req.body.number);
        const name     = String(req.body.name     || "").trim();
        const chairman = String(req.body.chairman || "").trim();
        const vice     = String(req.body.vice     || "").trim();
        const photo    = req.body.photo || null;
        if (!Number.isInteger(number) || number <= 0) return res.status(400).json({ success: false, message: "Nomor Paslon tidak valid." });
        if (!name || !chairman || !vice) return res.status(400).json({ success: false, message: "Nama, Ketua, dan Wakil wajib diisi." });
        if (await db.candidateNumberExists(number)) return res.status(400).json({ success: false, message: "Nomor Paslon sudah digunakan." });
        const candidate = await db.insertCandidate(number, name, chairman, vice, photo);
        res.json({ success: true, candidate });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: "Gagal menambahkan Paslon." }); }
});

app.post("/api/admin/candidates/upload/:number", requireAdmin, requireDraft, upload.single("photo"), async (req, res) => {
    try {
        const number = Number(req.params.number);
        if (!req.file) return res.status(400).json({ success: false, message: "Foto belum dipilih." });
        const realExt = detectImageType(req.file.path);
        if (!realExt) { fs.unlinkSync(req.file.path); return res.status(400).json({ success: false, message: "File bukan gambar valid." }); }
        const finalName = req.file.filename.replace(".tmp", realExt);
        fs.renameSync(req.file.path, path.join(UPLOAD_DIR, finalName));
        const candidate = await db.getCandidateByNumber(number);
        if (!candidate) { fs.unlinkSync(path.join(UPLOAD_DIR, finalName)); return res.status(404).json({ success: false, message: "Paslon tidak ditemukan." }); }
        const photo = `/uploads/${finalName}`;
        if (candidate.photo) {
            const old = path.join(ROOT_DIR, candidate.photo.replace(/^\/+/, ""));
            if (fs.existsSync(old) && old.startsWith(UPLOAD_DIR)) try { fs.unlinkSync(old); } catch {}
        }
        await db.updateCandidate(candidate.id, { photo });
        res.json({ success: true, photo });
    } catch (e) {
        console.error(e);
        if (req.file && fs.existsSync(req.file.path)) try { fs.unlinkSync(req.file.path); } catch {}
        res.status(500).json({ success: false, message: "Gagal mengunggah foto." });
    }
});

app.put("/api/admin/candidates/:id", requireAdmin, requireDraft, async (req, res) => {
    try {
        const id       = Number(req.params.id);
        const number   = Number(req.body.number);
        const name     = String(req.body.name     || "").trim();
        const chairman = String(req.body.chairman || "").trim();
        const vice     = String(req.body.vice     || "").trim();
        const photo    = req.body.photo;
        const existing = await db.getCandidateById(id);
        if (!existing) return res.status(404).json({ success: false, message: "Paslon tidak ditemukan." });
        if (!Number.isInteger(number) || number <= 0) return res.status(400).json({ success: false, message: "Nomor tidak valid." });
        if (!name || !chairman || !vice) return res.status(400).json({ success: false, message: "Nama, Ketua, dan Wakil wajib diisi." });
        if (await db.candidateNumberExists(number, id)) return res.status(400).json({ success: false, message: "Nomor sudah digunakan." });
        const finalPhoto = photo === undefined ? existing.photo : (photo || null);
        const candidate  = await db.updateCandidate(id, { number, name, chairman, vice, photo: finalPhoto });
        res.json({ success: true, candidate });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: "Gagal memperbarui Paslon." }); }
});

app.delete("/api/admin/candidates/:id", requireAdmin, requireDraft, async (req, res) => {
    try {
        const id        = Number(req.params.id);
        const candidate = await db.getCandidateById(id);
        if (!candidate) return res.status(404).json({ success: false, message: "Paslon tidak ditemukan." });
        if (await db.countVotesForCandidate(id) > 0) return res.status(400).json({ success: false, message: "Paslon yang sudah punya suara tidak dapat dihapus." });
        await db.deleteCandidate(id);
        if (candidate.photo) {
            const p = path.join(ROOT_DIR, candidate.photo.replace(/^\/+/, ""));
            if (fs.existsSync(p) && p.startsWith(UPLOAD_DIR)) try { fs.unlinkSync(p); } catch {}
        }
        res.json({ success: true, message: "Paslon berhasil dihapus." });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: "Gagal menghapus Paslon." }); }
});

// ─────────────────────────────────────────────
//  ADMIN — KONFIGURASI PEMILIH
// ─────────────────────────────────────────────
app.get("/api/admin/voter-config", requireAdmin, async (req, res) => {
    try {
        const [roles, classes, departments, rawCodes] = await Promise.all([
            db.getRoles(), db.getClasses(), db.getDepartments(), db.getCodesWithMeta()
        ]);
        // Normalise kode agar field-nya konsisten dengan format lama
        const codes = rawCodes.map(c => ({
            id:           c.id,
            code:         c.code,
            roleId:       c.role_id,
            role:         c.voter_roles?.name    || null,
            classId:      c.class_id,
            className:    c.voter_classes?.name  || null,
            departmentId: c.department_id,
            department:   c.voter_departments?.name || null,
            used:         c.used,
            createdAt:    c.created_at,
            usedAt:       c.used_at
        }));
        res.json({ success: true, roles, classes, departments, codes });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: "Gagal mengambil konfigurasi." }); }
});

app.put("/api/admin/voter-roles/:id", requireAdmin, requireDraft, async (req, res) => {
    try {
        const id     = Number(req.params.id);
        const active = req.body.active === true || req.body.active === 1 || req.body.active === "1";
        if (!await db.getRoleById(id)) return res.status(404).json({ success: false, message: "Jenis pemilih tidak ditemukan." });
        await db.updateRoleActive(id, active);
        res.json({ success: true, role: await db.getRoleById(id) });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: "Gagal mengubah status." }); }
});

app.post("/api/admin/voter-classes", requireAdmin, requireDraft, async (req, res) => {
    try {
        const name = String(req.body.name || "").trim();
        if (!name) return res.status(400).json({ success: false, message: "Nama kelas wajib diisi." });
        const cls = await db.insertClass(name);
        res.json({ success: true, class: cls });
    } catch (e) {
        if (e.message.includes("unique") || e.message.includes("duplicate"))
            return res.status(400).json({ success: false, message: "Kelas tersebut sudah ada." });
        console.error(e); res.status(500).json({ success: false, message: "Gagal menambahkan kelas." });
    }
});

app.delete("/api/admin/voter-classes/:id", requireAdmin, requireDraft, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!await db.getClassById(id)) return res.status(404).json({ success: false, message: "Kelas tidak ditemukan." });
        if (await db.classIsUsed(id)) return res.status(400).json({ success: false, message: "Kelas yang sudah digunakan tidak dapat dihapus." });
        await db.deleteClass(id);
        res.json({ success: true, message: "Kelas berhasil dihapus." });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: "Gagal menghapus kelas." }); }
});

app.post("/api/admin/voter-departments", requireAdmin, requireDraft, async (req, res) => {
    try {
        const classId = Number(req.body.class_id ?? req.body.classId);
        const name    = String(req.body.name || "").trim();
        if (!Number.isInteger(classId)) return res.status(400).json({ success: false, message: "Kelas tidak valid." });
        if (!name) return res.status(400).json({ success: false, message: "Nama jurusan wajib diisi." });
        const cls = await db.getClassById(classId);
        if (!cls) return res.status(404).json({ success: false, message: "Kelas tidak ditemukan." });
        if (!cls.active) return res.status(400).json({ success: false, message: "Kelas tidak aktif." });
        const dept = await db.insertDepartment(classId, name);
        res.json({ success: true, department: dept });
    } catch (e) {
        if (e.message.includes("unique") || e.message.includes("duplicate"))
            return res.status(400).json({ success: false, message: "Jurusan tersebut sudah ada." });
        console.error(e); res.status(500).json({ success: false, message: "Gagal menambahkan jurusan." });
    }
});

app.delete("/api/admin/voter-departments/:id", requireAdmin, requireDraft, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (await db.deptIsUsed(id)) return res.status(400).json({ success: false, message: "Jurusan yang sudah digunakan tidak dapat dihapus." });
        await db.deleteDepartment(id);
        res.json({ success: true, message: "Jurusan berhasil dihapus." });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: "Gagal menghapus jurusan." }); }
});

// ─────────────────────────────────────────────
//  ADMIN — KODE PEMILIH
// ─────────────────────────────────────────────
app.post("/api/admin/voter-codes/generate", requireAdmin, requireDraft, async (req, res) => {
    try {
        const roleId  = Number(req.body.role_id ?? req.body.roleId);
        const classId = req.body.classId ? Number(req.body.classId) : null;
        const amount  = Number(req.body.amount ?? req.body.quantity ?? req.body.count);

        if (!Number.isInteger(roleId) || roleId <= 0) return res.status(400).json({ success: false, message: "Jenis pemilih wajib dipilih." });
        if (!Number.isInteger(amount) || amount < 1 || amount > 5000) return res.status(400).json({ success: false, message: "Jumlah kode harus 1–5000." });

        const role = await db.getRoleById(roleId);
        if (!role) return res.status(404).json({ success: false, message: "Jenis pemilih tidak ditemukan." });
        if (!role.active) return res.status(400).json({ success: false, message: "Jenis pemilih tidak aktif." });

        if (classId) {
            if (!await db.getClassById(classId)) return res.status(404).json({ success: false, message: "Kelas tidak ditemukan." });
        }
        if (role.name === "SISWA" && !classId) return res.status(400).json({ success: false, message: "Kelas wajib dipilih untuk SISWA." });

        const existingSet = await db.getAllExistingCodes();
        const rows = [];
        for (let i = 0; i < amount; i++) {
            rows.push({ code: generateCode(existingSet), role_id: roleId, class_id: classId || null, department_id: null, used: 0 });
        }
        await db.insertCodes(rows);
        await audit("GENERATE_CODES", `${amount} kode role=${roleId} class=${classId}`, amount, req);
        res.json({ success: true, amount: rows.length, codes: rows.map(r => r.code) });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: "Gagal membuat kode." }); }
});

app.delete("/api/admin/voter-codes", requireAdmin, requireDraft, async (req, res) => {
    try {
        const body      = req.body || {};
        const deleteAll = body.all === true || body.all === "true";
        const ids       = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isInteger) : [];
        if (!deleteAll && !ids.length) return res.status(400).json({ success: false, message: "Tidak ada kode yang dipilih." });
        const deleted = deleteAll ? await db.deleteAllActiveCodes() : await db.deleteCodesByIds(ids);
        await audit("DELETE_CODES", deleteAll ? "hapus semua aktif" : `hapus ${ids.length}`, deleted, req);
        res.json({ success: true, deleted, message: `${deleted} kode berhasil dihapus.` });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: "Gagal menghapus kode." }); }
});

app.delete("/api/admin/voter-codes/:id", requireAdmin, requireDraft, async (req, res) => {
    try {
        const id   = Number(req.params.id);
        const code = await db.getCodeById(id);
        if (!code) return res.status(404).json({ success: false, message: "Kode tidak ditemukan." });
        if (code.used) return res.status(400).json({ success: false, message: "Kode yang sudah digunakan tidak dapat dihapus." });
        await db.deleteCodeById(id);
        res.json({ success: true, message: "Kode berhasil dihapus." });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: "Gagal menghapus kode." }); }
});

// ─────────────────────────────────────────────
//  ADMIN — HASIL & LOG
// ─────────────────────────────────────────────
app.get("/api/admin/results", requireAdmin, async (req, res) => {
    try {
        res.json({ success: true, ...(await db.buildAdminResultsData()) });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: "Gagal mengambil hasil." }); }
});

app.get("/api/admin/audit-log", requireAdmin, async (req, res) => {
    try {
        res.json({ success: true, logs: await db.getAuditLogs() });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: "Gagal mengambil log." }); }
});

// ─────────────────────────────────────────────
//  ERROR HANDLER
// ─────────────────────────────────────────────
app.use("/api", (req, res) => res.status(404).json({ success: false, message: "Endpoint tidak ditemukan." }));

app.use((err, req, res, next) => {
    console.error(err);
    if (err instanceof multer.MulterError)
        return res.status(400).json({ success: false, message: "Upload gagal: " + err.message });
    if (err?.isValidation)
        return res.status(400).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: err.message || "Terjadi kesalahan server." });
});

if (require.main === module) {
    app.listen(PORT, () => console.log("Pemilihan MPK berjalan di http://localhost:" + PORT));
}

module.exports = app;




