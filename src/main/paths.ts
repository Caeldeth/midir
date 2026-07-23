import { isAbsolute, resolve, sep } from 'node:path'

/**
 * Path safety for a name the renderer supplied.
 *
 * Midir opens and deletes files under its own folders only. A name that
 * crosses a folder boundary is refused, not corrected, because there is no
 * correct reading of one.
 */

/**
 * Return the full path of `name` inside `root`.
 *
 * `name` must be a plain file name. A separator, a parent step, an absolute
 * path, and a drive letter are all refused. The resolved path is then checked
 * against `root` again, so a form this code did not think of still cannot
 * escape.
 */
export function assertInsideDir(root: string, name: string): string {
  if (typeof name !== 'string' || name.length === 0) throw new Error('Invalid file name')
  if (name.includes('/') || name.includes('\\')) throw new Error('Invalid file name')
  if (name === '.' || name === '..') throw new Error('Invalid file name')
  if (isAbsolute(name) || /^[a-zA-Z]:/.test(name)) throw new Error('Invalid file name')

  const base = resolve(root)
  const full = resolve(base, name)
  if (!full.startsWith(base + sep)) throw new Error('Invalid file name')
  return full
}
