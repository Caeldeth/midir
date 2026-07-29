import type { DialogStep } from '../../shared/types'
import type { NpcMenu } from '../protocol/decode/dialog'
import type { PursuitMessage } from '../protocol/decode/pursuit'

/**
 * The pure heart of the Laborer: read a dialog, and decide what a step does
 * with it.
 *
 * The one way to get this wrong is to choose an option by its position on
 * screen. Rows move, so a match is on **what the row says and what the pursuit
 * id is**, both of which are in the packet. When nothing matches, the answer is
 * "no match", and the driver stops rather than guess.
 *
 * Two server dialogs feed this: SPursuitMessage 0x30 (a scripted conversation)
 * and SScreenMenu 0x2F (an NPC menu). They carry the pursuit id in different
 * places, so this module first normalises both into one `DialogView`.
 */

/** One choosable row, and the pursuit it answers with, if it has its own. */
export interface DialogViewOption {
  text: string
  /** The row's own pursuit, for a type-0 menu. Undefined otherwise. */
  pursuit?: number
}

/** A dialog on screen, normalised from either server packet. */
export interface DialogView {
  /** The NPC the dialog belongs to. */
  npcName: string
  /** The single pursuit for the whole dialog. Undefined for a per-row menu. */
  pursuit?: number
  /** The prose the dialog shows, when it has any. */
  text?: string
  /** The choosable rows. Empty for a text-entry dialog. */
  options: DialogViewOption[]
  /** True when the dialog asks for typed text, not a choice. */
  isTextInput: boolean
  /** True only for the credential pane. The Laborer never works one. */
  isProtected: boolean
  /** Which packet this came from. */
  source: 'pursuit' | 'menu'
}

/** What a step decided about a dialog. */
export type MatchResult =
  /** Choose the row at this one-based index. */
  | { kind: 'choose'; index: number; option: string }
  /** Type this text into the entry field. */
  | { kind: 'answerText'; text: string }
  /** A credential pane. Stop before any key. */
  | { kind: 'protected' }
  /** Nothing in this dialog matched the step. Stop rather than guess. */
  | { kind: 'noMatch' }

/** Normalise SPursuitMessage 0x30 into a dialog view. */
export function pursuitToView(message: PursuitMessage): DialogView {
  const view: DialogView = {
    npcName: message.npcName,
    pursuit: message.pursuit,
    options: (message.options ?? []).map((option) => ({ text: option.text })),
    // Type 9 is a text input too, but `isProtected` stops it first, so it is
    // reported as protected rather than as an ordinary input.
    isTextInput: message.dialogKind === 'textInput',
    isProtected: message.isProtected,
    source: 'pursuit'
  }
  if (message.text !== undefined) view.text = message.text
  return view
}

/** Normalise SScreenMenu 0x2F into a dialog view. */
export function menuToView(menu: NpcMenu): DialogView {
  const view: DialogView = {
    npcName: menu.npcName,
    options: menu.options.map((option) => {
      const row: DialogViewOption = { text: option.text }
      if (option.pursuit !== undefined) row.pursuit = option.pursuit
      return row
    }),
    isTextInput: menu.isTextInput,
    // SScreenMenu 0x2F has no credential type; only 0x30 type 9 does.
    isProtected: false,
    source: 'menu'
  }
  if (menu.pursuit !== undefined) view.pursuit = menu.pursuit
  view.text = menu.text
  return view
}

function normalise(text: string): string {
  return text.trim().toLowerCase()
}

/**
 * Find the one row a step chooses, or -1 when the match is not unambiguous.
 *
 * An exact match wins. When no row is exactly the wanted text, a single row
 * that contains it is accepted, so a list marker like "1) Deposit" still
 * matches "Deposit". More than one candidate is a refusal, never a guess.
 */
function findRow(options: DialogViewOption[], choose: string): number {
  const want = normalise(choose)
  const exact = options.map((o, i) => (normalise(o.text) === want ? i : -1)).filter((i) => i >= 0)
  if (exact.length === 1) return exact[0]!
  if (exact.length > 1) return -1
  const contains = options
    .map((o, i) => (normalise(o.text).includes(want) ? i : -1))
    .filter((i) => i >= 0)
  return contains.length === 1 ? contains[0]! : -1
}

/**
 * Decide what one step does with the dialog on screen.
 *
 * The order is a safety order: refuse a credential pane first, then guard on the
 * pursuit id, then match the row text. A step never acts on a dialog whose
 * pursuit is not the one it expects.
 */
export function matchStep(step: DialogStep, view: DialogView): MatchResult {
  if (view.isProtected) return { kind: 'protected' }

  if (view.isTextInput) {
    if (view.pursuit !== step.pursuit) return { kind: 'noMatch' }
    if (step.answer === undefined) return { kind: 'noMatch' }
    return { kind: 'answerText', text: step.answer }
  }

  const index = findRow(view.options, step.choose)
  if (index < 0) return { kind: 'noMatch' }

  const row = view.options[index]!
  // A type-0 menu carries a pursuit per row; every other dialog carries one for
  // the whole view. The row's own pursuit wins when it has one.
  const rowPursuit = row.pursuit ?? view.pursuit
  if (rowPursuit !== step.pursuit) return { kind: 'noMatch' }

  return { kind: 'choose', index: index + 1, option: row.text }
}
