export async function resolveRiskProfile(profileId, url, taskId = '') {
  if (!profileId) return null
  const response = await fetch('/api/risk/resolve', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, url, taskId }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || '风控处理失败')
  }
  return payload
}
