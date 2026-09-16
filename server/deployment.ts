export function deploymentPolicy(env: Record<string, string | undefined>) {
  const hosted = env.HEVAL_HOSTED === '1'
  const allowedUsers = hosted ? new Set((env.HEVAL_ALLOWED_USER_IDS || '').split(',').map(value => value.trim()).filter(Boolean)) : undefined
  if (hosted) {
    const origin = new URL(env.HEVAL_PUBLIC_ORIGIN || '')
    if (origin.protocol !== 'https:' || origin.origin !== env.HEVAL_PUBLIC_ORIGIN) throw new Error('HEVAL_PUBLIC_ORIGIN must be an exact HTTPS origin')
    if (!env.HEVAL_DATA_DIR) throw new Error('Hosted mode requires HEVAL_DATA_DIR on persistent storage')
    if (env.HEVAL_ENABLE_RUNNER === '1' && (!env.WORKOS_CLIENT_ID || !allowedUsers?.size || !env.DOCKER_HOST?.startsWith('ssh://'))) throw new Error('Hosted evaluations require WorkOS, invited user IDs, and a separate SSH Docker worker host')
  }
  return { hosted, allowedUsers, origin: env.HEVAL_PUBLIC_ORIGIN }
}
