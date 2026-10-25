export const PARAM_VALUE_TYPES = ['text', 'timestamp', 'list']

export const TIMESTAMP_FORMATS = [
  { value: 'unix_ms', label: 'Unix 毫秒' },
  { value: 'unix_s', label: 'Unix 秒' },
  { value: 'datetime', label: '日期时间' },
  { value: 'date', label: '日期' },
  { value: 'iso', label: 'ISO 8601' },
]

const MAX_LIST_ITEMS = 5000

function pad(value) {
  return String(value).padStart(2, '0')
}

export function normalizeTimestampConfig(config = {}) {
  const format = TIMESTAMP_FORMATS.some((item) => item.value === config.format)
    ? config.format
    : 'unix_ms'
  return {
    format,
    timezone: config.timezone === 'utc' ? 'utc' : 'local',
    offsetMinutes: Number.isFinite(Number(config.offsetMinutes))
      ? Number(config.offsetMinutes)
      : 0,
  }
}

export function normalizeListConfig(config = {}) {
  const items = Array.isArray(config.items)
    ? config.items.map((item) => String(item ?? ''))
    : typeof config.items === 'string'
      ? config.items.split(/\r?\n/)
      : []
  return {
    items,
    source: config.source === 'file' ? 'file' : 'manual',
    fileName: String(config.fileName || ''),
  }
}

export function normalizeParamRow(row = {}) {
  const valueType = PARAM_VALUE_TYPES.includes(row.valueType) ? row.valueType : 'text'
  return {
    ...row,
    id: row.id,
    key: String(row.key || ''),
    enabled: row.enabled !== false,
    valueType,
    value: row.value === undefined || row.value === null ? '' : String(row.value),
    timestamp: normalizeTimestampConfig(row.timestamp),
    list: normalizeListConfig(row.list),
  }
}

export function normalizeParamRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map(normalizeParamRow)
}

export function listValues(row) {
  return normalizeListConfig(row?.list)
    .items.map((item) => item.trim())
    .filter(Boolean)
}

export function listCount(row) {
  return listValues(row).length
}

export function listRowsOf(param) {
  return (param?.rows || [])
    .map(normalizeParamRow)
    .filter(
      (row) => row.enabled !== false && row.valueType === 'list' && listValues(row).length > 0,
    )
}

function timestampParts(date, timezone) {
  const useUtc = timezone === 'utc'
  return {
    year: useUtc ? date.getUTCFullYear() : date.getFullYear(),
    month: (useUtc ? date.getUTCMonth() : date.getMonth()) + 1,
    day: useUtc ? date.getUTCDate() : date.getDate(),
    hour: useUtc ? date.getUTCHours() : date.getHours(),
    minute: useUtc ? date.getUTCMinutes() : date.getMinutes(),
    second: useUtc ? date.getUTCSeconds() : date.getSeconds(),
  }
}

export function resolveTimestamp(config = {}, now = new Date()) {
  const normalized = normalizeTimestampConfig(config)
  const offsetMs = normalized.offsetMinutes * 60 * 1000
  const date = new Date(now.getTime() + offsetMs)
  if (normalized.format === 'unix_ms') return String(date.getTime())
  if (normalized.format === 'unix_s') return String(Math.floor(date.getTime() / 1000))
  if (normalized.format === 'iso') return date.toISOString()
  const parts = timestampParts(date, normalized.timezone)
  const day = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
  if (normalized.format === 'date') return day
  return `${day} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`
}

export function resolveParamValue(row, context = {}) {
  const normalized = normalizeParamRow(row)
  if (normalized.valueType === 'timestamp') {
    return resolveTimestamp(normalized.timestamp, context.now || new Date())
  }
  if (normalized.valueType === 'list') {
    const values = listValues(normalized)
    if (!values.length) return ''
    const isDriver = context.iterationRowId && context.iterationRowId === normalized.id
    const index = isDriver ? Math.max(0, Number(context.iterationIndex) || 0) : 0
    return values[index] ?? ''
  }
  return normalized.value
}

