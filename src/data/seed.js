import { localDateTime } from '../utils/format'

export function createSeedState() {
  return {
    version: 2,
    sites: [],
    configs: [],
    headers: [],
    params: [],
    proxies: [],
    storages: [],
    tasks: [],
    runs: [],
    collected: {},
    meta: {
      lastSavedAt: localDateTime(),
      initializedAt: localDateTime(),
    },
  }
}
