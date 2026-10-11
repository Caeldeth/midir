import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// The Windows packaging and signing shape in release.yml (HTOO-517), pinned
// because it fails only on a tag, which is the most expensive moment to find a
// fault.
//
// On 2026-09-30 SSL.com moved login.ssl.com to a chain that CodeSignTool's
// bundled JDK 11.0.2 cannot build, so every sign through sslcom/esigner-codesign
// (which runs that JDK) failed with `PKIX path building failed`. The fix runs
// CodeSignTool's jar on Temurin 17 and reads each signature back, because
// CodeSignTool can fail and still exit 0. Ported from the template's copy of oghma's
// release-signing.test.mjs; the file names come from `steps.pkg`, so this copies
// to a fork unchanged. Signing has no `if:` guard on the secrets, so a run
// without them fails instead of shipping unsigned.
//
// Like verify-fuses.test.mjs's config half, this checks the REQUEST, not the
// artifact.

const REPO_ROOT = join(import.meta.dirname, '..')
const RAW = readFileSync(join(REPO_ROOT, '.github/workflows/release.yml'), 'utf8').replace(
  /\r\n/g,
  '\n'
)
// Comments out first: the comments that explain what was removed must name it.
const WORKFLOW = RAW.replace(/^\s*#.*$/gm, '')

/** The body of one step, from its `- name:` to the next step. */
function step(name) {
  const start = WORKFLOW.indexOf(`- name: ${name}`)
  expect(start, `release.yml has no step named "${name}"`).toBeGreaterThan(-1)
  const next = WORKFLOW.indexOf('\n      - ', start + 1)
  return WORKFLOW.slice(start, next === -1 ? undefined : next)
}

describe('Windows packaging and signing in release.yml (HTOO-517)', () => {
  it('builds every Windows target electron-builder.yml declares: no target list here', () => {
    const pkg = step('Package installer + portable exe')
    expect(pkg).toMatch(/run: npx electron-builder --win --publish never\s*$/)
  })

  it('runs CodeSignTool on Temurin 17, never on its bundled JDK', () => {
    expect(WORKFLOW).not.toMatch(/uses: sslcom\/esigner-codesign@/)
    expect(WORKFLOW).not.toMatch(/CodeSignTool\.bat|jdk-11/)
    expect(step('Set up Java 17 for CodeSignTool')).toMatch(
      /uses: actions\/setup-java@v5\n\s+with:\n\s+distribution: temurin\n\s+java-version: '17'/
    )
    expect(step('Sign installer + portable exe')).toContain(
      "Join-Path $env:JAVA_HOME 'bin/java.exe'"
    )
  })

  it('signs both Windows artifacts in one step, and reads each signature back', () => {
    const sign = step('Sign installer + portable exe')
    for (const suffix of ['-setup.exe', '-portable.exe']) {
      expect(sign).toContain(
        `/dist/\${{ steps.pkg.outputs.name }}-\${{ steps.pkg.outputs.version }}${suffix}"`
      )
    }
    expect(sign).toContain('Get-AuthenticodeSignature')
    expect(sign).toContain("-ne 'Valid'")
  })

  it('signs unconditionally, so a run without the secrets fails', () => {
    expect(step('Set up Java 17 for CodeSignTool')).not.toMatch(/^\s+if:/m)
    expect(step('Sign installer + portable exe')).not.toMatch(/^\s+if:/m)
  })

  it('reads the fuses, then signs, then uploads both artifacts and releases both', () => {
    const at = (name) => WORKFLOW.indexOf(`- name: ${name}`)
    const fuses = at('Verify Electron fuses')
    const java = at('Set up Java 17 for CodeSignTool')
    const sign = at('Sign installer + portable exe')
    const upload = at('Upload Windows artifacts')
    expect(fuses).toBeGreaterThan(-1)
    expect(fuses).toBeLessThan(java)
    expect(java).toBeLessThan(sign)
    expect(sign).toBeLessThan(upload)
    const uploadStep = step('Upload Windows artifacts')
    expect(uploadStep).toContain('dist/*-setup.exe')
    expect(uploadStep).toContain('dist/*-portable.exe')
    const release = step('Create GitHub Release')
    expect(release).toContain('artifacts/**/*-setup.exe')
    expect(release).toContain('artifacts/**/*-portable.exe')
  })

  it('needs no Node 20 holdout', () => {
    // The env existed only for esigner-codesign (`using: node20`).
    expect(WORKFLOW).not.toMatch(/^\s*FORCE_JAVASCRIPT_ACTIONS_TO_NODE24:/m)
  })
})
