# Clerk sign-in and Convex workspace ownership

OpenEval uses Clerk for browser identity and Convex for reports, evaluations,
onboarding state, and linked workers. Workers continue to poll Convex outbound
with their existing machine credentials. They do not need a Clerk login or a
browser-accessible address. This changes sign-in, not sandbox persistence.

## Configure one workspace address

Use a stable HTTPS workspace origin. Set `VITE_CLERK_PUBLISHABLE_KEY` in the
frontend and `VITE_HEVAL_AUTH_ORIGIN` to that origin. Leave the latter empty for
local development. A sign-in started on another frontend address moves the
requested path, query, and fragment to this workspace; it does not send tokens
back to an arbitrary worker or preview address. On the workspace origin, sign-in
opens Clerk's modal over the current page. Closing it leaves the page available
and lets the user open sign-in again. Sign-in returns to the requested path,
query and fragment. `/login` remains available for direct sign-in links.
Reloads and the separate Studio/reports pages use the same Clerk session.
Sign-out returns to the homepage.

1. Sign in to the [Clerk dashboard](https://dashboard.clerk.com) and connect the
   CLI with `bunx clerk auth login`. Create/link a OpenEval application using
   `bunx clerk apps create` and `bunx clerk link` (see their `--help`). Use a
   development instance for preview validation, and a production instance for
   the stable public site. Accountless CLI setup is not currently supported for
   this React integration.
2. Enable email sign-in/sign-up and email-code verification in the selected
   instance. Existing Google/GitHub SSO may also be enabled if desired. Clerk
   manages these flows; OpenEval does not store passwords.
3. Create a JWT template named **convex** with audience **convex**, using Clerk's
   Convex template. Set `CLERK_JWT_ISSUER_DOMAIN` in the matching Convex deployment
   to the template issuer. The browser requests this token for both Convex and
   authenticated same-origin API requests. It contains no ownership override.
4. Configure the canonical origin and `/login` in the selected Clerk instance.
   Development keys support local testing; production requires Clerk's domain
   and DNS configuration. Verify with `bunx clerk deploy status`. Stable
   deployment addresses avoid configuring every ephemeral preview as a login
   destination. Switching identity providers does not remove domain setup.
5. Set the frontend's matching Convex URL. For Vercel's coordinated build, use
   `CONVEX_DEPLOY_KEY` and `scripts/vercel-build.ts`; it deploys the backend and
   supplies `VITE_CONVEX_URL` to the browser build. Clerk secret keys belong in
   operator tooling or a password manager, never in Vite variables.
6. For the older Bun runner, also set `CLERK_JWT_ISSUER_DOMAIN` and
   `HEVAL_PUBLIC_ORIGIN`. It verifies the JWT's signature, issuer, `convex`
   audience, expiration and authorized origin. Its local owner data is separate
   from the connected Convex workspace; this migration does not remap that local
   filesystem data.

## Preserve existing accounts before cutover

WorkOS and Clerk issue different user IDs. Reusing the same email alone must
not grant access to an existing workspace.

Verify both account identities through their respective administrative account
records. Before the new Clerk account creates any OpenEval data, call the
operator-only Convex function in the intended deployment:

```sh
bunx convex run authMigration:linkLegacyAccount \
  '{"clerkSubject":"user_CLERK_ID","legacySubject":"user_WORKOS_ID"}'
```

The mapping uses the configured Clerk issuer and preserves the existing owner
ID in all reports, memberships, queue entries, onboarding state and workers.
Existing worker credentials are untouched. It rejects reassignment, duplicate
owners and Clerk accounts that already have workspace data or memberships.
There is no public account-linking endpoint and no email-based auto-linking.
New accounts without a mapping use their Clerk ID as their workspace owner.

The current authentication configuration accepts Clerk tokens only. Existing
account links still map Clerk identities to their original stored ownership;
keeping that mapping does not require WorkOS token verification. Remove stale
`VITE_WORKOS_CLIENT_ID` and `WORKOS_CLIENT_ID` deployment variables after verifying
the account mapping. Removing these variables does not delete an identity
provider application or any stored reports and workers.

Configure `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_CONVEX_URL` and
`VITE_HEVAL_AUTH_ORIGIN` in Vercel's Production and Preview environments. Preview
sign-in returns to the configured stable workspace. The Vercel build fails if
its Clerk key or workspace backend configuration is missing, and includes only
the reviewed public result catalog.

## Production domain

The hosted workspace is `https://openeval.howaiworks.io`. The Clerk production
instance uses the root domain `howaiworks.io`, so its Frontend API is
`https://clerk.howaiworks.io` and it accepts sign-in from any `howaiworks.io`
subdomain. That issuer is `CLERK_JWT_ISSUER_DOMAIN` in the production Convex
deployment and in Vercel. `VITE_HEVAL_AUTH_ORIGIN` is
`https://openeval.howaiworks.io` in Production and Preview. The old
`heval.howaiworks.io` address redirects there with a 308.

Clerk's five DNS records (`clerk`, `accounts`, `clkmail`, `clk._domainkey`,
`clk2._domainkey`) are DNS-only CNAMEs in the Cloudflare zone for `howaiworks.io`.
Get their exact targets from Clerk's Domains page before changing them.

Account links in `authAccountLinks` are keyed by issuer. When the Clerk domain
changes, rewrite each link's `issuer` to the new Frontend API before users sign
in. Otherwise linked accounts lose access to their earlier reports. Clerk user
IDs do not change.

## Verification

Run `bun run test:auth`, `bun run test:backend`, `bun run test:server`,
`bun run test:exports`, `bun run lint`, and `bun run build`.
The auth contract check covers safe return URLs and token isolation; backend
checks cover legacy ownership, account isolation and mapping conflicts. These
checks do not simulate a successful live Clerk login.

On the configured app, verify email sign-up/sign-in, return to a private report
link including its query/fragment, refresh, another tab, navigation between
Studio and reports, sign-out, and a second account's denial of private data.
Verify an existing linked worker and a no-model connected evaluation after
account mapping. Live credential-entry and hosted acceptance must be reported
separately from automated contract tests.
