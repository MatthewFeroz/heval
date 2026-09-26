import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { kindFromAppleModel, kindFromHardware, workerMachineKind } from './machine'

describe('machine kind detection', () => {
  test('Apple marketing names and Intel model identifiers', () => {
    expect(kindFromAppleModel('Mac mini (2024)')).toBe('mac-mini')
    expect(kindFromAppleModel('Macmini8,1')).toBe('mac-mini')
    expect(kindFromAppleModel('Mac Studio (2025)')).toBe('mac-studio')
    expect(kindFromAppleModel('MacBookPro18,3')).toBe('laptop')
    expect(kindFromAppleModel('iMac21,1')).toBe('desktop')
    expect(kindFromAppleModel('Surface Laptop')).toBeNull()
  })

  test('virtual machines read as cloud regardless of the chassis they report', () => {
    expect(kindFromHardware({ chassis: '1', vendor: 'QEMU', product: 'Standard PC (Q35 + ICH9, 2009)' })).toBe('cloud')
    expect(kindFromHardware({ chassis: '3', vendor: 'Microsoft Corporation', product: 'Virtual Machine' })).toBe('cloud')
    expect(kindFromHardware({ chassis: '1', vendor: 'Amazon EC2', product: 'm7i.large' })).toBe('cloud')
  })

  test('physical chassis types map to laptop, desktop, and server; unknown is no signal', () => {
    expect(kindFromHardware({ chassis: '10', vendor: 'LENOVO', product: 'ThinkPad X1' })).toBe('laptop')
    expect(kindFromHardware({ chassis: '3', vendor: 'Dell Inc.', product: 'OptiPlex 7090' })).toBe('desktop')
    expect(kindFromHardware({ chassis: '23', vendor: 'Supermicro', product: 'SYS-1029P' })).toBe('server')
    expect(kindFromHardware({ chassis: '10', vendor: 'Microsoft Corporation', product: 'Surface Laptop 7' })).toBe('laptop')
    expect(kindFromHardware({ chassis: '2', vendor: 'Unknown', product: 'Unknown' })).toBeNull()
  })

  test('a containerized worker uses the host-reported kind and never self-detects', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'heval-machine-'))
    const previous = process.env.HEVAL_WORKER_STATE
    process.env.HEVAL_WORKER_STATE = directory
    try {
      expect(await workerMachineKind(directory)).toBeUndefined()
      writeFileSync(join(directory, 'machine.json'), JSON.stringify({ kind: 'laptop' }))
      expect(await workerMachineKind(directory)).toBe('laptop')
      writeFileSync(join(directory, 'machine.json'), JSON.stringify({ kind: 'toaster' }))
      expect(await workerMachineKind(directory)).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.HEVAL_WORKER_STATE
      else process.env.HEVAL_WORKER_STATE = previous
    }
  })
})
