/* Shared by sandboxed previews and the PNG renderer. All measurements use SVG coordinates. */
window.__hevalLayoutReady = (async () => {
  await document.fonts.ready
  const svg = document.querySelector('svg')
  const errors = [],
    adjustments = []
  const labels = [...svg.querySelectorAll('text')]
  for (const label of labels) {
    const original = label.textContent
    const x = Number(label.getAttribute('x'))
    const anchor = label.getAttribute('text-anchor')
    const available =
      anchor === 'end' ? x - 40 : anchor === 'middle' ? 2 * Math.min(x - 40, 1560 - x) : 1560 - x
    const limit = Math.min(available, Number(label.dataset.maxWidth || available))
    const floor = Number(label.dataset.minSize || 18)
    const originalSize = Number(label.getAttribute('font-size'))
    let size = originalSize
    while (label.getBBox().width > limit && size > floor) {
      label.setAttribute('font-size', String(--size))
    }
    if (label.getBBox().width > limit && label.dataset.label) {
      let short = original
      while (short.length > 1 && label.getBBox().width > limit) {
        short = short.slice(0, -1)
        label.textContent = short + '\u2026'
      }
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
      title.textContent = original
      label.append(title)
      label.setAttribute('aria-label', original)
      adjustments.push('Shortened label: ' + original)
    } else if (size !== originalSize) {
      adjustments.push('Fitted label: ' + original)
    }
    const box = label.getBBox()
    if (
      box.width > limit + 1 ||
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.width > 1600 ||
      box.y + box.height > 900 ||
      size < 18
    ) {
      errors.push('Text does not fit: ' + original)
    }
  }
  for (let i = 0; i < labels.length; i++) {
    const a = labels[i].getBBox()
    for (let j = i + 1; j < labels.length; j++) {
      const b = labels[j].getBBox()
      if (
        Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 &&
        Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1
      ) {
        errors.push('Labels overlap: ' + labels[i].textContent + ' / ' + labels[j].textContent)
      }
    }
  }
  const result = { errors: [...new Set(errors)], adjustments }
  window.parent.postMessage({ type: 'heval-layout', ...result }, '*')
  return result
})()
