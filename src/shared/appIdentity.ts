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
  /**
   * Midir's key in the house version manifest (update-check module, WP44).
   *
   * Set here and nowhere else, so a package rename cannot move Midir to a key
   * that nothing writes. The release step writes this same key
   * (`scripts/publish-version.mjs`), and the manifest holds no `midir` entry
   * until the first release: that is `no-entry`, which shows nothing.
   */
  updateKey: string
  /**
   * The update notice opens a manifest `url` only when it starts with this.
   *
   * Anyone with push access to the intake repository can edit the manifest, so
   * this is what stops an edit sending Midir's users to another site. Midir is
   * the one house app outside `hybrasyl/` and `eriscorp/`, so the prefix is not
   * the one the other apps carry.
   */
  releaseUrlPrefix: string
}

export const appIdentity: AppIdentity = {
  productName: 'Midir',
  intakeOwner: 'hybrasyl',
  intakeRepo: 'cernunnos',
  appLabel: 'app:midir',
  updateKey: 'midir',
  releaseUrlPrefix: 'https://github.com/Caeldeth/midir/releases/'
}
