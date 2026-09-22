import React from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Snackbar,
  TextField,
  Typography
} from '@mui/material'
import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined'
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined'
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined'
import {
  composeIssueBody,
  copyReportMessage,
  openIssueFailedMessage,
  openIssueMessage,
  DEFAULT_ISSUE_TITLE,
  type ReportMessage
} from '@renderer/lib/reportMessages'

/**
 * Report an issue: a title, what happened, and an EDITABLE diagnostics block.
 *
 * **Editable is the feature, not a courtesy.** Scrubbing is a set of rules about
 * shapes — a path, an email, a URL's userinfo — and the only person who can see what
 * the rules missed is the one about to publish the text. Showing them exactly what
 * will be sent, in a field they can change, is what makes the promise on the label
 * honest. A read-only block would be asking them to trust a regular expression.
 *
 * **Every button leaves the report on the clipboard.** Open GitHub issue copies
 * before it opens, so a link trimmed to fit is completed by one paste and a browser
 * that never appears has cost nothing. That is why the copy is unconditional in
 * `main/diagnostics.ts` rather than conditional on truncation.
 *
 * The block is fetched on OPEN rather than at mount — the dialog is mounted closed
 * in `App`, and a ring buffer read that nobody asked for is a read of stale state by
 * the time it is shown. Re-fetched on every open, so a session that has since gone
 * wrong reports what went wrong.
 *
 * Every sentence it can say lives in `lib/reportMessages.ts`, so each outcome is
 * asserted in the node project rather than off a screenshot — the idiom `RepoList`
 * and the branch menu already follow.
 */
function ReportIssueDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [diagnostics, setDiagnostics] = React.useState('')
  const [message, setMessage] = React.useState<ReportMessage | null>(null)

  React.useEffect(() => {
    if (!open) return
    let live = true
    window.api.diagnostics
      .buildReport()
      .then((block) => {
        if (live) setDiagnostics(block)
      })
      .catch(() => {
        // The report is still worth sending without it — a description of what
        // happened is the part only the user has. Say so in the field, where it is
        // visible and editable, rather than on a snackbar they must remember.
        if (live) setDiagnostics('(diagnostics unavailable)')
      })
    return () => {
      live = false
    }
  }, [open])

  const handleOpenIssue = async (): Promise<void> => {
    try {
      const result = await window.api.diagnostics.openIssue(
        title.trim() || DEFAULT_ISSUE_TITLE,
        composeIssueBody(description, diagnostics)
      )
      setMessage(openIssueMessage(result))
    } catch {
      // Distinct from a refused URL: main threw before it touched the clipboard, so
      // this is the one message that must NOT promise a copy.
      setMessage(openIssueFailedMessage())
    }
  }

  const handleCopy = async (): Promise<void> => {
    try {
      await window.api.diagnostics.copyReport(composeIssueBody(description, diagnostics))
      setMessage(copyReportMessage(true))
    } catch {
      setMessage(copyReportMessage(false))
    }
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>Report an issue</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            Describe what happened. The diagnostics below are attached to the report: the newest
            warnings and errors of this session, scrubbed of usernames, file paths, e-mail
            addresses, and credentials. Read them, and edit them if you want to. The log files
            themselves are not scrubbed; attach one only after you have read it.
          </Typography>

          <TextField
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
            size="small"
            sx={{ mb: 2 }}
          />
          <TextField
            label="What happened?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            minRows={4}
            sx={{ mb: 2 }}
          />
          <TextField
            label="Diagnostics (editable)"
            value={diagnostics}
            onChange={(e) => setDiagnostics(e.target.value)}
            fullWidth
            multiline
            minRows={4}
            // MUI v9: the input element's own props go through `slotProps.htmlInput`.
            slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: '0.8rem' } } }}
          />

          {/* Reveal logs belongs HERE and not on the About card. epona shipped it in
              both places and removed the About-card copy; this triad — open, copy,
              reveal — is the module, and a second button in Settings competes with
              that card's real jobs. It is also the surface where a person actually
              wants the logs. */}
          <Box sx={{ mt: 2 }}>
            <Button
              size="small"
              startIcon={<FolderOpenOutlinedIcon />}
              onClick={() => void window.api.diagnostics.openLogsFolder()}
            >
              Reveal logs folder
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Close</Button>
          <Button startIcon={<ContentCopyOutlinedIcon />} onClick={handleCopy}>
            Copy to clipboard
          </Button>
          <Button
            variant="contained"
            startIcon={<BugReportOutlinedIcon />}
            onClick={handleOpenIssue}
          >
            Open GitHub issue
          </Button>
        </DialogActions>
      </Dialog>

      {/* Outside the Dialog, so the outcome survives the user closing it — and so
          the error boundary's copy of this dialog can still report. */}
      <Snackbar
        open={message !== null}
        autoHideDuration={8000}
        onClose={() => setMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={message?.severity ?? 'info'} onClose={() => setMessage(null)}>
          {message?.text}
        </Alert>
      </Snackbar>
    </>
  )
}

export default ReportIssueDialog
