import { useState } from 'react'
import type { RunnerProfile } from './protocol'
import type { GatewayCatalog } from './gatewayCatalog'
import shortlist from './model-shortlist.json'
import { formatPrice, priceForVendor } from './modelReference'
import { ModelDetails } from './ModelDetails'
import './models.css'
import { modelCatalogEntry } from './publicModelCatalog'

export function ModelPicker({ profiles, selected, vendors, setupHref, catalog, onToggle, onVendor }: {
  profiles: RunnerProfile[]; selected: string[]; vendors: Record<string, string>; setupHref: string; catalog?: GatewayCatalog | null
  onToggle: (model: string) => void; onVendor: (model: string, vendor: string) => void
}) {
  const models = [...shortlist, ...[...new Set([...profiles.map(p => p.model), ...selected])].filter(id => !shortlist.some(m => m.id === id)).sort().map(id => {
    const available = profiles.some(p => p.model === id)
    return { id, name: id, group: available ? 'Configured models' : 'Unavailable models', summary: available
      ? 'Available through the approved evaluation profiles on this computer.'
      : 'This model is no longer configured on this computer. Deselect it or restore its profile before starting an evaluation.' }
  })]
  const availableModel = models.find(m => profiles.some(p => p.model === m.id)) ?? models[0]
  const [requestedFocus, setFocused] = useState(() => availableModel.id)
  const active = models.find(m => m.id === requestedFocus) ?? availableModel
  const focused = active.id, entry = modelCatalogEntry(focused, catalog), model = entry?.model
  const routes = [...new Set(profiles.filter(p => p.model === focused).map(p => p.vendor!))].sort()
  const chosen = (Object.hasOwn(vendors, focused) ? vendors[focused] : undefined) || routes[0]
  const missingRoute = !!chosen && !routes.includes(chosen)
  return <fieldset data-tour="models" className="model-picker"><legend>Models <span className="report-muted">{models.length}</span></legend>
    <div className="model-explorer-heading"><p>Compare prices, providers, and capabilities.</p><span>{selected.length} selected</span></div>
    <div className="model-explorer">
      <div className="model-index" aria-label="Model catalog">
        <p className="model-index-caption">Merge rates · input / output per 1M</p>
        {[...new Set(models.map(m => m.group))].map(group => <div key={group}><h3>{group}</h3>{models.filter(m => m.group === group).map(item => {
          const detail = modelCatalogEntry(item.id, catalog)?.model, route = (Object.hasOwn(vendors, item.id) ? vendors[item.id] : undefined) || [...new Set(profiles.filter(p => p.model === item.id).map(p => p.vendor!))].sort()[0], price = detail && priceForVendor(detail.vendors, route)
          const available = profiles.some(p => p.model === item.id)
          return <div className="model-index-row" key={item.id} data-active={focused === item.id}>
            <input type="checkbox" aria-label={item.name} checked={selected.includes(item.id)} disabled={!available && !selected.includes(item.id)} onChange={() => {setFocused(item.id);onToggle(item.id)}}/>
            <button type="button" aria-label={`View ${item.name} details`} aria-pressed={focused === item.id} onClick={() => setFocused(item.id)}><strong>{item.name}</strong><span>{price ? <>{(!route || route === 'Provider default') && 'From '}{formatPrice(price.inputPerMillion)} / {formatPrice(price.outputPerMillion)}</> : 'Rates unavailable'}</span></button>
          </div>
        })}</div>)}
      </div>
      <div className="model-inspector">
        <div className="model-execution-route">{routes.length > 1 || routes.length === 1 && missingRoute ? <label>Run via<select aria-label={`Serving vendor for ${active.name}`} value={chosen} onChange={event => onVendor(focused,event.target.value)}>{missingRoute && <option value={chosen} disabled>{chosen} (no longer configured)</option>}{routes.map(route => <option key={route}>{route}</option>)}</select></label> : <span>{routes.length ? `Run via ${chosen}` : 'Not configured on this computer'}</span>}<a href={setupHref}>Manage connection</a></div>
        {model ? <ModelDetails key={model.model} model={model} name={active.name} summary={active.summary} group={active.group} checkedAt={entry!.checkedAt} vendor={chosen} sourceUrl={entry!.sourceUrl} notes={entry!.notes}/> : <div className="model-details"><h3>{active.name}</h3><p className="model-summary">{active.summary}</p><p>Rates and capabilities are unavailable for this model.</p></div>}
      </div>
    </div>
  </fieldset>
}
