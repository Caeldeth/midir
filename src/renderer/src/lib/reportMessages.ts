/**
 * What the user is told after trying to send a report.
 *
 * Pure and separate from the dialog, for the reason every other `lib/` module is:
 * an outcome is asserted by a node test rather than read off a screenshot. The
 * wording carries specific weight here, because every sentence is read by somebody
 * whose app has just misbehaved:
 *
 * - **Every message names the clipboard when the clipboard has the report**, which
 *   is all of them except the two that failed before the copy. That is the whole
 *   design of `openIssue` surfacing in the copy: the browser step can fail in ways
 *   Midir cannot fix, and none of them lose the user's work.
 * - **`truncated` is not phrased as an error.** Nothing went wrong: the report was
 *   longer than a link may be, and the fix is one paste. Wording it as a failure
 *   would send people back to re-type a description that is already in their hands.
 * - The intake repository is named from `appIdentity` rather than typed out, so the
 *   sentence cannot drift from the URL the button actually opens.
 */
import { appIdentity } from '@shared/appIdentity'
import type { OpenIssueResult } from '@shared/types'

export type MessageSeverity = 'success' | 'info' | 'error'

export interface ReportMessage {
  severity: MessageSeverity
  text: string
}

const INTAKE = `github.com/${appIdentity.intakeOwner}/${appIdentity.intakeRepo}`

/** Used when the reporter left the title empty. A titled issue sorts; an untitled
 *  one has to be opened before anyone can tell what it is about. */
export const DEFAULT_ISSUE_TITLE = 'Midir issue report'

/**
 * The issue body: what the user wrote, then the diagnostics they reviewed.
 *
 * **The diagnostics go in a fenced block**, which is doing real work rather than
 * looking tidy. GitHub renders an issue body as markdown, and a stack trace is full
 * of `_`, `*` and `<…>` — unfenced, a path with underscores comes out italicised and
 * an angle-bracketed placeholder like `<user>` is eaten as an HTML tag, so the
 * scrubbing that put it there stops being visible to the person reading the report.
 *
 * Pure, and here rather than in the dialog, so the fencing is asserted by a node
 * test. `description` is trimmed; `diagnostics` is not — it is main's own block,
 * possibly edited, and trimming somebody's edit is not this function's business.
 */
export function composeIssueBody(description: string, diagnostics: string): string {
  return `${description.trim()}\n\n\`\`\`\n${diagnostics}\n\`\`\``
}

/** The outcome of **Open GitHub issue**. */
export function openIssueMessage(result: OpenIssueResult): ReportMessage {
  if (result.ok) {
    return result.truncated
      ? {
          severity: 'info',
          text: `Issue opened in your browser. It was too long for a link, so paste the full report from your clipboard.`
        }
      : {
          severity: 'success',
          text: 'Issue opened in your browser. The full report is on your clipboard too.'
        }
  }
  // `unsafe-url` — unreachable unless `appIdentity` is edited into something that is
  // not a web address. The copy already happened, so the sentence offers the manual
  // route rather than only reporting the fault.
  return {
    severity: 'error',
    text: `Midir could not open the issue page. The full report is on your clipboard — paste it into a new issue at ${INTAKE}.`
  }
}

/**
 * The IPC call itself failed — main rejected the payload, or the bridge is gone.
 *
 * Distinct from `unsafe-url` because the clipboard copy has NOT happened: the throw
 * comes from validation, before main touches the clipboard. Promising a clipboard
 * that is empty is worse than reporting the failure plainly.
 */
export function openIssueFailedMessage(): ReportMessage {
  return {
    severity: 'error',
    text: 'Midir could not open the issue page. Copy the report to your clipboard instead.'
  }
}

/** The outcome of **Copy to clipboard**. */
export function copyReportMessage(ok: boolean): ReportMessage {
  return ok
    ? { severity: 'success', text: 'Report copied to your clipboard.' }
    : { severity: 'error', text: 'Midir could not copy the report.' }
}
