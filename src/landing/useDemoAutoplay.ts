import { useEffect, useState, type RefObject } from 'react'

/** Loop the sample while it is visible, with time to read the opening and result. */
export function useDemoAutoplay(root: RefObject<HTMLElement | null>, duration: number) {
  const [time, setTime] = useState(0)

  useEffect(() => {
    const element = root.current
    if (!element) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const openingTicks = 8
    const resultTicks = 12
    let tick = 0
    let visible = false
    let timer: number | undefined

    const sync = () => {
      window.clearInterval(timer)
      timer = undefined
      if (!visible || document.hidden || reduced.matches) return
      timer = window.setInterval(() => {
        tick = (tick + 1) % (openingTicks + duration + resultTicks)
        setTime(Math.min(duration, Math.max(0, tick - openingTicks)))
      }, 180)
    }
    const onMotionChange = () => {
      if (reduced.matches) {
        tick = 0
        setTime(0)
      }
      sync()
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      sync()
    })
    observer.observe(element)
    document.addEventListener('visibilitychange', sync)
    reduced.addEventListener('change', onMotionChange)
    return () => {
      window.clearInterval(timer)
      observer.disconnect()
      document.removeEventListener('visibilitychange', sync)
      reduced.removeEventListener('change', onMotionChange)
    }
  }, [root, duration])

  return time
}
