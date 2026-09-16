import { test, expect } from 'bun:test'
import { zipFiles, posterDocuments } from './social-posters'
import { acquireExport } from './export-lock'
import { SOCIAL_DEFAULTS } from '../src/charts/social-presets'
import { readFileSync } from 'node:fs'
test('poster preview derives the same values and paginates the matrix',()=>{
 const input=JSON.parse(readFileSync('results/harbor/terminal-bench-comparison.json','utf8'))
 const d=posterDocuments(input,{...SOCIAL_DEFAULTS,preset:'disagreement',models:['glm-5.3','glm-5.3-flash','kimi-k3','deepseek-v4-flash','deepseek-v4-pro-0813']})
 expect(d.chart.matrix.length).toBe(15)
 expect(d.pages.length).toBe(2)
 expect(d.pages[0]).toContain('Page 1 of 2')
 expect(d.pages[1]).toContain('Page 2 of 2')
 expect(d.pages[0]).not.toContain('https://fonts.googleapis.com')
})
test('ZIP preserves payload bytes and directory offsets',()=>{
 const payload=Buffer.from('hello'),zip=Buffer.from(zipFiles([{name:'values.csv',bytes:payload}]))
 expect(zip.readUInt32LE(0)).toBe(0x04034b50)
 expect(zip.readUInt32LE(14)).toBe(0x3610a686)
 const n=zip.readUInt16LE(26),start=30+n
 expect(zip.subarray(start,start+payload.length)).toEqual(payload)
 const end=zip.length-22,central=zip.readUInt32LE(end+16)
 expect(zip.readUInt32LE(central)).toBe(0x02014b50)
 expect(zip.readUInt16LE(end+10)).toBe(1)
})
test('static and motion exports share one capacity reservation',()=>{
 const release=acquireExport();expect(release).not.toBeNull()
 expect(acquireExport()).toBeNull();release!()
 const next=acquireExport();expect(next).not.toBeNull();next!()
})
