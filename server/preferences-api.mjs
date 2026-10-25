import { db, nowIso } from './db.mjs'
import { requireUser } from './auth.mjs'
import { readJsonBody, sendError, sendJson } from './http.mjs'

const THEMES = ['light', 'dark', 'system']
const ACCENTS = ['indigo', 'blue', 'teal', 'rose', 'amber']
const LANGUAGES = ['zh', 'en']
const DENSITIES = ['comfortable', 'compact']

const DEFAULTS = {
  theme: 'system',
  accent: 'indigo',
  language: 'zh',
  density: 'comfortable',
}

function publicPreferences(row) {
  return {
    theme: THEMES.includes(row?.theme) ? row.theme : DEFAULTS.theme,
    accent: ACCENTS.includes(row?.accent) ? row.accent : DEFAULTS.accent,
    language: LANGUAGES.includes(row?.language) ? row.language : DEFAULTS.language,
    density: DENSITIES.includes(row?.density) ? row.density : DEFAULTS.density,
    updatedAt: row?.updated_at || '',
  }
}

export function getPreferences(req, res) {
  const user = requireUser(req, res)
  if (!user) return
  const row = db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(user.id)
  sendJson(res, 200, { ok: true, preferences: publicPreferences(row) })
}

export async function savePreferences(req, res) {
  const user = requireUser(req, res)
  if (!user) return
  const body = await readJsonBody(req)
  const current = db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(user.id)
  const next = publicPreferences({
    theme: THEMES.includes(body.theme) ? body.theme : current?.theme,
    accent: ACCENTS.includes(body.accent) ? body.accent : current?.accent,
    language: LANGUAGES.includes(body.language) ? body.language : current?.language,
    density: DENSITIES.includes(body.density) ? body.density : current?.density,
    updated_at: nowIso(),
  })
  db.prepare(
    `INSERT INTO user_preferences(user_id, theme, accent, language, density, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       theme = excluded.theme,
       accent = excluded.accent,
       language = excluded.language,
       density = excluded.density,
       updated_at = excluded.updated_at`,
  ).run(user.id, next.theme, next.accent, next.language, next.density, nowIso())
  sendJson(res, 200, { ok: true, preferences: next })
}
