import { test, expect } from '@playwright/test'
import { copyFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { launchApp, getMainWindow, repoRoot, USERDATA_SUBPATH } from './helpers.js'

// The views built after capture-surface.spec.js, filled from a recording
// (WP21). The app plays `e2e/fixtures/session.ndjson` in place of an adapter
// (`MIDIR_REPLAY`), through the same service a live capture feeds, so what is
// asserted here is the rendered result of a login, an inventory, an equip,
// and a bank read: no Npcap, no adapter, no game. The fixture is synthesised
// by `src/main/__tests__/e2eFixture.test.ts`, which also pins its contents.

const FIXTURE = join(repoRoot, 'e2e', 'fixtures', 'session.ndjson')

/** Launch with the fixture replaying on its own. */
async function launchReplay() {
  const { electronApp, localAppData } = await launchApp({
    seedSettings: { autoStartCapture: true, captureDevice: 'replay' },
    replay: FIXTURE
  })
  return { electronApp, localAppData }
}

test.describe('Replayed session surface', () => {
  let electronApp

  test.afterEach(async () => {
    await electronApp?.close()
  })

  test('the character list and sheet show the login, and the bank card its read', async () => {
    ;({ electronApp } = await launchReplay())
    const page = await getMainWindow(electronApp)

    await page.getByRole('tab', { name: 'Characters' }).click()
    const list = page.getByTestId('character-list')
    await expect(list).toBeVisible({ timeout: 15_000 })
    await expect(list).toContainText('Fintan')
    await expect(list).toContainText('Level 99')

    const sheet = page.getByTestId('character-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('Items carried2 of 60')
    await expect(sheet).toContainText('Raw Fish [65]')

    // The bank: three items at Antonio, with the "as of" time beside them.
    await expect(sheet).toContainText('3 items at Antonio')
    await expect(sheet).toContainText(/read \d+ days? ago/)
    await expect(sheet).toContainText('Bent Crux')
    await expect(sheet).toContainText('Jeweled Dark Belt')
    await expect(sheet).toContainText('Wolf Claw')
  })

  test('the item index lists every item the character holds, and the bank rows', async () => {
    ;({ electronApp } = await launchReplay())
    const page = await getMainWindow(electronApp)

    await page.getByRole('tab', { name: 'Items' }).click()
    const index = page.getByTestId('item-index')
    await expect(index).toBeVisible({ timeout: 15_000 })
    await expect(index).toContainText('Raw Fish')
    await expect(index).toContainText('Staff of Ages')
    await expect(index).toContainText('Wolf Claw')
    await expect(page.getByTestId('gold-total')).toContainText(
      '3,000,000,000 gold across 1 character'
    )

    // A search narrows the rows.
    await page.getByPlaceholder('Search items').fill('crux')
    await expect(index).toContainText('Bent Crux')
    await expect(index).not.toContainText('Raw Fish')
  })

  test('the Diagnostics log and recordings cards render and answer their controls', async () => {
    ;({ electronApp } = await launchReplay())
    const page = await getMainWindow(electronApp)

    // The app wrote no recording of the replay (recording is off), so the
    // recordings card lists the fixture copied into the folder by hand.
    const localAppData = await electronApp.evaluate(() => process.env.LOCALAPPDATA)
    const recordingsDir = join(localAppData, ...USERDATA_SUBPATH, 'recordings')
    mkdirSync(recordingsDir, { recursive: true })
    copyFileSync(FIXTURE, join(recordingsDir, 'session-2026-07-23T13-13-44-000Z.ndjson'))

    await page.getByRole('tab', { name: 'Diagnostics' }).click()

    const log = page.getByTestId('log-section')
    await expect(log).toBeVisible()
    // The replay announces itself in the launch log, and the session that
    // wrote it is the one selected.
    await expect(page.getByTestId('log-lines')).toContainText('Replaying', { timeout: 15_000 })

    // The page lists the folder when it opens, which was after the copy.
    const recordings = page.getByTestId('recordings-section')
    await expect(recordings).toBeVisible()
    await expect(page.getByTestId('recordings-table')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('recordings-total')).toContainText('1 recording')
  })
})
