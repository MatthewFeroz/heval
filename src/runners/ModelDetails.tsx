import type { CatalogModel } from './gatewayCatalog'
import { formatPrice, formatTokens, priceForVendor } from './modelReference'

export function ModelDetails({ model, name, summary, group, checkedAt, vendor, sourceUrl, notes = {} }: {
  model: CatalogModel; name: string; summary: string; group: string; checkedAt: string; vendor?: string; sourceUrl?: string; notes?: Record<string,string[]|undefined>
}) {
  const automatic = !vendor || vendor === 'Provider default'
  const priced = priceForVendor(model.vendors, vendor)
  const limits = automatic ? model.vendors : priced ? [priced] : []
  const context = Math.max(0, ...limits.map(p => p.contextWindow ?? 0))
  const output = Math.max(0, ...limits.map(p => p.maxOutputTokens ?? 0))
  return <section className="model-details" aria-label={`${name} model details`}>
    <header className="model-detail-heading"><div><span className="report-eyebrow">{group}</span><h3>{name}</h3><code>{model.model}</code></div><span className="model-gateway-badge">Merge Gateway</span></header>
    <p className="model-summary">{summary}</p>
    <dl className="model-metrics">
      <div><dt>Input{automatic ? ' from' : ''} / 1M</dt><dd>{formatPrice(priced?.inputPerMillion)}</dd></div>
      <div><dt>Output / 1M</dt><dd>{formatPrice(priced?.outputPerMillion)}</dd></div>
      <div><dt>Context{automatic ? ' up to' : ''}</dt><dd>{formatTokens(context || null)}</dd></div>
      <div><dt>Max output{automatic ? ' up to' : ''}</dt><dd>{formatTokens(output || null)}</dd></div>
    </dl>
    <p className="model-data-source">{automatic ? (priced ? `Starting rates via ${priced.vendor}; automatic routing may cost more. ` : 'Rates unavailable. ') : `Rates for ${vendor}. `}USD per 1M tokens / {sourceUrl ? 'Public catalog checked' : 'Connection updated'} {new Date(checkedAt).toLocaleDateString('en-US', { timeZone: 'UTC' })}</p>
    <div className="model-capabilities">{model.vendors.some(p => p.supportsToolCalling) && <span>Tool calling</span>}{model.vendors.some(p => p.supportsReasoning) && <span>Reasoning</span>}</div>
    <div className="model-provider-heading"><h4>Providers</h4><span>{model.vendors.length} routes</span></div>
    <div className="model-provider-scroll"><table><caption>Merge Gateway provider pricing and capabilities</caption><thead><tr><th>Provider</th><th>Input /M</th><th>Output /M</th><th>Cache read /M</th><th>Context</th><th>Max output</th><th>Tools</th><th>Reasoning</th></tr></thead><tbody>{model.vendors.map(p => <tr key={p.vendor} data-selected={!automatic && p.vendor === vendor}><th scope="row">{p.vendor}{!automatic && p.vendor === vendor && ' / Selected'}<small>{sourceUrl ? 'Published rate' : p.status ?? 'Status not published'}</small></th><td>{formatPrice(p.inputPerMillion)}</td><td>{formatPrice(p.outputPerMillion)}</td><td>{formatPrice(p.cacheReadPerMillion)}</td><td>{formatTokens(p.contextWindow)}</td><td>{formatTokens(p.maxOutputTokens)}</td><td>{p.supportsToolCalling ? 'Yes' : '—'}</td><td>{p.supportsReasoning ? 'Yes' : 'Not listed'}</td></tr>)}</tbody></table></div>
    {Object.entries(notes).filter(([,items])=>items?.length).map(([provider,items])=><p className="model-data-source" key={provider}><strong>{provider}</strong>: {items?.join(' / ')}</p>)}
    <p className="model-data-source">{sourceUrl ? <><a href={sourceUrl} target="_blank" rel="noreferrer">Source: Merge public documentation</a>. Limits are rounded as published. </> : 'Rates supplied by your Merge connection. '}Provider token rates; <a href="https://docs.merge.dev/merge-gateway/cost/pricing" target="_blank" rel="noreferrer">Merge fees</a> are separate. Missing values are not published.</p>
  </section>
}
