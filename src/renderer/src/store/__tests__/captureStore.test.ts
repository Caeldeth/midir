import { STOPPED_STATUS, type CaptureStatus } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCaptureStore } from '../captureStore'

const RUNNING: CaptureStatus = { ...STOPPED_STATUS, running: true, state: 'listening' }

describe('useCaptureStore', () => {
  beforeEach(() => {
    useCaptureStore.setState({
      status: STOPPED_STATUS,
      availability: null,
      busy: false,
      error: null
    })
  })

  it('reads the availability and the status together', async () => {
    window.api.capture.availability = vi.fn(async () => ({
      available: true,
      devices: [{ name: 'a', description: 'Adapter', loopback: false, addresses: ['192.168.1.20'] }]
    }))
    window.api.capture.status = vi.fn(async () => RUNNING)

    await useCaptureStore.getState().refresh()
    expect(useCaptureStore.getState().availability?.devices).toHaveLength(1)
    expect(useCaptureStore.getState().status).toEqual(RUNNING)
  })

  it('starts on a named adapter and keeps the status it is given', async () => {
    window.api.capture.start = vi.fn(async () => RUNNING)
    await useCaptureStore.getState().start('adapter')
    expect(window.api.capture.start).toHaveBeenCalledWith('adapter')
    expect(useCaptureStore.getState().status.running).toBe(true)
    expect(useCaptureStore.getState().busy).toBe(false)
  })

  it('keeps a failure to show the user, and stays stopped', async () => {
    window.api.capture.start = vi.fn(async () => {
      throw new Error('Npcap is not installed.')
    })
    await useCaptureStore.getState().start('adapter')
    expect(useCaptureStore.getState().error).toBe('Npcap is not installed.')
    expect(useCaptureStore.getState().status.running).toBe(false)
    expect(useCaptureStore.getState().busy).toBe(false)
  })

  it('clears a failure on the next start', async () => {
    useCaptureStore.setState({ error: 'old failure' })
    window.api.capture.start = vi.fn(async () => RUNNING)
    await useCaptureStore.getState().start('adapter')
    expect(useCaptureStore.getState().error).toBeNull()
  })

  it('ignores a second start while one is in flight', async () => {
    let release: () => void = () => undefined
    window.api.capture.start = vi.fn(
      () =>
        new Promise<CaptureStatus>((resolve) => {
          release = () => resolve(RUNNING)
        })
    )

    const first = useCaptureStore.getState().start('adapter')
    await useCaptureStore.getState().start('adapter')
    release()
    await first

    expect(window.api.capture.start).toHaveBeenCalledTimes(1)
  })

  it('stops and keeps the status it is given', async () => {
    useCaptureStore.setState({ status: RUNNING })
    window.api.capture.stop = vi.fn(async () => STOPPED_STATUS)
    await useCaptureStore.getState().stop()
    expect(useCaptureStore.getState().status.running).toBe(false)
  })

  it('mirrors a status pushed from main', () => {
    let push: ((status: CaptureStatus) => void) | undefined
    window.api.capture.onStatus = vi.fn((handler) => {
      push = handler
      return () => undefined
    })

    const stop = useCaptureStore.getState().subscribe()
    push?.({ ...RUNNING, state: 'decoding', characters: ['Sabrael'] })
    expect(useCaptureStore.getState().status.characters).toEqual(['Sabrael'])
    stop()
  })
})
