export type LocalPreferences = {
  email?: string
  hasJoined?: boolean
}

const key = 'heval:preferences'

export const localStorageAdapter = {
  read(): LocalPreferences {
    try {
      return JSON.parse(window.localStorage.getItem(key) ?? '{}') as LocalPreferences
    } catch {
      return {}
    }
  },
  write(value: LocalPreferences) {
    window.localStorage.setItem(key, JSON.stringify(value))
  },
}
