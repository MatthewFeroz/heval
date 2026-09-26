import type { VendorRoute } from './gatewayCatalog'
export const formatPrice = (value: number | null | undefined) => value == null ? '—' : `$${value.toLocaleString('en-US', { maximumFractionDigits: 6 })}`
export const formatTokens = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
/** A from-price uses both prices from one available Merge route, never a hybrid. */
export const lowestRoute = (providers: VendorRoute[]) => providers.filter(p => (!p.status || p.status === 'available') && p.inputPerMillion !== null && p.outputPerMillion !== null).sort((a, b) => a.inputPerMillion! - b.inputPerMillion! || a.outputPerMillion! - b.outputPerMillion!)[0]

/** An explicit provider must never fall back to another provider's price. */
export const priceForVendor = (providers: VendorRoute[], vendor?: string) => !vendor || vendor === 'Provider default' ? lowestRoute(providers) : providers.find(p => p.vendor === vendor)
