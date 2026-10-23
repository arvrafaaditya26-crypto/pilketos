-- ============================================================
--  PILKETOS 2026 — Supabase / PostgreSQL Schema
--  Jalankan seluruh file ini di Supabase SQL Editor
--  (Dashboard → SQL Editor → New query → paste → Run)
-- ============================================================

-- ── Ekstensi ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()

-- ── Tabel utama ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS election_settings (
    id              INTEGER PRIMARY KEY DEFAULT 1,
    status          TEXT    NOT NULL DEFAULT 'DRAFT',
    published       INTEGER NOT NULL DEFAULT 0,
    hero_image      TEXT,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT election_settings_single_row CHECK (id = 1)
);
INSERT INTO election_settings (id, status) VALUES (1, 'DRAFT')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS candidates (
    id          SERIAL PRIMARY KEY,
    number      INTEGER NOT NULL UNIQUE,
    name        TEXT    NOT NULL,
    chairman    TEXT    NOT NULL,
    vice        TEXT    NOT NULL,
    photo       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS voter_roles (
    id     SERIAL PRIMARY KEY,
    name   TEXT    NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1
);
INSERT INTO voter_roles (name, active) VALUES
    ('SISWA', 1), ('GURU', 1), ('STAFF', 1)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS voter_classes (
    id     SERIAL PRIMARY KEY,
    name   TEXT    NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1
);
INSERT INTO voter_classes (name, active) VALUES
    ('Kelas 10', 1), ('Kelas 11', 1), ('Kelas 12', 1)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS voter_departments (
    id       SERIAL PRIMARY KEY,
    class_id INTEGER NOT NULL REFERENCES voter_classes(id) ON DELETE CASCADE,
    name     TEXT    NOT NULL,
    active   INTEGER NOT NULL DEFAULT 1,
    UNIQUE (class_id, name)
);

CREATE TABLE IF NOT EXISTS voter_codes (
    id            SERIAL PRIMARY KEY,
    code          TEXT    NOT NULL UNIQUE,
    role_id       INTEGER REFERENCES voter_roles(id),
    class_id      INTEGER REFERENCES voter_classes(id),
    department_id INTEGER REFERENCES voter_departments(id),
    used          INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    used_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS votes (
    id             SERIAL PRIMARY KEY,
    candidate_id   INTEGER NOT NULL REFERENCES candidates(id),
    voter_code_id  INTEGER NOT NULL UNIQUE REFERENCES voter_codes(id),
    role_id        INTEGER REFERENCES voter_roles(id),
    class_id       INTEGER REFERENCES voter_classes(id),
    department_id  INTEGER REFERENCES voter_departments(id),
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS votes_archive (
    id                  INTEGER PRIMARY KEY,
    candidate_id        INTEGER NOT NULL,
    voter_code_id       INTEGER NOT NULL,
    role_id             INTEGER,
    class_id            INTEGER,
    department_id       INTEGER,
    original_created_at TIMESTAMPTZ,
    archived_at         TIMESTAMPTZ DEFAULT NOW(),
    batch_id            TEXT NOT NULL,
    deleted_reason      TEXT
);

CREATE TABLE IF NOT EXISTS admin_log (
    id               SERIAL PRIMARY KEY,
    action           TEXT NOT NULL,
    detail           TEXT,
    election_status  TEXT,
    rows_affected    INTEGER DEFAULT 0,
    ip               TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Row Level Security (nonaktifkan untuk service_role key) ─
-- Server memakai service_role key yang melewati RLS,
-- jadi tidak perlu policy khusus. Tapi aktifkan RLS
-- agar anon key tidak bisa akses langsung dari browser.
ALTER TABLE election_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE voter_roles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE voter_classes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE voter_departments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE voter_codes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes_archive      ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_log          ENABLE ROW LEVEL SECURITY;

-- ── Index untuk performa ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_voter_codes_code    ON voter_codes(code);
CREATE INDEX IF NOT EXISTS idx_voter_codes_used    ON voter_codes(used);
CREATE INDEX IF NOT EXISTS idx_votes_candidate     ON votes(candidate_id);
CREATE INDEX IF NOT EXISTS idx_votes_role          ON votes(role_id);
CREATE INDEX IF NOT EXISTS idx_votes_class         ON votes(class_id);
CREATE INDEX IF NOT EXISTS idx_admin_log_created   ON admin_log(created_at DESC);

-- ── Fungsi atomik: cast vote (mencegah race condition) ────
-- Dipanggil dari server lewat supabase.rpc('cast_vote', {...})
CREATE OR REPLACE FUNCTION cast_vote(
    p_code_id     INTEGER,
    p_candidate_id INTEGER,
    p_role_id     INTEGER,
    p_class_id    INTEGER,
    p_dept_id     INTEGER
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_used INTEGER;
BEGIN
    -- Lock baris kode pemilih
    SELECT used INTO v_used FROM voter_codes WHERE id = p_code_id FOR UPDATE;

    IF v_used IS NULL THEN
        RETURN 'CODE_NOT_FOUND';
    END IF;

    IF v_used = 1 THEN
        RETURN 'ALREADY_USED';
    END IF;

    -- Tandai kode sebagai terpakai
    UPDATE voter_codes
    SET used = 1, used_at = NOW()
    WHERE id = p_code_id;

    -- Catat suara
    INSERT INTO votes (candidate_id, voter_code_id, role_id, class_id, department_id)
    VALUES (p_candidate_id, p_code_id, p_role_id, p_class_id, p_dept_id);

    RETURN 'OK';
END;
$$;
