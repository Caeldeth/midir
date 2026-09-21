import { describe, expect, it } from 'vitest'
import type { DialogStep } from '../../../shared/types'
import type { NpcMenu } from '../../protocol/decode/dialog'
import type { PursuitMessage } from '../../protocol/decode/pursuit'
import { fillStep, matchStep, menuToView, pursuitToView, type DialogView } from '../matcher'

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

  it('does not choose a row when the step has nothing to choose', () => {
    const view = pursuitToView(pursuit({ options: [{ text: 'Give clout' }] }))
    expect(matchStep({ pursuit: 0x0064, answer: 'x' }, view)).toEqual({ kind: 'noMatch' })
  })
})

describe('matchStep with `when`', () => {
  // One pursuit, two dialogs in turn: the step must say which it means.
  const confirm = pursuitToView(
    pursuit({
      pursuit: 588,
      text: 'You may only support one citizen within these four Temuairan days. Are you sure you wish to support one now?',
      options: [{ text: 'I am not sure' }, { text: 'I am sure' }]
    })
  )
  const already = pursuitToView(
    pursuit({
      pursuit: 588,
      text: 'Pandsala is in Temuair now. You can attempt to withdraw your support from the Aisling.',
      options: [{ text: 'I continue to support the Aisling' }, { text: 'Withdraw support' }]
    })
  )

  it('matches only the dialog whose prose contains the `when` text', () => {
    const step: DialogStep = { pursuit: 588, when: 'are you sure', choose: 'I am sure' }
    expect(matchStep(step, confirm)).toEqual({ kind: 'choose', index: 2, option: 'I am sure' })
    expect(matchStep(step, already)).toEqual({ kind: 'noMatch' })
  })

  it('guards a text-entry dialog with `when` too', () => {
    const view = pursuitToView(
      pursuit({
        pursuit: 588,
        dialogType: 4,
        dialogKind: 'textInput',
        options: undefined,
        text: 'Whom shall you support these four Temuairan days?'
      })
    )
    expect(matchStep({ pursuit: 588, when: 'Whom shall you support', answer: 'X' }, view)).toEqual({
      kind: 'answerText',
      text: 'X'
    })
    expect(matchStep({ pursuit: 588, when: 'civil action', answer: 'X' }, view)).toEqual({
      kind: 'noMatch'
    })
  })

  it('treats a `when` on a dialog with no prose as unmet', () => {
    const view = pursuitToView(pursuit({ pursuit: 588, options: [{ text: 'I am sure' }] }))
    expect(matchStep({ pursuit: 588, when: 'sure', choose: 'I am sure' }, view)).toEqual({
      kind: 'noMatch'
    })
  })
})

describe('fillStep', () => {
  it('fills a placeholder in `answer` and `when`, and leaves the rest alone', () => {
    const step: DialogStep = {
      pursuit: 588,
      when: '{citizen} is in Temuair now',
      choose: 'I continue to support the Aisling',
      answer: '{citizen}',
      then: 'done'
    }
    expect(fillStep(step, { citizen: 'Pandsala' })).toEqual({
      pursuit: 588,
      when: 'Pandsala is in Temuair now',
      choose: 'I continue to support the Aisling',
      answer: 'Pandsala',
      then: 'done'
    })
    // The errand data is not changed.
    expect(step.answer).toBe('{citizen}')
  })

  it('leaves a placeholder with no value as it is, so the matcher refuses it', () => {
    expect(fillStep({ pursuit: 1, answer: '{citizen}' }, {})).toEqual({
      pursuit: 1,
      answer: '{citizen}'
    })
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
