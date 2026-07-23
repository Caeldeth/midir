import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import type { PcapApi } from '../pcapSource'

/**
 * A smoke test for the native addon.
 *
 * It checks that the module loads and answers, not that capture works. Real
 * capture needs an adapter, the Npcap driver, and traffic, so it belongs in
 * the end-to-end checks the user runs by hand.
 */

const require = createRequire(import.meta.url)
const addon = require('da-pcap') as PcapApi & {
  NOT_SUPPORTED: string
  DataLink: { EN10MB: number }
}

const onWindows = process.platform === 'win32'

describe('the da-pcap addon', () => {
  it('loads and exports the whole surface', () => {
    for (const name of [
      'isAvailable',
      'loadError',
      'listDevices',
      'startCapture',
      'stopCapture',
      'tcpConnectionsForPid',
      'processIdsByName'
    ] as const) {
      expect(typeof addon[name], name).toBe('function')
    }
    expect(addon.DataLink.EN10MB).toBe(1)
  })

  it.skipIf(!onWindows)('reports whether Npcap is present, with a reason when it is not', () => {
    if (addon.isAvailable()) {
      expect(addon.loadError()).toBeNull()
    } else {
      expect(addon.loadError()).toMatch(/wpcap\.dll/)
    }
  })

  it.skipIf(!onWindows)('lists at least one adapter when Npcap is present', () => {
    if (!addon.isAvailable()) return
    const devices = addon.listDevices()
    expect(devices.length).toBeGreaterThan(0)
    for (const device of devices) {
      expect(typeof device.name).toBe('string')
      expect(device.name.length).toBeGreaterThan(0)
      expect(Array.isArray(device.addresses)).toBe(true)
    }
  })

  it.skipIf(!onWindows)('reads the TCP table for a process that exists', () => {
    // The current process is guaranteed to exist. It may own no TCP socket,
    // so the shape of the answer is what matters, not its length.
    const rows = addon.tcpConnectionsForPid(process.pid)
    expect(Array.isArray(rows)).toBe(true)
    for (const row of rows) {
      expect(typeof row.localAddress).toBe('string')
      expect(row.localPort).toBeGreaterThanOrEqual(0)
      expect(row.localPort).toBeLessThanOrEqual(65535)
    }
  })

  it.skipIf(!onWindows)('returns no rows for a process id that does not exist', () => {
    expect(addon.tcpConnectionsForPid(0xfffffff)).toEqual([])
  })

  it.skipIf(!onWindows)('finds a process by name and nothing for a name that is absent', () => {
    // Every Windows session runs at least one instance of this.
    expect(addon.processIdsByName('explorer.exe').length).toBeGreaterThan(0)
    expect(addon.processIdsByName('not-a-real-program-xyz.exe')).toEqual([])
  })

  it.skipIf(!onWindows)('matches a process name without regard to case', () => {
    expect(addon.processIdsByName('EXPLORER.EXE')).toEqual(addon.processIdsByName('explorer.exe'))
  })

  it.skipIf(onWindows)('reports that capture is unsupported off Windows', () => {
    expect(addon.isAvailable()).toBe(false)
    expect(addon.loadError()).toBe(addon.NOT_SUPPORTED)
    expect(() => addon.listDevices()).toThrow(addon.NOT_SUPPORTED)
  })
})
