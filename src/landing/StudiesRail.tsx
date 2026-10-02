import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import studyData from './studies.json'

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const shortDate = (iso: string, withYear = true) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) })

function XMark() {
  return <svg className="study-x" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.9 2H22l-6.8 7.8L23 22h-6.2l-4.9-6.4L6.3 22H3.2l7.3-8.3L1 2h6.3l4.4 5.9zm-1.1 18h1.7L6.3 3.9H4.5z" /></svg>
}

export function StudiesRail() {
  const rail = useRef<HTMLDivElement>(null)
  const [atEnd, setAtEnd] = useState(false)
  const scroll = (direction: 1 | -1) => rail.current?.scrollBy({ left: direction * rail.current.clientWidth * .45, behavior: 'smooth' })
  const onScroll = () => {
    const el = rail.current
    if (el) setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4)
  }

  return (
    <section data-home-reveal className="studies-section shell" aria-labelledby="studies-heading">
      <div className="studies-head">
        <h2 id="studies-heading">Published with Heval</h2>
        <div className="studies-nav">
          <span>X views as of {shortDate(studyData.statsAsOf, false)}</span>
          <button type="button" aria-label="Previous studies" onClick={() => scroll(-1)}><ChevronLeft size={18} /></button>
          <button type="button" aria-label="More studies" onClick={() => scroll(1)}><ChevronRight size={18} /></button>
        </div>
      </div>
      <div className={`studies-rail ${atEnd ? 'at-end' : ''}`} ref={rail} onScroll={onScroll}>
        {studyData.studies.map(study => (
          <a className="study-card" key={study.id} href={study.xUrl} target="_blank" rel="noreferrer">
            <img src={study.poster} alt={study.posterAlt} width="1600" height="900" loading="lazy" />
            <div className="study-body">
              <h3>{study.headline}</h3>
              <p>{study.detail}</p>
              <div className="study-meta">
                <span>{shortDate(study.published)}</span>
                <span aria-label={`${study.views.toLocaleString('en-US')} views on X`}><XMark /><strong>{compact.format(study.views).toLowerCase()}</strong> views</span>
              </div>
            </div>
          </a>
        ))}
        <div className="study-card study-placeholder" aria-label="Next study in progress">
          <div className="study-placeholder-art"><span>In progress</span></div>
          <div className="study-body">
            <h3>Next study</h3>
            <p>Placeholder until the next eval is published</p>
          </div>
        </div>
      </div>
    </section>
  )
}
