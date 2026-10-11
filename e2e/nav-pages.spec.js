import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { launchApp, getMainWindow, repoRoot } from './helpers.js'

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
// does not go stale as those pages change.
//
// **The page list is READ from NavBar's `VIEWS`, never typed here.** A hand-kept
// list is the fault this card is about, one level down: WP43 added the World
// tab, and this spec's own list went on without it. Parsing the source means a
// tab added later is opened here on the day it is added. Each tab's marker is
// `page-<view>` on the view container in App.tsx. Diagnostics is behind a
// setting that is on by default. (Taliesin reads its PAGES the same way.)
function readViews() {
  const source = readFileSync(join(repoRoot, 'src/renderer/src/components/NavBar.tsx'), 'utf8')
  const block = /export const VIEWS[^=]*= \[([\s\S]*?)\n\]/.exec(source)
  if (!block) throw new Error('src/renderer/src/components/NavBar.tsx has no `VIEWS` list')
  return [...block[1].matchAll(/\{ name: '(\w+)', label: '([^']+)' \}/g)].map((m) => ({
    view: m[1],
    label: m[2]
  }))
}

const VIEWS = readViews()

/** How long each page runs before it is checked, so a fault in the render that
 *  its first IPC replies start is charged to this page and not the next one.
 *  Taliesin and epona both found faults that a check without it missed. */
const SETTLE_MS = 250

test.describe('every page opens', () => {
  let electronApp

  test.afterEach(async () => {
    await electronApp?.close()
  })

  test('opens each page in turn without crashing', async () => {
    // A parse that found nothing would pass for the wrong reason.
    expect(VIEWS.length, 'views read from NavBar.tsx').toBeGreaterThan(10)
    ;({ electronApp } = await launchApp())
    const page = await getMainWindow(electronApp)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))

    // Midir's ErrorBoundary (keyed on the view) renders its fallback under this
    // testid, so a page that threw is named rather than blanking the window.
    const boundary = page.getByTestId('error-boundary-fallback')

    for (const { view, label } of VIEWS) {
      await test.step(label, async () => {
        await page.getByRole('tab', { name: label, exact: true }).click()

        // The page rendered. Without this the loop would pass on a nav tab that
        // silently changed nothing — the zero-wire pass, one suite over.
        await expect(page.getByTestId(`page-${view}`)).toBeVisible()
        await page.waitForTimeout(SETTLE_MS)

        // And it rendered without throwing. Named per page so a failure says which.
        await expect(boundary, `${view} went to the error boundary`).toHaveCount(0)
        expect(errors, `${view}: page error`).toEqual([])
      })
    }
  })
})
