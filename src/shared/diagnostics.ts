// Pure assembly of the diagnostics block and of the one-line form a captured error
// takes. No node/electron imports. This module redacts nothing, and must not
// start to: `main/diagnostics.ts` scrubs the assembled block once, and a second
// site here would make it ambiguous which of them a given line went through.
//
// **The block format is the house one, unchanged.** Every sibling app files into
// `hybrasyl/cernunnos`, so a maintainer reads Midir's reports beside creidhne's and
// oghma's; a block that is nicer but different costs more in triage than it pays.

/** A captured error, scrubbed, as held in the ring buffer and rendered to a line. */
export interface ErrorEntry {
  timestamp?: string
  source?: string
  origin?: string
  message?: string
  stack?: string
}

/**
 * Flatten a multi-line stack onto one physical line, joined with " | ".
 *
 * A session log line is one line, deliberately: `grep` over five sessions is the
 * first thing anyone does with these, and a wrapped stack turns one hit into a
 * fragment with no timestamp on it.
 */
function flattenStack(stack: string): string {
  return String(stack)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' | ')
}

/** One-line rendering, used for both the on-disk log and the diagnostics tail. */
export function formatErrorLine(entry: ErrorEntry = {}): string {
  const { timestamp = '', source = 'error', origin = 'main', message = '', stack } = entry
  const head = `${timestamp} [${source}] ${origin} :: ${message}`.trim()
  return stack ? `${head} | ${flattenStack(stack)}` : head
}

export interface DiagnosticsInput {
  productName?: string
  version?: string
  os?: string
  errors?: ErrorEntry[]
}

/**
 * Build the block shown — EDITABLE — in the report dialog and appended to the
 * issue body.
 *
 * The empty case says "No errors captured this session." rather than printing
 * nothing. An absent section reads as a bundle that failed to collect; a sentence
 * reads as an answer, and "the app misbehaved without throwing" is a real and
 * common report.
 */
export function buildDiagnosticsBlock({
  productName = '',
  version = '',
  os = '',
  errors = []
}: DiagnosticsInput = {}): string {
  const lines = [`App: ${productName} ${version}`.trim(), `OS: ${os}`]
  lines.push('--- recent errors (scrubbed) ---')
  if (!errors || errors.length === 0) {
    lines.push('No errors captured this session.')
  } else {
    for (const e of errors) lines.push(formatErrorLine(e))
  }
  return lines.join('\n')
}
