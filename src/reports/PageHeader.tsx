import type { ReactNode } from 'react'

export function PageHeader({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return <div className="workspace-page-heading"><div className="report-intro"><h1>{title}</h1><p>{children}</p></div>{actions && <div className="report-actions">{actions}</div>}</div>
}
