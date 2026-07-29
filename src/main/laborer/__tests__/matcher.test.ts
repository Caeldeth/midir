import { describe, expect, it } from 'vitest'
import type { DialogStep } from '../../../shared/types'
import type { NpcMenu } from '../../protocol/decode/dialog'
import type { PursuitMessage } from '../../protocol/decode/pursuit'
import { matchStep, menuToView, pursuitToView, type DialogView } from '../matcher'

/**
 * The matcher is the one part of the Laborer that decides what an option is, so
 * it gets the heaviest tests: the match, the moved row, the unmatched dialog,
 * and the credential pane.
 */

function pursuit(overrides: Partial<PursuitMessage> = {}): PursuitMessage {
  return {
    kind: 'pursuitMessage',
    dialogType: 2,
    dialogKind: 'options',
    objectType: 1,
    sourceId: 0x1f6f,
    npcName: 'Donnan',
    pursuit: 0x0064,
    step: 1,
    hasPrevious: false,
    hasNext: false,
    isProtected: false,
    ...overrides
  }
}

const GIVE_CLOUT: DialogStep = { pursuit: 0x0064, choose: 'Give clout' }

describe('matchStep against SPursuitMessage 0x30', () => {
  it('chooses the row whose text matches, by one-based index', () => {
    const view = pursuitToView(
      pursuit({
        options: [{ text: 'Ask about work' }, { text: 'Give clout' }, { text: 'Nothing' }]
      })
    )
    expect(matchStep(GIVE_CLOUT, view)).toEqual({ kind: 'choose', index: 2, option: 'Give clout' })
  })

  it('matches the same row after the rows move', () => {
    // The one way to get this wrong is to choose by position. The match is on
    // text and pursuit, so a reordered menu still selects the right row.
    const view = pursuitToView(
      pursuit({
        options: [{ text: 'Give clout' }, { text: 'Ask about work' }, { text: 'Nothing' }]
      })
    )
    expect(matchStep(GIVE_CLOUT, view)).toEqual({ kind: 'choose', index: 1, option: 'Give clout' })
  })

  it('matches case-insensitively and ignores surrounding space', () => {
    const view = pursuitToView(pursuit({ options: [{ text: '  GIVE CLOUT ' }] }))
    expect(matchStep(GIVE_CLOUT, view)).toMatchObject({ kind: 'choose', index: 1 })
  })

  it('matches a row behind a list marker', () => {
    const view = pursuitToView(
      pursuit({ options: [{ text: '1) Give clout' }, { text: '2) Leave' }] })
    )
    expect(matchStep(GIVE_CLOUT, view)).toMatchObject({ kind: 'choose', index: 1 })
  })

  it('does not match when the pursuit is not the expected one', () => {
    const view = pursuitToView(pursuit({ pursuit: 0x0099, options: [{ text: 'Give clout' }] }))
    expect(matchStep(GIVE_CLOUT, view)).toEqual({ kind: 'noMatch' })
  })

  it('does not match when no row says what the step chooses', () => {
    const view = pursuitToView(
      pursuit({ options: [{ text: 'Ask about work' }, { text: 'Leave' }] })
    )
    expect(matchStep(GIVE_CLOUT, view)).toEqual({ kind: 'noMatch' })
  })

  it('refuses to guess when two rows match', () => {
    const view = pursuitToView(
      pursuit({ options: [{ text: 'Give clout' }, { text: 'Give clout' }] })
    )
    expect(matchStep(GIVE_CLOUT, view)).toEqual({ kind: 'noMatch' })
  })

  it('reports the credential pane before anything else', () => {
    const view = pursuitToView(
      pursuit({ dialogType: 9, dialogKind: 'protected', isProtected: true })
    )
    expect(matchStep({ pursuit: 0x0064, choose: 'anything' }, view)).toEqual({ kind: 'protected' })
  })

  it('answers a text-entry dialog with the step answer', () => {
    const view = pursuitToView(
      pursuit({ dialogType: 4, dialogKind: 'textInput', options: undefined })
    )
    const step: DialogStep = { pursuit: 0x0064, choose: 'quantity', answer: '5' }
    expect(matchStep(step, view)).toEqual({ kind: 'answerText', text: '5' })
  })

  it('does not answer a text-entry dialog that the step has no answer for', () => {
    const view = pursuitToView(
      pursuit({ dialogType: 4, dialogKind: 'textInput', options: undefined })
    )
    expect(matchStep(GIVE_CLOUT, view)).toEqual({ kind: 'noMatch' })
  })
})

function menu(overrides: Partial<NpcMenu> = {}): NpcMenu {
  return {
    kind: 'npcMenu',
    sourceId: 0x1f6f,
    npcName: 'Donnan',
    menuType: 0,
    text: 'What do you need? ',
    isTextInput: false,
    options: [],
    ...overrides
  }
}

describe('matchStep against SScreenMenu 0x2F', () => {
  it('chooses a type-0 row by its own pursuit', () => {
    const view = menuToView(
      menu({
        options: [
          { text: 'Ask about work', pursuit: 0x0102 },
          { text: 'Give clout', pursuit: 0x0101 }
        ]
      })
    )
    const step: DialogStep = { pursuit: 0x0101, choose: 'Give clout' }
    expect(matchStep(step, view)).toEqual({ kind: 'choose', index: 2, option: 'Give clout' })
  })

  it('does not match a type-0 row whose pursuit differs', () => {
    const view = menuToView(menu({ options: [{ text: 'Give clout', pursuit: 0x0999 }] }))
    const step: DialogStep = { pursuit: 0x0101, choose: 'Give clout' }
    expect(matchStep(step, view)).toEqual({ kind: 'noMatch' })
  })

  it('never reports a 0x2F menu as protected', () => {
    const view = menuToView(menu({ options: [{ text: 'Give clout', pursuit: 0x0101 }] }))
    expect(view.isProtected).toBe(false)
  })
})

describe('view normalisation', () => {
  it('keeps a per-row pursuit only when the row has one', () => {
    const view: DialogView = menuToView(
      menu({ menuType: 6, pursuit: 0x0606, options: [{ text: 'Fireball' }] })
    )
    expect(view.pursuit).toBe(0x0606)
    expect(view.options[0]!.pursuit).toBeUndefined()
  })
})
