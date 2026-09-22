/**
 * Whether this launch should drop Chromium to software rasterisation.
 *
 * A Remote Desktop session has no GPU. Windows attaches the Microsoft Remote
 * Display Adapter, so Chromium rasterises in software while still paying for GPU
 * compositing, and every repaint is then captured and encoded by RDP itself.
 * House apps are frameless, so window dragging goes through Chromium's
 * app-region hit testing rather than a native title bar — the more expensive
 * path under exactly these conditions. Reported against epona over RDP,
 * 2026-08-07 (HTOO-325): dragging lags and the app idles at ~10% CPU. Filed
 * against the template because every app cut from it inherits the gap.
 *
 * **Pure, and it reads its arguments rather than `process`.** The call site in
 * `index.ts` supplies both, which is what makes every case in the test a plain
 * function call — `app.disableHardwareAcceleration()` must run before the
 * `ready` event, so the alternative would be a module that cannot be loaded
 * without electron. Three apps independently refused the inline sketch the card
 * started with and arrived at this shape; the template takes the union.
 *
 * **Detection rather than a setting, and that is the card's decision rather than
 * a preference.** The electron call must happen before `ready`; settings load
 * through `fs.promises` with no synchronous path, so a persisted toggle would
 * need a new sync read of `settings.json` at module load, racing the roaming
 * migration. Detecting the environment costs no schema change, no store action,
 * no UI and no migration ordering hazard. A UI toggle is explicitly not wanted:
 * the app should adapt rather than ask.
 *
 * **What this does NOT detect, recorded so nobody reads it as more than it is.**
 *
 * - **`SESSIONNAME` lies after a reconnect, and that is the common case.**
 *   Windows writes it at logon and never revises it. RDP into a machine that
 *   already has your session open at the console and Windows *reconnects* that
 *   session rather than creating a new one — every process keeps reporting
 *   `Console` while running over RDP. That is anyone who leaves a machine
 *   logged in and connects to it later. `GetSystemMetrics(SM_REMOTESESSION)` is
 *   the live signal, but it needs a native `.node` load on the pre-`ready` boot
 *   path. Epona wires it because it already loads `da-win32` for another
 *   reason. Midir loads `da-pcap` at boot, but the addon is loaded inside
 *   `captureService` after `ready`, and a probe for one integer is not worth
 *   moving that load; the `systemRemote` parameter below is where it plugs
 *   in, and Midir passes nothing. Until then the env override is the reconnecting user's recourse,
 *   which promotes it from a debugging convenience to the mitigation — the
 *   README says so under Remote Desktop.
 * - `SESSIONNAME` is a Windows variable. xrdp, X2Go, VNC and Wayland-remote
 *   sessions on Linux get nothing, and neither do Parsec or Sunshine on Windows.
 *
 * The predicate is written so that the reading which needs no measurement is
 * the safe one: anything it is unsure of is treated as local, and a local
 * session's rendering is unchanged.
 */
export interface RenderingEnv {
  /** Windows: `Console` on a local session, `RDP-Tcp#NN` in a remote one. */
  SESSIONNAME?: string | undefined
  /** The override. Any non-empty value forces software rendering; `0` forces it off. */
  MIDIR_DISABLE_GPU?: string | undefined
  /**
   * The index signature exists so `process.env` is assignable. Without it TypeScript's weak-type
   * check rejects the real call site — `ProcessEnv` shares no *declared* property with a type whose
   * members are all optional, so the one argument this function was written for is the one argument
   * it would not take.
   */
  [key: string]: string | undefined
}

/**
 * @param platform `process.platform`.
 * @param env the two variables consulted, normally `process.env`.
 * @param systemRemote a live answer from the OS (`GetSystemMetrics(SM_REMOTESESSION)`)
 *   when the app has a native module to ask; `null` when it does not. Consulted
 *   before `SESSIONNAME` because it survives a reconnect and the variable does not.
 */
export function shouldDisableHardwareAcceleration(
  platform: string,
  env: RenderingEnv,
  systemRemote: boolean | null = null
): boolean {
  // The escape hatch the card sanctions, and it answers in BOTH directions on
  // purpose. Forcing it ON is how the remote path is exercised without an RDP
  // session; forcing it OFF is the only recourse a user has if the detection
  // below is ever wrong on their machine, since there is deliberately no
  // setting. One variable rather than two, and one rule rather than a list of
  // accepted spellings: an unrecognised value must not fall silently through to
  // detection, which would read as an override that did nothing.
  const override = env.MIDIR_DISABLE_GPU
  if (override !== undefined && override !== '') return override !== '0'

  if (platform !== 'win32') return false

  // A live OS answer outranks the variable, because the variable is written
  // once at logon and the OS answer is current.
  if (systemRemote !== null) return systemRemote

  // Unset is treated as LOCAL. `SESSIONNAME` is absent in some service and
  // scheduled-task launch contexts, and the safe default there is to change
  // nothing: a wrongly-disabled GPU on a local session is a slower app, but it is
  // a state nobody asked for and nobody can see the cause of.
  const session = env.SESSIONNAME
  if (!session) return false

  // Windows sets this to `Console` on a local session and `RDP-Tcp#NN` in a remote
  // one. Case-folded rather than compared exactly, because the failure direction of
  // a strict compare is the bad one — a `console` spelled any other way would drop
  // a local session to software rendering.
  return session.toLowerCase() !== 'console'
}

/**
 * The second half of the mitigation, and the half the first adopter shipped
 * without (HTOO-327).
 *
 * Turning the GPU off is only half an answer, because four of the six house
 * themes — `chadul`, `danaan`, `grinneal`, `hybrasyl` — put
 * `backdropFilter: blur(2px)` on `MuiPaper.root`, and `MuiPaper` backs `Card`,
 * `Dialog`, `Accordion` and `Menu`. A blur makes Chromium read back everything
 * behind the surface and blur it on **every repaint**, including every frame of
 * a window drag. With a GPU that is nearly free; under software compositing it
 * is the most expensive thing in the UI — so without this, the app answers a
 * drag-lag report by removing the hardware and keeping the work.
 *
 * Injected with `insertCSS` rather than edited into the themes. The theme
 * objects are hand-written and stay that way — this is a runtime mitigation for
 * one environment, and it reverts by simply not being injected. `dom-ready`
 * fires before first paint, so there is no flash of the blurred style.
 *
 * **Keyed to the DECISION, not to detection.** `MIDIR_DISABLE_GPU=1` on a
 * local machine puts compositing on the CPU just as surely as RDP does, and the
 * blur is expensive for that reason and not because the session is remote.
 * Keying it to detection would make the override reproduce only half the
 * condition it exists to reproduce.
 *
 * **Deliberately nothing but the filter.** Epona's rule also strips
 * `text-shadow`, because its themes put a 4px blur on every glyph. The house
 * themes here declare one `textShadow` each, on `MuiPaginationItem`, and it is
 * a keyline outline at ZERO blur radius — cheap, and what keeps the fantasy
 * themes legible. Stripping it would restyle the app for almost no saving. The
 * house theme set is a common ancestor, not a shared dependency, so **measure
 * your own themes before copying either rule** — oghma's carry no blur at all
 * and ship no CSS.
 *
 * Unconditional across themes on purpose: it is a no-op where there is no blur,
 * which is what makes a mid-session theme switch need no second decision.
 */
export const REMOTE_SESSION_CSS = `
  * {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
`
