import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(rootDir, 'data')
mkdirSync(dataDir, { recursive: true })
const keyFile = path.join(dataDir, '.app-key')

function loadKey() {
  const provided = String(process.env.APP_ENCRYPTION_KEY || '').trim()
  if (provided) {
    const buffer = /^[a-f0-9]{64}$/i.test(provided)
      ? Buffer.from(provided, 'hex')
      : Buffer.from(provided, 'base64')
    if (buffer.length === 32) return buffer
    throw new Error('APP_ENCRYPTION_KEY 必须是 32 字节的 hex 或 base64')
  }
  if (existsSync(keyFile)) {
    const buffer = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64')
    if (buffer.length === 32) return buffer
  }
  const generated = randomBytes(32)
  writeFileSync(keyFile, generated.toString('base64'), { mode: 0o600 })
  return generated
}

const key = loadKey()

export function encryptText(value) {
  const text = String(value ?? '')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

export function decryptText(payload) {
  const raw = String(payload || '')
  if (!raw.startsWith('v1:')) throw new Error('无法识别的加密数据')
  const [, ivText, tagText, dataText] = raw.split(':')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataText, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

export function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(String(password), salt, 64)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password, stored) {
  try {
    const [algorithm, saltText, hashText] = String(stored || '').split('$')
    if (algorithm !== 'scrypt') return false
    const salt = Buffer.from(saltText, 'base64')
    const expected = Buffer.from(hashText, 'base64')
    const actual = scryptSync(String(password), salt, expected.length)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}
