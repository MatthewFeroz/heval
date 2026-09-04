import type { DetailedHTMLProps, HTMLAttributes } from 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'hyperframes-player': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        width?: string
        height?: string
        controls?: string
        muted?: string
        'audio-locked'?: string
        autoplay?: string
        loop?: string
      }
    }
  }
}
