import './env.mjs'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(rootDir, 'data')
mkdirSync(dataDir, { recursive: true })
const configuredDbPath = String(process.env.DB_PATH || '').trim()
const dbPath = configuredDbPath
  ? path.isAbsolute(configuredDbPath)
    ? configuredDbPath
    : path.join(rootDir, configuredDbPath)
  : path.join(dataDir, 'app.db')
mkdirSync(path.dirname(dbPath), { recursive: true })

export const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'operator',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        ip TEXT,
        success INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        username TEXT,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        detail TEXT,
        ip TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT
      );

      CREATE TABLE IF NOT EXISTS site_sessions (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'cookie',
        payload_encrypted TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        expires_at TEXT,
        last_checked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS captcha_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider_type TEXT NOT NULL DEFAULT 'custom',
        endpoint TEXT NOT NULL,
        method TEXT NOT NULL DEFAULT 'POST',
        api_key_encrypted TEXT,
        request_template TEXT,
        headers_json TEXT,
        task_id_path TEXT,
        result_path TEXT,
        status_path TEXT,
        success_value TEXT,
        poll_endpoint TEXT,
        poll_method TEXT NOT NULL DEFAULT 'GET',
        poll_template TEXT,
        poll_task_id_param TEXT NOT NULL DEFAULT 'taskId',
        poll_interval_seconds INTEGER NOT NULL DEFAULT 3,
        timeout_seconds INTEGER NOT NULL DEFAULT 120,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS captcha_jobs (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        rule_id TEXT,
        task_id TEXT,
        captcha_type TEXT,
        page_url TEXT,
        provider_task_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        token TEXT,
        cost REAL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        solved_at TEXT,
        FOREIGN KEY (provider_id) REFERENCES captcha_providers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS captcha_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        site_id TEXT,
        config_id TEXT,
        captcha_type TEXT NOT NULL DEFAULT 'image',
        trigger_type TEXT NOT NULL DEFAULT 'keyword',
        trigger_value TEXT,
        provider_id TEXT NOT NULL,
        timeout_seconds INTEGER NOT NULL DEFAULT 120,
        retry_count INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_id) REFERENCES captcha_providers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS api_clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT '[]',
        webhook_url TEXT,
        rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
        ip_allowlist TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS api_jobs (
        id TEXT PRIMARY KEY,
        client_id TEXT,
        task_id TEXT,
        task_name TEXT,
        direction TEXT NOT NULL DEFAULT 'pull',
        status TEXT NOT NULL DEFAULT 'pending',
        payload TEXT,
        result TEXT,
        result_count INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        idempotency_key TEXT,
        claimed_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (client_id) REFERENCES api_clients(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_site_sessions_site ON site_sessions(site_id);
      CREATE INDEX IF NOT EXISTS idx_api_jobs_status ON api_jobs(status, direction);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS risk_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        site_id TEXT,
        risk_type TEXT NOT NULL DEFAULT 'custom',
        strategy TEXT NOT NULL DEFAULT 'custom_api',
        endpoint TEXT,
        method TEXT NOT NULL DEFAULT 'POST',
        api_key_encrypted TEXT,
        headers_json TEXT,
        request_template TEXT,
        cookie_path TEXT,
        token_path TEXT,
        manual_cookie_encrypted TEXT,
        wait_ms INTEGER NOT NULL DEFAULT 3000,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS risk_jobs (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        task_id TEXT,
        url TEXT,
        status TEXT NOT NULL DEFAULT 'success',
        cookies_encrypted TEXT,
        token_text TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        solved_at TEXT,
        FOREIGN KEY (profile_id) REFERENCES risk_profiles(id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT PRIMARY KEY,
        theme TEXT NOT NULL DEFAULT 'system',
        accent TEXT NOT NULL DEFAULT 'indigo',
        language TEXT NOT NULL DEFAULT 'zh',
        density TEXT NOT NULL DEFAULT 'comfortable',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `,
  },
]

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version),
  )
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue
    db.exec('BEGIN')
    try {
      db.exec(migration.sql)
      db.prepare(
        'INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)',
      ).run(migration.version, new Date().toISOString())
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

migrate()

export function newId(prefix) {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
}

export function nowIso() {
  return new Date().toISOString()
}

export function parseJson(value, fallback = null) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

export function toJson(value) {
  return JSON.stringify(value ?? null)
}
