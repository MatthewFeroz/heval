// Backend deployment supplies the matching frontend URL in one build.
const command = process.env.CONVEX_DEPLOY_KEY
  ? ['bunx', 'convex', 'deploy', '--cmd-url-env-var-name', 'VITE_CONVEX_URL', '--cmd', 'bun run build:showcase']
  : ['bun', 'run', 'build:showcase']
const child = Bun.spawn(command, { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
process.exit(await child.exited)
