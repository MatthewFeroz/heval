import { ConvexError } from 'convex/values'

export function message(error: unknown) {
  if (error instanceof ConvexError && typeof error.data === 'string') return error.data
  return error instanceof Error ? error.message.replace(/^.*Uncaught ConvexError: /s, '').split('\n')[0] : 'Something went wrong. Please retry.'
}
export function token() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('') }
