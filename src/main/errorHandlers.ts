import type { ErrorEntry } from '../shared/diagnostics'

/**
 * Wire the main process's global error nets to a capture callback.
 *
 * Separate from `index.ts` so it is drop-in and directly unit-testable, and it
 * takes `capture` as an argument rather than importing `sessionLog` for the same
 * reason: a test can assert what a thrown error turns into without a filesystem
 * anywhere near it.
 *
 * **This only OBSERVES.** Registering an `uncaughtException` listener does change
 * Node's behaviour — it suppresses the default print-and-exit — but Electron
 * installs its own listener regardless, and the app's state after one is whatever
 * Electron decides. Midir does not try to recover from it and must not: an
 * uncaught exception in a process that holds a capture handle and a driver's
 * armed window is exactly the moment to stop, not the moment to carry on with
 * unknown invariants. The value here is that the report says what happened.
 */
export function installGlobalErrorHandlers(capture: (entry: ErrorEntry) => void): void {
  process.on('uncaughtException', (err: Error) => {
    capture({
      source: 'uncaughtException',
      origin: 'main',
      message: err?.message ? `${err.name || 'Error'}: ${err.message}` : String(err),
      stack: err?.stack
    })
  })

  // A rejection reason is not necessarily an Error. `String(reason)` is the honest
  // rendering of a rejected string, number or object — better than a message that
  // reads like a stackless Error and sends the reader looking for one.
  process.on('unhandledRejection', (reason: unknown) => {
    const err = reason instanceof Error ? reason : null
    capture({
      source: 'unhandledRejection',
      origin: 'main',
      message: err ? `${err.name || 'Error'}: ${err.message}` : String(reason),
      stack: err?.stack
    })
  })
}
