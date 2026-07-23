import { test, expect } from '@playwright/test'
import { launchApp, getMainWindow } from './helpers.js'

// The settings round-trip end to end: change the theme on the Settings page,
// wait for the debounced save to reach disk, relaunch against the same userData
// dir, and assert it hydrated. This spans renderer store → debounced IPC save →
// atomic disk write → next launch's load() → hydrate() → rendered UI — the whole
// path no single unit test covers.

test.describe('Settings persist across a restart', () => {
  let electronApp
  let localAppData

  test.afterEach(async () => {
    await electronApp?.close()
  })

  test('a theme change survives relaunch', async () => {
    ;({ electronApp, localAppData } = await launchApp())
    let page = await getMainWindow(electronApp)

    // The theme picker lives on the Settings tab. It is a radiogroup of
    // preview cards, one radio per theme, not a dropdown.
    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.getByRole('radio', { name: 'Mundanes (light)' }).click()

    // Wait until the write has actually landed on disk — settings.load() reads
    // settings.json back through the main process, so this confirms persistence
    // without sleeping on the debounce.
    await expect
      .poll(() => page.evaluate(() => window.api.settings.load().then((s) => s.theme)), {
        timeout: 5000
      })
      .toBe('mundanes')

    await electronApp.close()

    // Relaunch, same data dir, no seeding — it must hydrate Mundanes.
    ;({ electronApp } = await launchApp({ localAppData }))
    page = await getMainWindow(electronApp)

    const persisted = await page.evaluate(() => window.api.settings.load().then((s) => s.theme))
    expect(persisted).toBe('mundanes')

    // …and it's actually applied in the hydrated UI.
    await expect(page.getByTestId('app-root')).toHaveAttribute('data-theme', 'mundanes')
    await page.getByRole('tab', { name: 'Settings' }).click()
    await expect(page.getByRole('radio', { name: 'Mundanes (light)' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })
})
