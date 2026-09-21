import { describe, expect, it } from 'vitest'
import type { PointerState } from 'da-pcap'
import { createPaneWatcher } from '../paneWatcher'
import type { DialogState } from '../model/dialog'
import type { FieldMapState } from '../model/fieldMap'
import type { FieldMap } from '../protocol/decode/fieldMap'
import type { Logger } from '../log'

const CID = 'conn-1'

const PANE: FieldMap = {
  kind: 'fieldMap',
  fieldName: 'field001',
  currentIndex: 1,
  points: [
    { screenX: 307, screenY: 77, name: 'Abel', checksum: 0, mapId: 502, x: 18, y: 63 },
    { screenX: 344, screenY: 250, name: 'Loures', checksum: 0, mapId: 3012, x: 14, y: 8 }
  ]
}

function harness() {
  let clock = 1000
  let pane: FieldMapState | null = null
  let dialog: DialogState | null = null
  let pointer: PointerState | null = {
    x: 0,
    y: 0,
    inside: true,
    leftDown: false,
    width: 640,
    height: 480
  }
  let size = { width: 640, height: 480 }
  const lines: string[] = []
  const log = {
    info: (_scope: string, line: string) => lines.push(line),
    warn: (_scope: string, line: string) => lines.push(line),
    error: () => undefined,
    debug: () => undefined
  } as unknown as Logger
  const watcher = createPaneWatcher({
    pointerIn: () => pointer,
    resolveTarget: (id) => (id === CID ? { connectionId: CID, windowHandle: 7 } : null),
    liveConnections: () => [{ connectionId: CID, name: 'Test' }],
    fieldMapFor: (id) => (id === CID ? pane : null),
    dialogFor: (id) => (id === CID ? dialog : null),
    log,
    now: () => clock
  })
  return {
    watcher,
    lines,
    openDialog: () => {
      dialog = {
        packet: {
          kind: 'npcMenu',
          sourceId: 6703,
          npcName: 'Eduardo',
          menuType: 0,
          text: 'Hello.  What can I do for you?',
          isTextInput: false,
          options: [
            { text: 'Rucesion Civics', pursuit: 1612 },
            { text: 'Rucesion Law', pursuit: 1615 }
          ]
        },
        asOfMs: clock
      }
    },
    closeDialog: () => {
      dialog = null
    },
    answerDialog: (pursuit: number) => {
      clock += 400
      dialog = {
        ...dialog!,
        answer: {
          packet: {
            kind: 'merchantResponse',
            objectType: 1,
            objectId: 6703,
            pursuit,
            tail: new Uint8Array()
          },
          asOfMs: clock
        }
      }
    },
    open: () => {
      pane = { packet: PANE, asOfMs: clock }
    },
    close: () => {
      pane = null
    },
    answer: (mapId: number) => {
      clock += 700
      pane = {
        ...pane!,
        click: {
          packet: { kind: 'fieldMapClick', checksum: 0, mapId, x: 18, y: 63 },
          asOfMs: clock
        }
      }
    },
    /** Press and release the real button at a client position. */
    handClick: (x: number, y: number) => {
      pointer = { x, y, inside: true, leftDown: true, ...size }
      watcher.tick()
      clock += 30
      pointer = { x, y, inside: true, leftDown: false, ...size }
      watcher.tick()
    },
    resize: (width: number, height: number) => {
      size = { width, height }
    },
    advance: (ms: number) => {
      clock += ms
    },
    lose: () => {
      pointer = null
    }
  }
}

describe('the pane watcher', () => {
  it('logs a hand click while a pane is open, and the point near it', () => {
    const h = harness()
    h.open()
    h.handClick(309, 80)
    expect(h.lines).toEqual([
      'Hand click released at (309, 80) on the world map, near "Abel" (307, 77) for map 502.'
    ])
  })

  it('pairs the client answer with the hand click before it', () => {
    const h = harness()
    h.open()
    h.handClick(309, 80)
    h.answer(502)
    h.watcher.tick()
    expect(h.lines[1]).toBe(
      'The client sent map 502 at (18, 63), 700 ms after the hand click at game (309, 80).'
    )
    // The same answer is not written twice.
    h.watcher.tick()
    expect(h.lines).toHaveLength(2)
  })

  it('gives a hand click in game coordinates when the window is larger', () => {
    // A 150 % display: the release at (459, 115) is the game's (306, 77).
    const h = harness()
    h.resize(960, 720)
    h.open()
    h.handClick(459, 115)
    expect(h.lines).toEqual([
      'Hand click released at (459, 115) = game (306, 77) in a 960 x 720 window on the world map, near "Abel" (307, 77) for map 502.'
    ])
  })

  it('pairs a hand click with the pane closing when the answer was missed', () => {
    const h = harness()
    h.open()
    h.handClick(309, 80)
    h.advance(400)
    h.close()
    h.watcher.tick()
    expect(h.lines[1]).toBe('The world map closed 400 ms after the hand click at game (309, 80).')
  })

  it('reports an answer with no hand click before it', () => {
    const h = harness()
    h.open()
    h.answer(3012)
    h.watcher.tick()
    expect(h.lines).toEqual(['The client sent map 3012 at (18, 63) with no hand click before it.'])
  })

  it('ignores clicks while no pane is open, and a pointer it cannot read', () => {
    const h = harness()
    h.handClick(309, 80)
    expect(h.lines).toEqual([])
    h.open()
    h.lose()
    h.watcher.tick()
    expect(h.lines).toEqual([])
  })

  it('forgets a pane that closed, and starts the next one clean', () => {
    const h = harness()
    h.open()
    h.handClick(100, 100)
    h.close()
    h.watcher.tick()
    h.open()
    h.watcher.tick()
    // One click, one close pairing, and nothing for the fresh pane.
    expect(h.lines).toHaveLength(2)
    expect(h.lines[1]).toMatch(/^The world map closed \d+ ms after the hand click/)
  })
})

describe('the pane watcher on an NPC dialog', () => {
  it('logs a hand click on the dialog and pairs the row the client sent', () => {
    const h = harness()
    h.openDialog()
    h.watcher.tick()
    h.handClick(300, 140)
    expect(h.lines.at(-1)).toBe(
      'Hand click released at game (300, 140) on the dialog from Eduardo (2 rows).'
    )
    h.answerDialog(1612)
    h.watcher.tick()
    expect(h.lines.at(-1)).toBe(
      'The client answered the dialog with row 1 "Rucesion Civics" (1612), 400 ms after the hand click at game (300, 140).'
    )
  })

  it('reports an answer with no hand click before it', () => {
    const h = harness()
    h.openDialog()
    h.watcher.tick()
    h.answerDialog(1615)
    h.watcher.tick()
    expect(h.lines.at(-1)).toBe(
      'The client answered the dialog with row 2 "Rucesion Law" (1615) with no hand click before it.'
    )
  })

  it('ignores a click once the dialog is closed', () => {
    const h = harness()
    h.openDialog()
    h.watcher.tick()
    h.closeDialog()
    h.handClick(300, 140)
    expect(h.lines).toEqual([])
  })
})
