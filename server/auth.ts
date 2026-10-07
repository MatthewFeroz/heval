import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

export type Identity = { userId: string }
export type Authenticate = (req: Request) => Promise<Identity | null>

export function createAuthenticator(issuerDomain?: string, authorizedOrigin?: string, keySet?: JWTVerifyGetKey): Authenticate {
  const issuer = issuerDomain?.replace(/\/$/, '')
  const keys = issuer ? keySet ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) : null
  return async (req) => {
    const socketToken = req.headers.get('sec-websocket-protocol')?.split(',')
      .map((p) => p.trim()).find((p) => p.startsWith('heval-auth.'))?.slice(11)
    const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1] || socketToken
    if (!token || !keys) return null
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer, audience: 'convex', algorithms: ['RS256'], requiredClaims: ['sub', 'exp'],
      })
      return (!authorizedOrigin || payload.azp === authorizedOrigin) && typeof payload.sub === 'string' && payload.sub.trim()
        ? { userId: payload.sub } : null
    } catch { return null }
  }
}
