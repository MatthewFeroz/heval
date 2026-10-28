/** No scripts, navigation, forms, embeds or network resources in output previews. */
export function previewDocument(source: string) {
  // Template contents stay inert while sanitizing. An inert DOMParser document
  // can still fetch image/frame resources before those elements are removed.
  const template = document.createElement('template')
  template.innerHTML = source
  const doc = template.content
  doc.querySelectorAll('script,iframe,frame,frameset,object,embed,base,meta,link,form,template,noscript,animate,animateMotion,animateTransform,set,foreignObject').forEach(node => node.remove())
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on') || ['href', 'src', 'srcset', 'action', 'formaction', 'target', 'ping', 'srcdoc', 'xlink:href', 'background'].includes(name)) {
        if (name === 'src' && element.tagName === 'IMG' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(attribute.value)) continue
        element.removeAttribute(attribute.name)
      }
    }
  }
  // Template parsing drops html/body tags. Retain their presentation attributes
  // without inserting any original source into an active document.
  const attributes = (tag: string) => {
    const match = source.match(new RegExp(`<${tag}\\b((?:"[^"]*"|'[^']*'|[^'">])*)>`, 'i'))
    if (!match) return ''
    const holder = document.createElement('template')
    holder.innerHTML = `<div ${match[1]}></div>`
    const element = holder.content.firstElementChild
    const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
    return [...(element?.attributes ?? [])].filter(attribute => /^(class|id|style|lang|dir|data-[\w-]+)$/.test(attribute.name)).map(attribute => ` ${attribute.name}="${escape(attribute.value)}"`).join('')
  }
  const policy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"
  return `<!doctype html><html${attributes('html')}><head><meta http-equiv="Content-Security-Policy" content="${policy}"></head><body${attributes('body')}>${template.innerHTML}</body></html>`
}

