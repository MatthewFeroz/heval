import type { ReactNode } from 'react'

export function PageHeader({ title, children }: { title: string; children: ReactNode }) {
  return <div className="report-intro"><h1>{title}</h1><p>{children}</p></div>
}
