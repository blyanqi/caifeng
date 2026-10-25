export function uid(prefix = 'id') {
  const random =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12)
  return `${prefix}-${random}`
}

const pad = (value) => String(value).padStart(2, '0')

export function parseDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)
  const normalized = String(value).includes(' ') && !String(value).includes('T')
    ? String(value).replace(' ', 'T')
    : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export function localDateTime(date = new Date(), withSeconds = true) {
  const d = date instanceof Date ? date : parseDate(date) || new Date()
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
  return withSeconds ? `${base}:${pad(d.getSeconds())}` : base
}

export function formatDateTime(value, options = {}) {
  const date = parseDate(value)
  if (!date) return '—'
  const { withYear = false, withSeconds = false, short = false } = options
  const datePart = withYear
    ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    : `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const timePart = `${pad(date.getHours())}:${pad(date.getMinutes())}${
    withSeconds ? `:${pad(date.getSeconds())}` : ''
  }`
  return short ? timePart : `${datePart} ${timePart}`
}

export function formatTime(value) {
  const date = parseDate(value)
  if (!date) return '—'
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function fromNow(value) {
  const date = parseDate(value)
  if (!date) return '—'
  const diff = Date.now() - date.getTime()
  if (diff < 0) {
    const ahead = Math.abs(diff)
    if (ahead < 60 * 1000) return '即将'
    if (ahead < 60 * 60 * 1000) return `${Math.round(ahead / 60000)} 分钟后`
    if (ahead < 24 * 60 * 60 * 1000) return `${Math.round(ahead / 3600000)} 小时后`
    return `${Math.round(ahead / 86400000)} 天后`
  }
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)} 天前`
  return formatDateTime(value)
}

export function formatNumber(value) {
  const n = Number(value || 0)
  return n.toLocaleString('zh-CN')
}

export function hostOf(value) {
  if (!value) return '未设置'
  if (value.startsWith('/')) return '本地沙盒'
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return value.replace(/^https?:\/\//, '').split('/')[0] || value
  }
}

export function truncate(value, length = 32) {
  if (value === null || value === undefined) return '—'
  const text = String(value)
  return text.length > length ? `${text.slice(0, length)}…` : text
}

export function fileSafeName(value) {
  return (
    String(value || 'collected-data')
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'collected-data'
  )
}

export function downloadBlob(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function cellValue(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function csvCell(value) {
  const text = cellValue(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(records = []) {
  if (!Array.isArray(records) || !records.length) return ''
  const keys = []
  records.slice(0, 50).forEach((record) => {
    if (record && typeof record === 'object' && !Array.isArray(record)) {
      Object.keys(record).forEach((key) => {
        if (!keys.includes(key) && keys.length < 40) keys.push(key)
      })
    }
  })
  if (!keys.length) return records.map((item) => csvCell(item)).join('\n')

  const lines = [keys.map(csvCell).join(',')]
  records.forEach((record) => {
    lines.push(
      keys
        .map((key) => {
          if (record && typeof record === 'object') return csvCell(record[key])
          return csvCell(record)
        })
        .join(','),
    )
  })
  return `\uFEFF${lines.join('\r\n')}`
}

export function recordKeys(records = []) {
  const keys = []
  records.slice(0, 20).forEach((record) => {
    if (record && typeof record === 'object' && !Array.isArray(record)) {
      Object.keys(record).forEach((key) => {
        if (!keys.includes(key)) keys.push(key)
      })
    }
  })
  return keys
}
