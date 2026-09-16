// The Vercel showcase serves static assets; the Bun deployment supplies APIs.
export const STATIC_SITE = import.meta.env.VITE_HEVAL_STATIC_SITE === '1'
