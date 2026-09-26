/** Refresh factual rate cards from public Merge docs; no credentials or model calls. */
import shortlist from '../src/runners/model-shortlist.json'
import type { CatalogModel } from '../src/runners/gatewayCatalog'
type Cell = { text: string; titles: string[] }
const vendors: Record<string,string> = { Anthropic:'anthropic', 'Amazon Bedrock':'bedrock', 'Azure OpenAI':'azure', OpenAI:'openai', 'Z.AI':'zai', Pareto:'pareto', Wafer:'wafer', 'Fireworks AI':'fireworks', Modal:'modal', Baseten:'baseten', 'Together AI':'together', Particle:'particle', DeepSeek:'deepseek', Moonshot:'moonshot', Makora:'makora', Morph:'morph', Empiriolabs:'empiriolabs', MiniMax:'minimax' }
const limit = (s:string) => { const m=s.match(/^(\d+(?:\.\d+)?)([KM])?$/); if(!m)throw Error(`Unknown limit: ${s}`);return Number(m[1])*(m[2]==='M'?1e6:m[2]==='K'?1e3:1) }
const rate = (s:string) => {if(s==='-'||s==='—')return null;const m=s.match(/^\$(\d+(?:\.\d+)?)(?:\$\d+(?:\.\d+)?)?$/);if(!m)throw Error(`Unknown price: ${s}`);return Number(m[1])}
export async function parsePublicModel(html:string, model:typeof shortlist[number]) {
 const rows: Cell[][]=[];let row:Cell[],cell:Cell|null=null
 await new HTMLRewriter().on('table.model-detail__table tr',{element(){row=[];rows.push(row)}})
 .on('table.model-detail__table tr > th, table.model-detail__table tr > td',{element(e){cell={text:'',titles:[]};row.push(cell);e.onEndTag(()=>{cell=null})},text(t){if(cell)cell.text+=t.text}})
 .on('table.model-detail__table [title]',{element(e){const title=e.getAttribute('title');if(cell&&title)cell.titles.push(title)}})
 .transform(new Response(html)).text()
 const matrix:Cell[][]=[]
 await new HTMLRewriter().on('table.model-detail__matrix tr',{element(){row=[];matrix.push(row)}})
 .on('table.model-detail__matrix tr > th, table.model-detail__matrix tr > td',{element(e){cell={text:'',titles:[]};row.push(cell);e.onEndTag(()=>{cell=null})},text(t){if(cell)cell.text+=t.text}})
 .on('table.model-detail__matrix .model-detail__chip',{element(e){e.onEndTag(()=>{if(cell)cell.text+=' '})}})
 .transform(new Response(html)).text()
 const reasoning=matrix.find(r=>r[0]?.text.trim()==='Reasoning effort levels')
 const reasoningByVendor=new Map(matrix[0]?.slice(1).map((c,i)=>[c.text.trim(),reasoning?.[i+1]?.text.trim().split(/\s+/).filter(level=>level && !['none','-','off'].includes(level))??[]]))
 const header=['Vendor','ZDR','Input /M','Output /M','Cache read /M','Context','Max output','Capabilities','Released']
 if(JSON.stringify(rows[0]?.map(c=>c.text.trim()))!==JSON.stringify(header)||rows.length<2)throw Error(`Public table changed: ${model.id}`)
 const notes:Record<string,string[]>={}
 const routes=rows.slice(1).map(c=>{
  if(c.length!==header.length)throw Error('Unexpected provider columns')
  const name=c[0].text.replace(/\d+% off$/,'').trim(),vendor=vendors[name]
  if(!vendor)throw Error(`Unmapped Merge vendor: ${name}`)
  notes[vendor]=[...c[0].titles,...c.slice(2,5).flatMap((cell,i)=>{
   const label=['Input','Output','Cache read'][i],list=cell.text.match(/\$[\d.]+\$(\d+(?:\.\d+)?)/)?.[1]
   return [...cell.titles.map(t=>`${label}: ${t}`),...(list?[`${label} list price: $${list}/M`]:[])]
  })]
  return {vendor,status:null,contextWindow:limit(c[5].text),maxOutputTokens:limit(c[6].text),inputPerMillion:rate(c[2].text),outputPerMillion:rate(c[3].text),cacheReadPerMillion:rate(c[4].text),supportsToolCalling:c[7].titles.includes('Tool calling'),supportsReasoning:c[7].titles.includes('Reasoning') || !!reasoningByVendor.get(name)?.length}
 })
 if(new Set(routes.map(v=>v.vendor)).size!==routes.length)throw Error('Duplicate public vendor')
 const result:CatalogModel={model:model.id,displayName:model.name,creator:model.id.split('/')[0],vendors:routes}
 return {...result,notes,sourceUrl:'https://docs.merge.dev/merge-gateway/models/details/'+model.id.replaceAll('/','-').replaceAll('.','-')}
}
if(import.meta.main){
 const models=await Promise.all(shortlist.map(async model=>{
  const url='https://docs.merge.dev/merge-gateway/models/details/'+model.id.replaceAll('/','-').replaceAll('.','-')
  const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(30000)})
  if(!response.ok)throw Error(`Merge docs: ${response.status}`)
  return parsePublicModel(await response.text(),model)
 }))
 await Bun.write('src/runners/merge-public-catalog.json',JSON.stringify({fetchedAt:new Date().toISOString(),models},null,2)+'\n')
 console.log(`Verified ${models.length} models and ${models.reduce((n,m)=>n+m.vendors.length,0)} provider rate cards from public Merge docs.`)
}
