import snapshot from './merge-public-catalog.json'
import type { CatalogModel, GatewayCatalog } from './gatewayCatalog'
const published: {fetchedAt:string;models:(CatalogModel & {sourceUrl:string;notes:Record<string,string[]|undefined>})[]} = snapshot
/** Published prices are independent of account access. A newer worker catalog takes precedence. */
export function modelCatalogEntry(id:string, connected?:GatewayCatalog|null) {
 const publicModel=published.models.find(m=>m.model===id),worker=connected?.models.find(m=>m.model===id)
 if(worker && (!publicModel || Date.parse(connected!.fetchedAt)>=Date.parse(published.fetchedAt)))return {model:worker,checkedAt:connected!.fetchedAt,sourceUrl:undefined,notes:{} as Record<string,string[]|undefined>}
 return publicModel ? {model:publicModel,checkedAt:published.fetchedAt,sourceUrl:publicModel.sourceUrl,notes:publicModel.notes} : undefined
}
