"use strict";

// Vercel/Supabase: gunakan adapter PostgreSQL jika env tersedia.
if (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY)) {
    module.exports = require("./db-supabase");
    return;
}/** Database local untuk aplikasi pemilihan MPK (SQLite). */
const path = require("path");
const Database = require("better-sqlite3");
const db = new Database(path.join(__dirname, "database", "pilketos.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const now = () => new Date().toISOString();
const one = (sql, ...params) => db.prepare(sql).get(...params) || null;
const all = (sql, ...params) => db.prepare(sql).all(...params);
const run = (sql, ...params) => db.prepare(sql).run(...params);

function settings() {
    const row = one("SELECT status, published, hero_image FROM election_settings WHERE id = 1");
    if (!row) throw new Error("Pengaturan pemilihan belum tersedia.");
    return { status: row.status, published: row.published, heroImage: row.hero_image || null };
}
async function getElectionSettings() { return settings(); }
async function getElectionStatus() { return settings().status; }
async function setElectionStatus(status) { run("UPDATE election_settings SET status=?, updated_at=? WHERE id=1", status, now()); }
async function setPublished(value) { run("UPDATE election_settings SET published=? WHERE id=1", value ? 1 : 0); }
async function setHeroImage(url) { run("UPDATE election_settings SET hero_image=? WHERE id=1", url); }

async function getCandidates() { return all("SELECT * FROM candidates ORDER BY number"); }
async function getCandidateById(id) { return one("SELECT * FROM candidates WHERE id=?", id); }
async function getCandidateByNumber(number) { return one("SELECT * FROM candidates WHERE number=?", number); }
async function candidateNumberExists(number, excludeId = null) { return !!one("SELECT id FROM candidates WHERE number=? AND (? IS NULL OR id != ?)", number, excludeId, excludeId); }
async function insertCandidate(number, name, chairman, vice, photo) {
    const result = run("INSERT INTO candidates (number,name,chairman,vice,photo,created_at) VALUES (?,?,?,?,?,?)", number, name, chairman, vice, photo || null, now());
    return getCandidateById(result.lastInsertRowid);
}
async function updateCandidate(id, fields) {
    run("UPDATE candidates SET number=?, name=?, chairman=?, vice=?, photo=? WHERE id=?", fields.number, fields.name, fields.chairman, fields.vice, fields.photo || null, id);
    return getCandidateById(id);
}
async function deleteCandidate(id) { run("DELETE FROM candidates WHERE id=?", id); }
async function countVotesForCandidate(id) { return one("SELECT COUNT(*) n FROM votes WHERE candidate_id=?", id).n; }

async function getRoles(activeOnly = false) {
    return all(`SELECT id,name,active FROM voter_roles ${activeOnly ? "WHERE active=1" : ""} ORDER BY CASE name WHEN 'SISWA' THEN 1 WHEN 'GURU' THEN 2 WHEN 'STAFF' THEN 3 ELSE 99 END,name`);
}
async function getRoleById(id) { return one("SELECT id,name,active FROM voter_roles WHERE id=?", id); }
async function updateRoleActive(id, active) { run("UPDATE voter_roles SET active=? WHERE id=?", active ? 1 : 0, id); }
async function getClasses(activeOnly = false) { return all(`SELECT id,name,active FROM voter_classes ${activeOnly ? "WHERE active=1" : ""} ORDER BY id`); }
async function getClassById(id) { return one("SELECT id,name,active FROM voter_classes WHERE id=?", id); }
async function insertClass(name) { const result = run("INSERT INTO voter_classes (name,active) VALUES (?,1)", name); return getClassById(result.lastInsertRowid); }
async function deleteClass(id) { run("DELETE FROM voter_classes WHERE id=?", id); }
async function classIsUsed(id) { return one("SELECT EXISTS(SELECT 1 FROM voter_codes WHERE class_id=?) OR EXISTS(SELECT 1 FROM votes WHERE class_id=?) used", id, id).used === 1; }

async function getDepartments() {
    return all(`SELECT d.id,d.class_id,d.name,d.active,c.name class_name,c.active class_active FROM voter_departments d JOIN voter_classes c ON c.id=d.class_id ORDER BY d.class_id,d.name`)
        .map(r => ({ id:r.id, class_id:r.class_id, name:r.name, active:r.active, voter_classes:{ name:r.class_name, active:r.class_active } }));
}
async function insertDepartment(classId, name) { const result = run("INSERT INTO voter_departments (class_id,name,active) VALUES (?,?,1)", classId, name); return one("SELECT id,class_id,name,active FROM voter_departments WHERE id=?", result.lastInsertRowid); }
async function deleteDepartment(id) { run("DELETE FROM voter_departments WHERE id=?", id); }
async function deptIsUsed(id) { return one("SELECT EXISTS(SELECT 1 FROM voter_codes WHERE department_id=?) OR EXISTS(SELECT 1 FROM votes WHERE department_id=?) used", id, id).used === 1; }

function codeWithMeta(where, ...params) {
    const r = one(`SELECT vc.id,vc.code,vc.used,vc.created_at,vc.used_at,vc.role_id,vc.class_id,vc.department_id,
        vr.id role_db_id,vr.name role_name,vr.active role_active,cl.id class_db_id,cl.name class_name,cl.active class_active,
        dp.id department_db_id,dp.name department_name,dp.active department_active,dp.class_id department_class_id
        FROM voter_codes vc LEFT JOIN voter_roles vr ON vr.id=vc.role_id LEFT JOIN voter_classes cl ON cl.id=vc.class_id LEFT JOIN voter_departments dp ON dp.id=vc.department_id ${where}`, ...params);
    if (!r) return null;
    return { ...r,
        voter_roles:r.role_db_id ? {id:r.role_db_id,name:r.role_name,active:r.role_active} : null,
        voter_classes:r.class_db_id ? {id:r.class_db_id,name:r.class_name,active:r.class_active} : null,
        voter_departments:r.department_db_id ? {id:r.department_db_id,name:r.department_name,active:r.department_active,class_id:r.department_class_id} : null };
}
async function getCodesWithMeta() {
    return all(`SELECT vc.id,vc.code,vc.used,vc.created_at,vc.used_at,vc.role_id,vc.class_id,vc.department_id,vr.name role_name,cl.name class_name,dp.name department_name
        FROM voter_codes vc LEFT JOIN voter_roles vr ON vr.id=vc.role_id LEFT JOIN voter_classes cl ON cl.id=vc.class_id LEFT JOIN voter_departments dp ON dp.id=vc.department_id ORDER BY vc.id DESC`)
        .map(r => ({ ...r, voter_roles:r.role_name ? {name:r.role_name} : null, voter_classes:r.class_name ? {name:r.class_name} : null, voter_departments:r.department_name ? {name:r.department_name} : null }));
}
async function getAllExistingCodes() { return new Set(all("SELECT code FROM voter_codes").map(r => r.code)); }
async function insertCodes(rows) {
    const insert = db.prepare("INSERT INTO voter_codes (code,role_id,class_id,department_id,used,created_at) VALUES (?,?,?,?,?,?)");
    db.transaction(items => items.forEach(r => insert.run(r.code,r.role_id,r.class_id,r.department_id,r.used || 0,now())))(rows);
}
async function getCodeByString(code) { return codeWithMeta("WHERE vc.code=?", code); }
async function getCodeById(id) { return codeWithMeta("WHERE vc.id=?", id); }
async function deleteCodeById(id) { run("DELETE FROM voter_codes WHERE id=?", id); }
async function deleteAllActiveCodes() { return run("DELETE FROM voter_codes WHERE used=0").changes; }
async function deleteCodesByIds(ids) { return ids.length ? run(`DELETE FROM voter_codes WHERE used=0 AND id IN (${ids.map(() => "?").join(",")})`, ...ids).changes : 0; }
async function countCodes() { const r=one("SELECT COUNT(*) total,SUM(CASE WHEN used=1 THEN 1 ELSE 0 END) used FROM voter_codes"); return {total:r.total,used:r.used||0,active:r.total-(r.used||0)}; }
async function countActiveCodesOnly() { return one("SELECT COUNT(*) n FROM voter_codes WHERE used=0").n; }
async function resetAllCodes() { run("UPDATE voter_codes SET used=0,used_at=NULL"); }

const castVoteTransaction = db.transaction((codeId,candidateId,roleId,classId,departmentId) => {
    const code=one("SELECT id,used FROM voter_codes WHERE id=?",codeId);
    if (!code) return "CODE_NOT_FOUND";
    if (code.used) return "ALREADY_USED";
    if (!one("SELECT id FROM candidates WHERE id=?",candidateId)) return "CANDIDATE_NOT_FOUND";
    run("UPDATE voter_codes SET used=1,used_at=? WHERE id=?",now(),codeId);
    run("INSERT INTO votes (candidate_id,voter_code_id,role_id,class_id,department_id,created_at) VALUES (?,?,?,?,?,?)",candidateId,codeId,roleId||null,classId||null,departmentId||null,now());
    return "OK";
});
async function castVote(codeId,candidateId,roleId,classId,deptId) { return castVoteTransaction(codeId,candidateId,roleId,classId,deptId); }
async function countVotes() { return one("SELECT COUNT(*) n FROM votes").n; }

const archiveTransaction=db.transaction((batchId,reason) => {
    const votes=all("SELECT * FROM votes");
    const archive=db.prepare("INSERT INTO votes_archive (id,candidate_id,voter_code_id,role_id,class_id,department_id,original_created_at,archived_at,batch_id,deleted_reason) VALUES (?,?,?,?,?,?,?,?,?,?)");
    votes.forEach(v => archive.run(v.id,v.candidate_id,v.voter_code_id,v.role_id,v.class_id,v.department_id,v.created_at,now(),batchId,reason));
    run("DELETE FROM votes"); return votes.length;
});
async function archiveAndClearVotes(batchId,reason) { return archiveTransaction(batchId,reason); }
const restoreTransaction=db.transaction(() => {
    const latest=one("SELECT batch_id FROM votes_archive ORDER BY archived_at DESC,id DESC LIMIT 1"); if (!latest) return 0;
    const rows=all("SELECT * FROM votes_archive WHERE batch_id=?",latest.batch_id);
    const restore=db.prepare("INSERT INTO votes (id,candidate_id,voter_code_id,role_id,class_id,department_id,created_at) VALUES (?,?,?,?,?,?,?)");
    rows.forEach(v => restore.run(v.id,v.candidate_id,v.voter_code_id,v.role_id,v.class_id,v.department_id,v.original_created_at));
    const ids=rows.map(v=>v.voter_code_id); if(ids.length) run(`UPDATE voter_codes SET used=1,used_at=? WHERE id IN (${ids.map(()=>"?").join(",")})`,now(),...ids);
    run("DELETE FROM votes_archive WHERE batch_id=?",latest.batch_id); return rows.length;
});
async function restoreLastBatch() { return restoreTransaction(); }
async function getArchiveBatches() { return all("SELECT batch_id,archived_at,deleted_reason FROM votes_archive ORDER BY archived_at DESC,id DESC"); }

function resultBase() {
    const candidates=all("SELECT c.id,c.number,c.name,COUNT(v.id) total FROM candidates c LEFT JOIN votes v ON v.candidate_id=c.id GROUP BY c.id ORDER BY c.number");
    const roles=all("SELECT r.id,r.name role,COUNT(v.id) total FROM voter_roles r LEFT JOIN votes v ON v.role_id=r.id GROUP BY r.id ORDER BY r.id");
    const studentClasses=all("SELECT c.id,c.name,c.name displayName,COUNT(v.id) total FROM voter_classes c LEFT JOIN votes v ON v.class_id=c.id AND v.role_id=(SELECT id FROM voter_roles WHERE name='SISWA' LIMIT 1) GROUP BY c.id ORDER BY c.id");
    return { totalVotes:one("SELECT COUNT(*) n FROM votes").n,candidates,roles,nonStudents:roles.filter(r=>r.role.toUpperCase()!=="SISWA").map(r=>({id:r.id,role:r.role,displayName:r.role,total:r.total})),studentClasses };
}
async function buildResultsData() { return resultBase(); }
async function buildAdminResultsData() {
    const base=resultBase();
    const classes=all("SELECT c.id,c.name,COUNT(v.id) total FROM voter_classes c LEFT JOIN votes v ON v.class_id=c.id GROUP BY c.id ORDER BY c.id");
    const departments=all("SELECT d.id,d.name,c.name className,COUNT(v.id) total FROM voter_departments d JOIN voter_classes c ON c.id=d.class_id LEFT JOIN votes v ON v.department_id=d.id GROUP BY d.id ORDER BY d.class_id,d.name");
    return {...base,classes,departments};
}
async function writeAuditLog(action,detail,rowsAffected,ip,status) { run("INSERT INTO admin_log (action,detail,election_status,rows_affected,ip,created_at) VALUES (?,?,?,?,?,?)",String(action).slice(0,100),detail?String(detail).slice(0,500):null,status||null,Number(rowsAffected)||0,ip||null,now()); }
async function getAuditLogs() { return all("SELECT id,action,detail,election_status,rows_affected,ip,created_at FROM admin_log ORDER BY id DESC LIMIT 100"); }

module.exports={
    getElectionSettings,getElectionStatus,setElectionStatus,setPublished,setHeroImage,
    getCandidates,getCandidateById,getCandidateByNumber,candidateNumberExists,insertCandidate,updateCandidate,deleteCandidate,countVotesForCandidate,
    getRoles,getRoleById,updateRoleActive,getClasses,getClassById,insertClass,deleteClass,classIsUsed,getDepartments,insertDepartment,deleteDepartment,deptIsUsed,
    getCodesWithMeta,getAllExistingCodes,insertCodes,getCodeByString,getCodeById,deleteCodeById,deleteAllActiveCodes,deleteCodesByIds,countCodes,countActiveCodesOnly,resetAllCodes,
    castVote,countVotes,archiveAndClearVotes,restoreLastBatch,getArchiveBatches,buildResultsData,buildAdminResultsData,writeAuditLog,getAuditLogs
};


