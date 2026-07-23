# WP1 — scaffold from the house template

**Size:** S. **Depends on:** nothing. Read `00-overview.md` first. **COMPLETE 2026-07-23** — `b20dd5e`.

> Retrospective. Written after the fact from the commit; it records what shipped and why.

## What shipped

A copy of `Repos/hyb-electron-template` renamed to Midir: electron-vite 5, React 19 (classic JSX
runtime), TypeScript 5.7 strict, MUI v9 + Emotion, Zustand 5, Zod 4, Vitest 4 with a node project
and a jsdom project. Frameless window with a custom title bar, `contextIsolation: true`,
`sandbox: false`, the splash and `app:ready` reveal handshake with a 15 s backstop, crash-safe JSON
settings under `%LOCALAPPDATA%\Erisco\Midir`, the six shared themes, the release workflow, and the
Playwright boot spec.

## Decisions that are load-bearing

1. **Take the whole skeleton, rename nothing else.** The template is the house standard, so every
   sibling app (oghma, elatha, creidhne, taliesin) is a working reference for a prop shape or an
   idiom. Diverging costs that.
2. **Six themes ship from day one.** They are shared assets, not a Midir feature; four Dark Ages
   themes plus the corporate pair. The `ThemeName` union lives in `shared/`.
3. **`shared/` stays free of Electron and Node imports** so both processes and the vitest node
   project can import it. This is what later let `items.ts` be a pure module with real tests.
4. **The splash covers hydration, not startup.** The main window stays hidden until the renderer has
   its settings, so nobody sees an unthemed flash.

## What it deliberately did not do

- No app code beyond the template's `Home` page. Everything Midir-specific waited for WP2.
- No `publish:` block wired to a live remote at scaffold time; the repo is `Caeldeth/midir`.

## Where it lives

`src/main/index.ts`, `settingsManager.ts`, `splash.ts`; `src/preload/index.ts`;
`src/renderer/src/App.tsx`, `themes/`, `components/TitleBar.tsx`; `electron.vite.config.mjs`,
`electron-builder.yml`, `vitest.config.mjs`, `.github/workflows/release.yml`.

## How it is verified

The gate, plus `e2e/app-boot.spec.js` and `e2e/settings-persistence.spec.js` from the template.
