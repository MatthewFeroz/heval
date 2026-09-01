/**
 * Vega-Lite spec -> SVG string, headless (Bun/Node, no canvas).
 *
 * Same compiler the browser editor uses, so the static report and the studio
 * agree pixel-for-pixel on geometry. Text is measured by Vega's estimator here
 * rather than a real font, which is why the recipes leave label headroom.
 */

import * as vega from 'vega'
import * as vl from 'vega-lite'
import type { TopLevelSpec } from 'vega-lite'

export async function renderSvg(spec: TopLevelSpec): Promise<string> {
  const compiled = vl.compile(spec).spec
  const view = new vega.View(vega.parse(compiled), { renderer: 'none' })
  const svg = await view.toSVG()
  view.finalize()
  // Let the surrounding card size the chart; keep the aspect ratio via viewBox.
  return svg.replace(/^<svg([^>]*?)\swidth="([\d.]+)"\sheight="([\d.]+)"/, (_m, attrs: string, w: string, h: string) =>
    `<svg${attrs} viewBox="0 0 ${w} ${h}" style="max-width:${w}px;width:100%;height:auto"`)
}
