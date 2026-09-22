// The single per-app identity constant for the house Report Issue module. This is
// the ONE file a sibling app edits to adopt the module; everything else in
// `shared/{scrub,osName,diagnostics,issueUrl}.ts` is drop-in.
//
// No electron/node imports, like every other file in `shared/`: main composes the
// issue URL from it and the renderer names the intake in its copy.
//
// **Midir's own repository is not the intake, and that is the point.** Every house
// app files into `hybrasyl/cernunnos`, one public repository, so a maintainer
// reads Midir's reports beside the other apps' and triages by label.

export interface AppIdentity {
  /** Shown in the diagnostics block, beside the version. */
  productName: string
  /** The public intake repository, the same one for every house app. */
  intakeOwner: string
  intakeRepo: string
  /**
   * Applied through the prefill URL's `labels=` parameter.
   *
   * **It must already exist on the intake repository.** GitHub applies a
   * `labels=` value only for a label that exists and drops it SILENTLY
   * otherwise, so a typo here costs a triage label with no error anywhere.
   * `app:midir` was created on `hybrasyl/cernunnos` on 2026-08-06 (the house
   * module doc, section 9).
   */
  appLabel: string
}

export const appIdentity: AppIdentity = {
  productName: 'Midir',
  intakeOwner: 'hybrasyl',
  intakeRepo: 'cernunnos',
  appLabel: 'app:midir'
}
