import React from 'react'
import { appIdentity } from '@shared/appIdentity'
import { useSettingsStore } from '@renderer/store/settingsStore'
import CaptureIndicator from './CaptureIndicator'
import TitleBar from './TitleBar'
// A 128px webp, not the icon master: this draws at 24px, and vite hashes it
// into the bundle. Regenerate with:
//   magick build/icon.png -resize 128x128 -strip -quality 90 src/renderer/src/assets/midir.webp
import appIcon from '@renderer/assets/midir.webp'

/**
 * Midir's title bar: the house `TitleBar`, wired to Midir's settings, icon and
 * window calls (HTOO-572). The house module stays as the template has it. Change
 * this file, not that one.
 *
 * - The capture indicator is Midir's one bar control. It is a status display,
 *   not an icon control, so it is a child as it is, not a `ChromeButton`.
 * - `platform` is always `win32`. Midir builds for Windows only, and its main
 *   window is frameless on every platform: it has no `hiddenInset` stoplights.
 *   On `darwin` the house bar leaves out the window buttons, so a dev build on
 *   a Mac would have no way to close the window. Midir's preload has no
 *   `platform` for the same reason.
 */
function AppTitleBar(): React.JSX.Element {
  const theme = useSettingsStore((s) => s.theme)
  return (
    <TitleBar
      name={appIdentity.productName}
      icon={appIcon}
      theme={theme}
      platform="win32"
      controls={{
        minimize: () => window.api.minimizeWindow(),
        maximize: () => window.api.maximizeWindow(),
        close: () => window.api.closeWindow()
      }}
    >
      <CaptureIndicator />
    </TitleBar>
  )
}

export default AppTitleBar
