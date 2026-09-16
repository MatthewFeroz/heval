import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import type { AppAuth } from '../auth'
import type { GuideStore } from './model'

export function guideStore(url: string, auth: AppAuth): GuideStore {
  async function client() {
    const token = await auth.getAccessToken()
    if (!token) throw new Error('Sign in to save your guide progress.')
    const connection = new ConvexHttpClient(url)
    connection.setAuth(token)
    return connection
  }
  return {
    async load() { return (await client()).query(api.onboarding.get, {}) },
    async save(progress) { return (await client()).mutation(api.onboarding.save, progress) },
  }
}
