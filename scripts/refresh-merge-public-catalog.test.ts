import { expect, test } from 'bun:test'
import { parsePublicModel } from './refresh-merge-public-catalog'
const model={id:'deepseek/deepseek-v4.1-flash',name:'DeepSeek',group:'Open models',summary:''}
const header='<tr>'+['Vendor','ZDR','Input /M','Output /M','Cache read /M','Context','Max output','Capabilities','Released'].map(s=>`<th>${s}</th>`).join('')+'</tr>'
const html=`<table class="model-detail__table">${header}<tr><td><span title="Promo ends Nov 1, 2026">Particle33% off</span></td><td></td><td><span>$0.10</span><s>$0.15</s><span title="Peak hours: $0.20/M"></span></td><td>$0.40</td><td>-</td><td>1M</td><td>384K</td><td><span title="Tool calling"></span></td><td>Sep 9, 2026</td></tr></table>`
test('public parser keeps promo rates, conditions and missing cache prices distinct',async()=>{
 const result=await parsePublicModel(html,model)
 expect(result.vendors[0]).toMatchObject({vendor:'particle',inputPerMillion:.1,outputPerMillion:.4,cacheReadPerMillion:null,contextWindow:1000000,supportsToolCalling:true})
 expect(result.notes.particle).toEqual(['Promo ends Nov 1, 2026','Input: Peak hours: $0.20/M','Input list price: $0.15/M'])
})
test('public parser fails closed when the price format or table structure changes',async()=>{
 await expect(parsePublicModel(html.replace('$0.40','Contact sales'),model)).rejects.toThrow('Unknown price')
 await expect(parsePublicModel(html.replace('Input /M','Input /K'),model)).rejects.toThrow('Public table changed')
})

test('reasoning comes from vendor detail levels, matched by vendor name rather than table order', async () => {
 const matrix='<table class="model-detail__matrix"><tr><th></th><th>Baseten</th><th>Particle</th></tr><tr><td>Reasoning effort levels</td><td>-</td><td><span class="model-detail__chip">none</span><span class="model-detail__chip">high</span></td></tr></table>'
 expect((await parsePublicModel(html+matrix,model)).vendors[0].supportsReasoning).toBe(true)
 expect((await parsePublicModel(html+matrix.replace('<span class="model-detail__chip">high</span>',''),model)).vendors[0].supportsReasoning).toBe(false)
})
