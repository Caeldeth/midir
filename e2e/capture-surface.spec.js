import { test, expect } from '@playwright/test'
import { launchApp, getMainWindow } from './helpers.js'

// Capture is off on a fresh profile, and the app must say so plainly on every
// surface that mentions it. This drives the built app, so it also proves the
// native addon loads inside Electron rather than only under plain Node.

test.describe('Capture surface', () => {
  let electronApp

  test.afterEach(async () => {
    await electronApp?.close()
  })

  test('starts stopped and offers an adapter to choose', async () => {
    ;({ electronApp } = await launchApp())
    const page = await getMainWindow(electronApp)

    // The title bar indicator reports the stopped state.
    const indicator = page.getByTestId('capture-indicator')
    await expect(indicator).toBeVisible()
    await expect(indicator).toHaveAttribute('data-state', 'stopped')

    // The Live page sends the user to Settings rather than showing an empty sheet.
    await expect(page.getByText('Capture is off')).toBeVisible()
    await page.getByRole('button', { name: 'Open settings' }).click()
    await expect(page.getByTestId('capture-settings')).toBeVisible()

    // The addon answered from inside Electron: either it listed adapters, or it
    // said why it could not. Both are correct; a crash or a blank card is not.
    const availability = await page.evaluate(() => window.api.capture.availability())
    expect(typeof availability.available).toBe('boolean')
    if (availability.available) {
      expect(availability.devices.length).toBeGreaterThan(0)
    } else {
      expect(availability.reason).toBeTruthy()
    }
  })

  test('the character list is empty on a fresh profile', async () => {
    ;({ electronApp } = await launchApp())
    const page = await getMainWindow(electronApp)

    await page.getByRole('tab', { name: 'Characters' }).click()
    await expect(page.getByText('No characters yet')).toBeVisible()
  })

  test('the item index is empty on a fresh profile', async () => {
    ;({ electronApp } = await launchApp())
    const page = await getMainWindow(electronApp)

    await page.getByRole('tab', { name: 'Items' }).click()
    await expect(page.getByText('No items yet')).toBeVisible()
  })
})
