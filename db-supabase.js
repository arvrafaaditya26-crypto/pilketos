"use strict";

const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diatur.");
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

function checked(result) {
    if (result.error) throw result.error;
    return result.data;
}
function first(data) { return Array.isArray(data) ? (data[0] || null) : (data || null); }
async function rowCount(query) { const result = await query; if (result.error) throw result.error; return result.count || 0; }
function roleOrder(rows) {
    const rank = { SISWA: 1, GURU: 2, STAFF: 3 };
    return rows.sort((a,b) => (rank[a.name] || 99) - (rank[b.name] || 99) || String(a.name).localeCompare(String(b.name)));
}
function mapCode(row) {
    return { ...row,
        voter_roles: row.voter_roles || null,
        voter_classes: row.voter_classes || null,
        voter_departments: row.voter_departments || null
    };
}

async function getElectionSettings() {
    const data = checked(await supabase.from("election_settings").select("status,published,hero_image").eq("id", 1).single());
    return { status: data.status, published: Number(data.published), heroImage: data.hero_image || null };
}
async function getElectionStatus() { return (await getElectionSettings()).status; }
async function setElectionStatus(status) { checked(await supabase.from("election_settings").update({ status, updated_at: new Date().toISOString() }).eq("id", 1)); }
async function setPublished(value) { checked(await supabase.from("election_settings").update({ published: value ? 1 : 0 }).eq("id", 1)); }
async function setHeroImage(url) { checked(await supabase.from("election_settings").update({ hero_image: url }).eq("id", 1)); }

async function getCandidates() { return checked(await supabase.from("candidates").select("*").order("number")); }
async function getCandidateById(id) { return first(checked(await supabase.from("candidates").select("*").eq("id", id).limit(1))); }
async function getCandidateByNumber(number) { return first(checked(await supabase.from("candidates").select("*").eq("number", number).limit(1))); }
async function candidateNumberExists(number, excludeId = null) {
    let q = supabase.from("candidates").select("id").eq("number", number);
    if (excludeId != null) q = q.neq("id", excludeId);
    return (checked(await q.limit(1))).length > 0;
}
async function insertCandidate(number, name, chairman, vice, photo) { return first(checked(await supabase.from("candidates").insert({ number, name, chairman, vice, photo: photo || null }).select("*").single())); }
async function updateCandidate(id, fields) { return first(checked(await supabase.from("candidates").update({ number: fields.number, name: fields.name, chairman: fields.chairman, vice: fields.vice, photo: fields.photo || null }).eq("id", id).select("*").single())); }
async function deleteCandidate(id) { checked(await supabase.from("candidates").delete().eq("id", id)); }
async function countVotesForCandidate(id) { return rowCount(supabase.from("votes").select("id", { count: "exact", head: true }).eq("candidate_id", id)); }

async function getRoles(activeOnly = false) { let q = supabase.from("voter_roles").select("id,name,active"); if (activeOnly) q = q.eq("active", 1); return roleOrder(checked(await q)); }
async function getRoleById(id) { return first(checked(await supabase.from("voter_roles").select("id,name,active").eq("id", id).limit(1))); }
async function updateRoleActive(id, active) { checked(await supabase.from("voter_roles").update({ active: active ? 1 : 0 }).eq("id", id)); }
async function getClasses(activeOnly = false) { let q = supabase.from("voter_classes").select("id,name,active").order("id"); if (activeOnly) q = q.eq("active", 1); return checked(await q); }
async function getClassById(id) { return first(checked(await supabase.from("voter_classes").select("id,name,active").eq("id", id).limit(1))); }
async function insertClass(name) { return first(checked(await supabase.from("voter_classes").insert({ name, active: 1 }).select("id,name,active").single())); }
async function deleteClass(id) { checked(await supabase.from("voter_classes").delete().eq("id", id)); }
async function classIsUsed(id) { const [codes,votes] = await Promise.all([rowCount(supabase.from("voter_codes").select("id",{count:"exact",head:true}).eq("class_id",id)),rowCount(supabase.from("votes").select("id",{count:"exact",head:true}).eq("class_id",id))]); return codes + votes > 0; }

