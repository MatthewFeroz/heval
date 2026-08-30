export class AsyncCache<T> {
  private values = new Map<string, T>()
  async get(key: string, load: () => Promise<T>) {
    if (this.values.has(key)) return this.values.get(key)!
    const value = await load()
    this.values.set(key, value)
    return value
  }
}
