import type { AuthConfig } from 'convex/server'
const clerkIssuer = process.env.CLERK_JWT_ISSUER_DOMAIN
// Keep legacy verification during the coordinated frontend cutover. Remove
// WORKOS_CLIENT_ID only after existing ownership has been mapped and verified.
const clientId = process.env.WORKOS_CLIENT_ID
export default { providers: [
  ...(clerkIssuer ? [{ domain: clerkIssuer, applicationID: 'convex' }] : []),
  ...(clientId ? [
    { type: 'customJwt' as const, issuer: 'https://api.workos.com/', algorithm: 'RS256' as const, jwks: `https://api.workos.com/sso/jwks/${clientId}`, applicationID: clientId },
    { type: 'customJwt' as const, issuer: `https://api.workos.com/user_management/${clientId}`, algorithm: 'RS256' as const, jwks: `https://api.workos.com/sso/jwks/${clientId}` },
  ] : []),
] } satisfies AuthConfig
