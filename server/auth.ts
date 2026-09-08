import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

export type Identity = { userId: string }
export type Authenticate = (req: Request) => Promise<Identity | null>

export function createAuthenticator(clientId?: string, hostname = 'api.workos.com', keySet?: JWTVerifyGetKey): Authenticate {
  const issuer = `https://${hostname}`
  const keys = clientId ? keySet ?? createRemoteJWKSet(new URL(`${issuer}/sso/jwks/${clientId}`)) : null
  return async (req) => {
    const socketToken = req.headers.get('sec-websocket-protocol')?.split(',')
      .map((p) => p.trim()).find((p) => p.startsWith('heval-auth.'))?.slice(11)
    const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1] || socketToken
    if (!token || !keys) return null
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer: [issuer, `${issuer}/`], requiredClaims: ['sub', 'exp'],
      })
      return payload.client_id === clientId && typeof payload.sub === 'string' && payload.sub.trim()
        ? { userId: payload.sub } : null
    } catch { return null }
  }
}
