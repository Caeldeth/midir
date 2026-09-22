#!/usr/bin/env node
// Verify that the BUILT preload can load inside the sandbox.
//
// Why a script and not a vitest test: the artifact this reads does not exist
// when `npm test` runs. CI's order is typecheck → lint → test → build, for a
// good reason recorded in ci.yml, so a vitest test would have to skip itself
// when `out/` is missing — and a check that skips in the one environment that
// matters is not a check. This runs after the build step instead.
//
// What it is guarding:
//
// A sandboxed preload may `require` exactly one module — `electron`. Anything
// else throws at load. A preload that throws does not warn: it leaves the
// renderer with no `window.api` at all, so the app boots to a blank page.
//
// The trap is that the SOURCE looks correct either way. `import { x } from
// 'some-dep'` and `import { contextBridge } from 'electron'` are the same shape
// on the page. electron-vite externalizes every `dependencies` entry, so the
// import survives into `out/preload/index.js` as a bare require, and the only
// place the difference is visible is the built file. Dagda shipped four
// versions with `sandbox: false` and a comment claiming the preload needed node
// built-ins; it did not, and reading the source is what produced that belief.
// Midir shipped the same way until WP28, with a `@electron-toolkit/preload`
// bridge nothing in the renderer read.
//
// A missing artifact is a FAILURE, not a pass. The whole point is that this
// cannot come back green without having read something.
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const PRELOAD = join(repoRoot, 'out', 'preload', 'index.js')

// The one module the sandbox provides. Electron also polyfills `events`,
// `timers` and `url` in a sandboxed preload, but Midir's preload needs none of
// them and a shorter list is a stricter guard.
const ALLOWED = new Set(['electron'])

function fail(message) {
  console.error(`verify-preload-sandbox: ${message}`)
  process.exit(1)
}

if (!existsSync(PRELOAD)) {
  fail(`no built preload at ${PRELOAD} — run \`npm run build\` first. Not checked is not passed.`)
}

const source = readFileSync(PRELOAD, 'utf8')

// Both quote styles, and `import` as well as `require`: the bundle format is
// CJS today, and a switch to ESM output should not quietly void this.
const specifiers = [
  ...source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g),
  ...source.matchAll(/\bfrom\s*["']([^"']+)["']/g),
  ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)
].map((match) => match[1])

if (specifiers.length === 0) {
  fail(
    'found no module specifiers at all in the built preload — the pattern is wrong, not the file'
  )
}

const forbidden = [...new Set(specifiers)].filter((name) => !ALLOWED.has(name)).sort()

if (forbidden.length > 0) {
  console.error('verify-preload-sandbox: the built preload requires modules the sandbox denies.')
  for (const name of forbidden) console.error(`  ${name}`)
  console.error('')
  console.error('A sandboxed preload may require only `electron`. Each of the above throws at')
  console.error('load, and the renderer then has no bridge at all. Either drop the dependency,')
  console.error('or move what it does into the main process behind an IPC channel.')
  process.exit(1)
}

console.log(`verify-preload-sandbox: OK — ${specifiers.length} specifier(s), all \`electron\`.`)
