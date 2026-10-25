export async function copyText(text) {
  const value = String(text ?? '')
  if (!value) return false
  try {
    if (navigator.clipboard?.writeText) {
      let timer = null
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('clipboard-timeout')), 1200)
      })
      try {
        await Promise.race([navigator.clipboard.writeText(value), timeout])
        return true
      } finally {
        if (timer) clearTimeout(timer)
      }
    }
  } catch {
    // fall through to legacy copy
  }
  try {
    const input = document.createElement('textarea')
    input.value = value
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.appendChild(input)
    input.select()
    const ok = document.execCommand('copy')
    input.remove()
    return ok
  } catch {
    return false
  }
}
