import { describe, expect, it, vi } from 'vitest'
import { appIdentity } from '../../../shared/appIdentity'
import { MANIFEST_SCHEMA } from '../../../shared/updateVersion'
import { checkForUpdate } from '../updates'

/**
 * Midir's wiring of the update check (WP44). The module's own behaviour is
 * covered by `shared/__tests__/updateVersion.test.ts` and
 * `main/__tests__/updateCheck.test.ts`; what only Midir can prove is that the
 * handler hands the module **Midir's** identity and **Midir's** running version.
 * Every check here fails if a field of `appIdentity` is wrong, which no test that
 * ships with the module can see.
 */

const entry = (version: string, url: string) => ({
  schema: MANIFEST_SCHEMA,
  apps: { [appIdentity.updateKey]: { version, url } }
})

function ctxWith(
  body: unknown,
  version = '0.1.0'
): { fetchImpl: typeof fetch } & {
  appGetVersion: () => string
} {
  return {
    appGetVersion: () => version,
    fetchImpl: vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as never
  }
}

describe('checkForUpdate (Midir wiring)', () => {
  it('reads Midir’s own key, not another app’s', async () => {
    expect(appIdentity.updateKey).toBe('midir')
    const result = await checkForUpdate(
      ctxWith({
        schema: MANIFEST_SCHEMA,
        apps: {
          oghma: { version: '9.9.9', url: 'https://github.com/eriscorp/oghma/releases/tag/v9.9.9' }
        }
      })
    )
    // Another app being newer is not news about Midir.
    expect(result).toEqual({ ok: false, reason: 'no-entry' })
  })

  it('compares against the running version from ctx.appGetVersion', async () => {
    const url = `${appIdentity.releaseUrlPrefix}tag/v0.2.0`
    const newer = await checkForUpdate(ctxWith(entry('0.2.0', url), '0.1.0'))
    expect(newer).toEqual({ ok: true, update: { version: '0.2.0', url } })

    // The same build already runs it, so there is nothing to say.
    const same = await checkForUpdate(ctxWith(entry('0.2.0', url), '0.2.0'))
    expect(same).toEqual({ ok: true, update: null })
  })

  it('refuses a release URL that is not under Midir’s own releases path', async () => {
    // The manifest is in a repository other maintainers can write. Midir sits
    // outside `hybrasyl/` and `eriscorp/`, so a plausible-looking house URL is
    // still the wrong one.
    const result = await checkForUpdate(
      ctxWith(entry('0.2.0', 'https://github.com/hybrasyl/midir/releases/tag/v0.2.0'))
    )
    expect(result).toEqual({ ok: false, reason: 'bad-url' })
  })

  it('answers no-entry against the live manifest shape, which is the state until the first release', async () => {
    // The real `versions.json` held seven apps and no `midir` on 2026-09-28.
    const result = await checkForUpdate(
      ctxWith({
        schema: MANIFEST_SCHEMA,
        apps: {
          balor: { version: '1.2.1', url: 'https://github.com/eriscorp/balor/releases/tag/v1.2.1' },
          taliesin: {
            version: '2.13.1',
            url: 'https://github.com/hybrasyl/taliesin/releases/tag/v2.13.1'
          }
        }
      })
    )
    expect(result).toEqual({ ok: false, reason: 'no-entry' })
  })
})
