/// <reference types="vite/client" />
import { PRESENTATION_DEFAULT_THEME } from '../charts/presentation-defaults'
import { resolveSocial, type SocialSettings } from '../charts/social-presets'
import { socialSvg } from '../charts/social-render'
import { SOCIAL_THEMES } from '../charts/social-themes'
import type { TrialRow } from '../charts/trial'
import logo from '../../harbor/report/assets/merge-lockup.svg?raw'
import layoutScript from '../../harbor/report/layout-check.js?raw'

/** Static hosting can edit and preview without the Bun rendering service. */
export function browserSocialPreview(rows: readonly TrialRow[], settings: SocialSettings) {
  const chart = resolveSocial(rows, settings)
  const count = chart.preset === 'disagreement' ? Math.max(1, Math.ceil(chart.matrix.length / 12)) : 1
  const pages = Array.from({ length: count }, (_, page) =>
    '<!doctype html><html lang="en"><meta charset="utf-8"><style>' +
    `html,body{margin:0;background:${SOCIAL_THEMES[settings.theme ?? PRESENTATION_DEFAULT_THEME].surface}}` +
    'svg{display:block;width:100%;height:auto;font-feature-settings:"liga" 0,"calt" 0}</style>' +
    socialSvg(chart, settings, logo, page) + '<script>' + layoutScript +
    ';window.__hevalLayoutReady.then(result=>window.parent.postMessage({type:"heval-layout",...result,svg:new XMLSerializer().serializeToString(document.querySelector("svg"))},"*"));</script></html>',
  )
  return { chart, pages }
}
