if (!/^pk_(test|live)_/.test(process.env.VITE_CLERK_PUBLISHABLE_KEY ?? '')) throw new Error('Configure VITE_CLERK_PUBLISHABLE_KEY in this Vercel environment before deploying.')
if (!process.env.CONVEX_DEPLOY_KEY && !process.env.VITE_CONVEX_URL) throw new Error('Configure VITE_CONVEX_URL or CONVEX_DEPLOY_KEY in this Vercel environment before deploying.')
// This entry point is the hosted build, including projects that do not expose
// Vercel's optional system variables. Never depend on a local demo export here.
process.env.HEVAL_PUBLIC_BUILD = '1'
// Backend deployment supplies the matching frontend URL in one build.
const command = process.env.CONVEX_DEPLOY_KEY
  ? ['bunx', 'convex', 'deploy', '--cmd-url-env-var-name', 'VITE_CONVEX_URL', '--cmd', 'bun run build:showcase']
  : ['bun', 'run', 'build:showcase']
const child = Bun.spawn(command, { env: { ...process.env, HEVAL_PUBLIC_BUILD: '1' }, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
process.exit(await child.exited)
