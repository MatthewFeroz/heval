import harnessCatalog from '../harness-catalog.json'
const ORDER=['codex','claude-code','opencode','pi','antigravity','grok-build','cursor']
const rank=(id:string)=>ORDER.includes(id)?ORDER.indexOf(id):ORDER.length

/** Evaluation choices contain only approved profiles; installation belongs to computer setup. */
export function HarnessPicker({profiles,selected,onToggle,setupHref}:{profiles:{agent:string;model:string}[];selected:string[];onToggle:(agent:string)=>void;setupHref:string}){
 const entries=[...new Set(profiles.map(p=>p.agent))].map(id=>harnessCatalog.find(h=>h.id===id)??{id,name:id,logo:'',merge:true}).filter(h=>h.merge).sort((a,b)=>rank(a.id)-rank(b.id))
 return <fieldset data-tour="harnesses"><legend>Harnesses</legend><ul className="evaluation-harnesses">{entries.map(h=>{
  const count=new Set(profiles.filter(p=>p.agent===h.id).map(p=>p.model)).size
  return <li className="evaluation-harness" key={h.id} data-state="configured"><label className="evaluation-choice"><input type="checkbox" aria-label={h.name} checked={selected.includes(h.id)} onChange={()=>onToggle(h.id)}/>{h.logo&&<img className="evaluation-harness-logo" src={`/harnesses/${h.logo}`} alt="" width={20} height={20}/>}<strong>{h.name}</strong></label><p>{count} model {count===1?'option':'options'}</p></li>
 })}</ul><a href={setupHref}>Manage harnesses on this computer</a></fieldset>
}
