// One SQLite database via built-in node:sqlite (no native build on the Pi). WAL mode,
// versioned migrations. Every module takes the DatabaseSync handle it is given.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type DB = DatabaseSync;

const MIGRATIONS: string[] = [
  // 1 — core
  `
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    objective TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'chat',
    agent_id TEXT,
    project TEXT,
    source TEXT NOT NULL DEFAULT 'dashboard',
    state TEXT NOT NULL DEFAULT 'queued',
    plan TEXT,
    result TEXT,
    report TEXT,
    error TEXT,
    signature TEXT,
    parent_id INTEGER,
    chat_id TEXT,
    key TEXT UNIQUE,
    archived INTEGER NOT NULL DEFAULT 0,
    dismissed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX tasks_state ON tasks(state, archived);
  CREATE INDEX tasks_agent ON tasks(agent_id, created_at);

  CREATE TABLE steps (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id),
    idx INTEGER NOT NULL,
    tool TEXT NOT NULL,
    args TEXT NOT NULL DEFAULT '{}',
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    output TEXT,
    data TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    finished_at TEXT,
    UNIQUE(task_id, idx)
  );

  CREATE TABLE costs (
    id INTEGER PRIMARY KEY,
    ts TEXT NOT NULL,
    day TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    kind TEXT,
    agent_id TEXT,
    task_id INTEGER,
    usd REAL NOT NULL DEFAULT 0,
    tokens INTEGER NOT NULL DEFAULT 0,
    cloud INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX costs_day ON costs(day, agent_id);

  CREATE TABLE knowledge (
    id INTEGER PRIMARY KEY,
    project TEXT NOT NULL DEFAULT 'general',
    kind TEXT NOT NULL DEFAULT 'fact',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'ren2',
    path TEXT UNIQUE,
    mtime REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE knowledge_fts USING fts5(title, body, project, kind, content='knowledge', content_rowid='id');
  CREATE TRIGGER knowledge_ai AFTER INSERT ON knowledge BEGIN
    INSERT INTO knowledge_fts(rowid, title, body, project, kind) VALUES (new.id, new.title, new.body, new.project, new.kind);
  END;
  CREATE TRIGGER knowledge_ad AFTER DELETE ON knowledge BEGIN
    INSERT INTO knowledge_fts(knowledge_fts, rowid, title, body, project, kind) VALUES ('delete', old.id, old.title, old.body, old.project, old.kind);
  END;
  CREATE TRIGGER knowledge_au AFTER UPDATE ON knowledge BEGIN
    INSERT INTO knowledge_fts(knowledge_fts, rowid, title, body, project, kind) VALUES ('delete', old.id, old.title, old.body, old.project, old.kind);
    INSERT INTO knowledge_fts(rowid, title, body, project, kind) VALUES (new.id, new.title, new.body, new.project, new.kind);
  END;

  CREATE TABLE decisions (
    id INTEGER PRIMARY KEY,
    task_id INTEGER,
    step_idx INTEGER,
    agent_id TEXT,
    gate TEXT NOT NULL,
    action_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    preview TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    response TEXT,
    reminded INTEGER NOT NULL DEFAULT 0,
    tg_message_id TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE INDEX decisions_status ON decisions(status);

  CREATE TABLE agents_state (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'running',
    schedule_paused INTEGER NOT NULL DEFAULT 0,
    last_run_at TEXT,
    last_slot TEXT,
    last_task_id INTEGER
  );

  CREATE TABLE playbook_versions (
    id INTEGER PRIMARY KEY,
    agent_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    body TEXT NOT NULL,
    reason TEXT,
    active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(agent_id, version)
  );

  CREATE TABLE failures (
    signature TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    agent_id TEXT,
    item_task_id INTEGER,
    notified INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE alerts (
    id INTEGER PRIMARY KEY,
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    key TEXT,
    dismissed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE chat (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    task_id INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE drafts (
    id INTEGER PRIMARY KEY,
    platform TEXT NOT NULL,
    agent_id TEXT,
    task_id INTEGER,
    project TEXT,
    text TEXT NOT NULL,
    media TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    external_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  // 2 — agents working together: messages (inbox / team board) + jobs
  `
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'fyi',
    subject TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    project TEXT,
    status TEXT NOT NULL DEFAULT 'unread',
    task_id INTEGER,
    origin_task_id INTEGER,
    reply_to INTEGER,
    key TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX messages_to ON messages(to_agent, status);
  ALTER TABLE tasks ADD COLUMN message_id INTEGER;
  ALTER TABLE tasks ADD COLUMN job_id TEXT;
  CREATE TABLE job_state (
    agent_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    last_slot TEXT,
    last_run_at TEXT,
    last_task_id INTEGER,
    PRIMARY KEY (agent_id, job_id)
  );
  `,
  // 3 — Ren as head: plans, site reviews, request priority + idle-only work
  `
  ALTER TABLE messages ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE messages ADD COLUMN idle_only INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE plans (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'daily',
    headline TEXT NOT NULL,
    items TEXT NOT NULL DEFAULT '[]',
    questions TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'model',
    task_id INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE TABLE reviews (
    id INTEGER PRIMARY KEY,
    site_id TEXT NOT NULL,
    title TEXT NOT NULL,
    niche TEXT,
    candidate_id TEXT,
    preview_url TEXT,
    ren_notes TEXT,
    kevin_good TEXT,
    kevin_change TEXT,
    kevin_add TEXT,
    verdict TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    task_id INTEGER,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
  `,
];

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db: DB): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  const row = db.prepare('SELECT v FROM schema_version').get() as { v: number } | undefined;
  let v = row?.v ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (v) VALUES (0)').run();
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      v += 1;
      db.prepare('UPDATE schema_version SET v = ?').run(v);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return v;
}

export function kvGet(db: DB, key: string): string | undefined {
  return (db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}
export function kvSet(db: DB, key: string, value: string): void {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
export function kvDel(db: DB, key: string): void {
  db.prepare('DELETE FROM kv WHERE key = ?').run(key);
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
