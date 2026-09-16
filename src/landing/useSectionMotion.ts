import { useEffect, type RefObject } from 'react'

/** Progressive enhancement: sections remain readable when motion is unavailable. */
export function useSectionMotion(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === 'undefined') return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const animations = new Set<Animation>()
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return
        observer.unobserve(entry.target)
        if (reduced.matches) return
        const animation = entry.target.animate([
          { opacity: 0, transform: 'translateY(24px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ], { duration: 700, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' })
        animations.add(animation)
        animation.onfinish = () => animations.delete(animation)
      })
    }, { threshold: 0.08 })
    root.current.querySelectorAll('[data-home-reveal]').forEach(element => observer.observe(element))
    const stop = () => { if (reduced.matches) { animations.forEach(animation => animation.cancel()); animations.clear() } }
    reduced.addEventListener('change', stop)
    return () => { observer.disconnect(); reduced.removeEventListener('change', stop); animations.forEach(animation => animation.cancel()) }
  }, [root])
}