async function getDepartments() {
    const rows = checked(await supabase.from("voter_departments").select("id,class_id,name,active,voter_classes(name,active)").order("class_id").order("name"));
    return rows.map(r => ({ ...r, voter_classes: r.voter_classes || null }));
}
async function insertDepartment(classId, name) { return first(checked(await supabase.from("voter_departments").insert({ class_id: classId, name, active: 1 }).select("id,class_id,name,active").single())); }
async function deleteDepartment(id) { checked(await supabase.from("voter_departments").delete().eq("id", id)); }
async function deptIsUsed(id) { const [codes,votes] = await Promise.all([rowCount(supabase.from("voter_codes").select("id",{count:"exact",head:true}).eq("department_id",id)),rowCount(supabase.from("votes").select("id",{count:"exact",head:true}).eq("department_id",id))]); return codes + votes > 0; }

const codeSelect = "id,code,used,created_at,used_at,role_id,class_id,department_id,voter_roles(id,name,active),voter_classes(id,name,active),voter_departments(id,name,active,class_id)";
async function getCodeByString(code) { return codeByFilter("code", code); }
async function codeByFilter(column, value) { const row = first(checked(await supabase.from("voter_codes").select(codeSelect).eq(column, value).limit(1))); return row ? mapCode(row) : null; }
async function getCodeById(id) { return codeByFilter("id", id); }
async function getCodesWithMeta() { return checked(await supabase.from("voter_codes").select(codeSelect).order("id", { ascending: false })).map(mapCode); }
async function getAllExistingCodes() { return new Set(checked(await supabase.from("voter_codes").select("code")).map(r => r.code)); }
async function insertCodes(rows) { if (!rows.length) return; checked(await supabase.from("voter_codes").insert(rows.map(r => ({ ...r, created_at: new Date().toISOString() })))); }
async function deleteCodeById(id) { checked(await supabase.from("voter_codes").delete().eq("id", id)); }
async function deleteAllActiveCodes() { const before = await rowCount(supabase.from("voter_codes").select("id",{count:"exact",head:true}).eq("used",0)); checked(await supabase.from("voter_codes").delete().eq("used",0)); return before; }
async function deleteCodesByIds(ids) { if(!ids.length) return 0; const before = await rowCount(supabase.from("voter_codes").select("id",{count:"exact",head:true}).in("id",ids).eq("used",0)); checked(await supabase.from("voter_codes").delete().in("id",ids).eq("used",0)); return before; }
async function countCodes() { const [all,used] = await Promise.all([supabase.from("voter_codes").select("id",{count:"exact",head:true}),supabase.from("voter_codes").select("id",{count:"exact",head:true}).eq("used",1)]); if(all.error) throw all.error; if(used.error) throw used.error; return { total: all.count || 0, used: used.count || 0, active: (all.count || 0) - (used.count || 0) }; }
async function countActiveCodesOnly() { return rowCount(supabase.from("voter_codes").select("id",{count:"exact",head:true}).eq("used",0)); }
async function resetAllCodes() { checked(await supabase.from("voter_codes").update({ used: 0, used_at: null }).eq("used", 1)); }

async function castVote(codeId, candidateId, roleId, classId, deptId) { const data = checked(await supabase.rpc("cast_vote", { p_code_id: codeId, p_candidate_id: candidateId, p_role_id: roleId || null, p_class_id: classId || null, p_dept_id: deptId || null })); return data; }
async function countVotes() { return rowCount(supabase.from("votes").select("id",{count:"exact",head:true})); }

