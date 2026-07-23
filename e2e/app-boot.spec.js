import { test, expect } from '@playwright/test'
import { launchApp, getMainWindow } from './helpers.js'

// Boot smoke: the whole harness + startup handshake in one spec. Launches the
// built app, skips the splash, waits for the main window to be revealed (which
// only happens after the renderer signals app:ready), and asserts the hydrated
// UI is on screen. If this passes, the E2E harness is wired correctly.

test.describe('App boots', () => {
  let electronApp

  test.afterEach(async () => {
    await electronApp?.close()
  })

  test('reveals the main window with the title bar and hydrated content', async () => {
    ;({ electronApp } = await launchApp())
    const page = await getMainWindow(electronApp)

    // Title bar is present with the app name (rename checklist updates this).
    await expect(page.getByTestId('title-bar')).toBeVisible()
    await expect(page.getByTestId('title-bar')).toContainText('Midir')

    // Hydration finished: the real page is shown, not the loading spinner.
    await expect(page.getByTestId('app-hydrating')).toHaveCount(0)
    await expect(page.getByTestId('app-root')).toBeVisible()
  })
})