export function resolveParamRows(param, context = {}) {
  return (param?.rows || [])
    .map(normalizeParamRow)
    .filter((row) => row.enabled !== false && row.key?.trim())
    .map((row) => ({
      id: row.id,
      key: row.key.trim(),
      valueType: row.valueType,
      value: resolveParamValue(row, context),
      raw: row,
    }))
}

export function iterationInfoOf(task, param) {
  if (!task?.iteration?.enabled) return null
  const row = listRowsOf(param).find((item) => item.id === task.iteration.rowId)
  if (!row) {
    return {
      invalid: true,
      total: 0,
      cursor: 0,
      remaining: 0,
      currentValue: '',
      row: null,
      rowId: task.iteration.rowId,
      rowKey: '',
      completed: true,
    }
  }
  const values = listValues(row)
  const cursor = Math.min(Math.max(Number(task.iteration.cursor) || 0, 0), values.length)
  return {
    invalid: false,
    row,
    rowId: row.id,
    rowKey: row.key,
    total: values.length,
    cursor,
    index: cursor,
    remaining: Math.max(values.length - cursor, 0),
    currentValue: values[cursor] ?? '',
    completed: cursor >= values.length,
  }
}

export function normalizeParamValueForStorage(row) {
  const normalized = normalizeParamRow(row)
  return {
    ...normalized,
    list: {
      ...normalized.list,
      items: normalized.list.items.map((item) => String(item ?? '').trim()).filter(Boolean),
    },
  }
}

function parseCsvRows(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ',') {
      row.push(cell)
      cell = ''
      continue
    }
    if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }
    if (char !== '\r') cell += char
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

function jsonListItems(value) {
  if (!Array.isArray(value)) throw new Error('JSON 文件需要是数组')
  return value.map((item) => {
    if (item && typeof item === 'object') {
      const preferred = ['value', 'name', 'key', 'id', 'keyword']
      const key = preferred.find((candidate) => item[candidate] !== undefined)
      if (key) return String(item[key])
      const first = Object.values(item).find(
        (entry) => typeof entry === 'string' || typeof entry === 'number',
      )
      return first !== undefined ? String(first) : ''
    }
    return String(item ?? '')
  })
}

export function parseListText(text, fileName = '') {
  const content = String(text || '').replace(/^\uFEFF/, '').trim()
  if (!content) throw new Error('列表文件为空')
  const extension = String(fileName).split('.').pop()?.toLowerCase()
  let items = []
  if (extension === 'json') {
    let parsed
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new Error('JSON 列表格式不正确')
    }
    items = jsonListItems(parsed)
  } else if (extension === 'csv') {
    const rows = parseCsvRows(content)
    if (!rows.length) throw new Error('CSV 列表为空')
    const firstCell = String(rows[0]?.[0] || '').trim().toLowerCase()
    const skipHeader =
      rows.length > 1 && /^(value|values|keyword|key|param|参数|参数值)$/.test(firstCell)
    items = (skipHeader ? rows.slice(1) : rows).map((row) => row[0] ?? '')
  } else {
    items = content.split(/\r?\n/)
  }

  const normalized = items.map((item) => String(item).trim()).filter(Boolean)
  if (!normalized.length) throw new Error('列表中没有可用内容')
  return {
    items: normalized.slice(0, MAX_LIST_ITEMS),
    truncated: normalized.length > MAX_LIST_ITEMS,
    total: normalized.length,
  }
}

export async function parseListFile(file) {
  if (!file) throw new Error('没有选择文件')
  if (file.size > 2 * 1024 * 1024) throw new Error('列表文件不能超过 2MB')
  const text = await file.text()
  return parseListText(text, file.name)
}

export function formatParamValuePreview(row, context = {}) {
  const normalized = normalizeParamRow(row)
  if (normalized.valueType === 'timestamp') {
    return resolveTimestamp(normalized.timestamp, context.now || new Date())
  }
  if (normalized.valueType === 'list') {
    const values = listValues(normalized)
    return values[0] || ''
  }
  return normalized.value
}
