/** Only a capability-bearing loopback setup page may receive an account pairing. */
export function localSetupUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.username || url.password || url.search || !/^#token=[a-f0-9]{64}$/.test(url.hash)) return null
    return url.href
  } catch { return null }
}
