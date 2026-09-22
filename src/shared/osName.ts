// Map Node's `process.platform` to a coarse OS family. Only this simplified token
// ever reaches a diagnostics block — never the OS build, version or architecture,
// each of which narrows an individual machine down rather than describing a class
// of them.
//
// Coarse is also enough to act on: Midir is Windows first (Npcap), and almost every bug that
// turns on the platform turns on the family (`shell.openPath` has no handler,
// `safeStorage` has no keyring, a GUI launch has no login PATH). A reporter who
// needs to say more can type it into the description, which is theirs to edit.

export type OsFamily = 'windows' | 'macOS' | 'linux' | 'other'

export function simplifyPlatform(platform: string | undefined): OsFamily {
  switch (platform) {
    case 'win32':
      return 'windows'
    case 'darwin':
      return 'macOS'
    case 'linux':
      return 'linux'
    default:
      return 'other'
  }
}
