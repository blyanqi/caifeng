import { store } from '../stores/collector'
import { normalizeHeaderRotation } from './schedule'

export function headersOf(header) {
  const headers = {}
  ;(header?.rows || [])
    .filter((row) => row.enabled !== false && row.key?.trim())
    .forEach((row) => {
      headers[row.key.trim()] = row.value ?? ''
    })
  return headers
}

export function resolveHeader(config, fallbackHeader) {
  const rotation = normalizeHeaderRotation(config)
  if (!rotation.enabled || !rotation.headerIds.length) {
    return {
      header: fallbackHeader || null,
      rotation,
      rotated: false,
    }
  }
  const candidates = rotation.headerIds
    .map((id) => store.headers.find((header) => header.id === id))
    .filter(Boolean)
  if (!candidates.length) {
    return {
      header: fallbackHeader || null,
      rotation,
      rotated: false,
    }
  }

  let index = 0
  if (rotation.strategy === 'random') {
    index = Math.floor(Math.random() * candidates.length)
  } else {
    index = rotation.cursor % candidates.length
  }
  const nextCursor = (index + 1) % candidates.length
  config.headerRotation = {
    ...rotation,
    cursor: nextCursor,
  }
  return {
    header: candidates[index],
    rotation,
    rotated: true,
  }
}
