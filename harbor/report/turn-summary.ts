import { median } from '../../src/charts/metrics'
import type { TrialRow } from '../../src/charts/trial'

const known = (values: (number | null | undefined)[]) => values.filter((v): v is number => typeof v === 'number')
const cell = (v: number | null, digits = 0) => (v === null ? '-' : v.toFixed(digits))

/**
 * Per-harness turn table. A harness with no cap configured prints "uncapped"
 * rather than a 0% hit rate, so an unenforced cap cannot pass for an unreached one.
 */
export function turnSummary(rows: TrialRow[]): string {
  const header = ['harness', 'attempts', 'turn source', 'median turns', 'max turns', 'median requests', 'max requests', 'cap', 'cap hits']
  const lines = [...new Set(rows.map(r => r.agent))].sort().map(agent => {
    const group = rows.filter(r => r.agent === agent)
    const turns = known(group.map(r => r.turns)), requests = known(group.map(r => r.modelRequests))
    const caps = [...new Set(known(group.map(r => r.turnCap)))]
    const capped = group.filter(r => r.capHit !== null && r.capHit !== undefined)
    const hits = capped.filter(r => r.capHit === 1).length
    return [
      agent,
      String(group.length),
      [...new Set(group.map(r => r.turnSource ?? 'unknown'))].join(', '),
      cell(median(turns), 1),
      cell(turns.length ? Math.max(...turns) : null),
      cell(median(requests), 1),
      cell(requests.length ? Math.max(...requests) : null),
      caps.length ? caps.join(', ') : 'uncapped',
      capped.length ? `${hits}/${capped.length}${capped.length < group.length ? ` (${group.length - capped.length} uncapped)` : ''}` : '-',
    ]
  })
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map(l => l[i].length)))
  const format = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()
  return [format(header), ...lines.map(format)].join('\n')
}
