import { test, expect } from '@playwright/test'
import { launchApp, getMainWindow } from './helpers.js'

// Open every page, in the real renderer, and check none of them crashed.
//
// **This spec exists because a sibling's suite passed 30 of 30 over a page that
// threw on its first click** (HTOO-393). Balor's Releases tab read
// `process.platform`, which does not exist in a sandboxed renderer. Every unit
// and jsdom assertion passed — vitest runs in Node, where it does — and e2e
// passed too, for a duller reason: no spec had ever clicked the tab. The specs
// that drive a page each drive the one their own work package added, so a new
// page arrives covered by nothing until someone remembers.
//
// `src/renderer/src/lib/__tests__/rendererNodeGlobals.test.ts` catches that one
// class of fault at the source and costs milliseconds. This catches the REST of
// the class — an import that only resolves under vitest's aliases, a hook order
// that only breaks under a real React build, a channel `guardIpc` refuses — and
// it costs one launch.
//
// It asserts on a page-level MARKER rather than on each page's content, so it
// does not go stale as those pages change, and a page added later needs one
// line here. Writing the list is itself the audit: a page with no page-level
// `data-testid` gets one when it is added.

// Every page, with the nav tab that opens it (none for the page that is on
// screen at launch) and the marker that must be visible once it is open. The
// marker is `page-<view>` on the view container in App.tsx, one per entry of
// NavBar's VIEWS. Diagnostics is behind a setting that is on by default.
const PAGES = [
  { name: null, testId: 'page-live' },
  { name: 'Items', testId: 'page-items' },
  { name: 'Characters', testId: 'page-characters' },
  { name: 'Boards', testId: 'page-boards' },
  { name: 'Speaker', testId: 'page-speaker' },
  { name: 'Walker', testId: 'page-walker' },
  { name: 'Errands', testId: 'page-laborer' },
  { name: 'Diagnostics', testId: 'page-diagnostics' },
  { name: 'Settings', testId: 'page-settings' }
]

test.describe('every page opens', () => {
  let electronApp

  test.afterEach(async () => {
    await electronApp?.close()
  })

  test('opens each page in turn without crashing', async () => {
    ;({ electronApp } = await launchApp())
    const page = await getMainWindow(electronApp)

    // Midir's ErrorBoundary (keyed on the view) renders its fallback under this
    // testid, so a page that threw is named rather than blanking the window.
    const boundary = page.getByTestId('error-boundary-fallback')

    for (const { name, testId } of PAGES) {
      if (name) await page.getByRole('tab', { name, exact: true }).click()

      // The page rendered. Without this the loop would pass on a nav button that
      // silently changed nothing — the zero-wire pass, one suite over.
      await expect(page.getByTestId(testId)).toBeVisible()

      // And it rendered without throwing. Named per page so a failure says which.
      await expect(boundary, `${testId} went to the error boundary`).toHaveCount(0)
    }
  })
})