async function archiveAndClearVotes(batchId, reason) {
    const votes = checked(await supabase.from("votes").select("*"));
    if (votes.length) checked(await supabase.from("votes_archive").insert(votes.map(v => ({ id:v.id, candidate_id:v.candidate_id, voter_code_id:v.voter_code_id, role_id:v.role_id, class_id:v.class_id, department_id:v.department_id, original_created_at:v.created_at, batch_id:batchId, deleted_reason:reason }))));
    if (votes.length) checked(await supabase.from("votes").delete().not("id", "is", null));
    return votes.length;
}
async function restoreLastBatch() {
    const latest = first(checked(await supabase.from("votes_archive").select("batch_id").order("archived_at",{ascending:false}).limit(1)));
    if (!latest) return 0;
    const rows = checked(await supabase.from("votes_archive").select("*").eq("batch_id", latest.batch_id));
    if (rows.length) { checked(await supabase.from("votes").insert(rows.map(v => ({ candidate_id:v.candidate_id,voter_code_id:v.voter_code_id,role_id:v.role_id,class_id:v.class_id,department_id:v.department_id,created_at:v.original_created_at })))); checked(await supabase.from("voter_codes").update({used:1,used_at:new Date().toISOString()}).in("id",rows.map(v=>v.voter_code_id))); checked(await supabase.from("votes_archive").delete().eq("batch_id",latest.batch_id)); }
    return rows.length;
}
async function getArchiveBatches() { return checked(await supabase.from("votes_archive").select("batch_id,archived_at,deleted_reason").order("archived_at",{ascending:false})); }

async function resultData(includeAdmin = false) {
    const [candidates,votes,roles,classes,depts] = await Promise.all([getCandidates(),supabase.from("votes").select("candidate_id,role_id,class_id,department_id"),getRoles(),getClasses(),getDepartments()]);
    const voteRows = checked(votes);
    const count = (key, value) => voteRows.filter(v => v[key] === value).length;
    const candidateRows = candidates.map(c => ({...c,total:count("candidate_id",c.id)}));
    const roleRows = roles.map(r => ({id:r.id,role:r.name,total:count("role_id",r.id)}));
    const studentRole = roles.find(r => r.name.toUpperCase() === "SISWA");
    const studentClasses = classes.map(c => ({id:c.id,name:c.name,displayName:c.name,total:voteRows.filter(v=>v.class_id===c.id && (!studentRole || v.role_id===studentRole.id)).length}));
    const base = { totalVotes: voteRows.length, candidates:candidateRows, roles:roleRows, nonStudents:roleRows.filter(r=>r.role.toUpperCase()!=="SISWA").map(r=>({id:r.id,role:r.role,displayName:r.role,total:r.total})), studentClasses };
    if (!includeAdmin) return base;
    return {...base, classes:classes.map(c=>({id:c.id,name:c.name,total:count("class_id",c.id)})), departments:depts.map(d=>({id:d.id,name:d.name,className:d.voter_classes?.name || "",total:count("department_id",d.id)}))};
}
async function buildResultsData() { return resultData(false); }
async function buildAdminResultsData() { return resultData(true); }
async function writeAuditLog(action,detail,rowsAffected,ip,status) { checked(await supabase.from("admin_log").insert({action:String(action).slice(0,100),detail:detail?String(detail).slice(0,500):null,election_status:status||null,rows_affected:Number(rowsAffected)||0,ip:ip||null})); }
async function getAuditLogs() { return checked(await supabase.from("admin_log").select("id,action,detail,election_status,rows_affected,ip,created_at").order("id",{ascending:false}).limit(100)); }

module.exports = { getElectionSettings,getElectionStatus,setElectionStatus,setPublished,setHeroImage,getCandidates,getCandidateById,getCandidateByNumber,candidateNumberExists,insertCandidate,updateCandidate,deleteCandidate,countVotesForCandidate,getRoles,getRoleById,updateRoleActive,getClasses,getClassById,insertClass,deleteClass,classIsUsed,getDepartments,insertDepartment,deleteDepartment,deptIsUsed,getCodesWithMeta,getAllExistingCodes,insertCodes,getCodeByString,getCodeById,deleteCodeById,deleteAllActiveCodes,deleteCodesByIds,countCodes,countActiveCodesOnly,resetAllCodes,castVote,countVotes,archiveAndClearVotes,restoreLastBatch,getArchiveBatches,buildResultsData,buildAdminResultsData,writeAuditLog,getAuditLogs };




