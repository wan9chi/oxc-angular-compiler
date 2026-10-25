import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { transformForBrowser } from '#binding'
import type { Plugin } from 'vite'

// Application scripts. `.cjs`/`.cts` are left out: the runtime helpers are ES imports.
const SCRIPT_REGEX = /\.(?:[jt]sx?|m[jt]s)$/
const TS_EXT_REGEX = /\.([cm]?)ts(x?)$/

/**
 * Lowers `async` functions, async generators and `for await` to generators in
 * application code when the app runs zone.js, as the Angular CLI does
 * (esbuild `supported: { 'async-await': false }` unless the app is zoneless).
 * zone.js cannot patch native `await`, so without this `fakeAsync`/`tick()`
 * cannot drive code that awaits, and change detection after an `await` is not
 * triggered by a zone task.
 *
 * Helpers are imported from `@oxc-project/runtime`, which Vite resolves itself.
 * Server transforms are left native.
 */
export function asyncLoweringPlugin({
  zoneless,
  sourcemap,
}: {
  zoneless: boolean | undefined
  sourcemap: boolean
}): Plugin {
  let lowerAsync = false

  return {
    name: '@oxc-angular/vite-lower-async',
    configResolved(config) {
      lowerAsync = !(zoneless ?? !isZoneJsInstalled(config.root))
    },
    transform: {
      // After TypeScript is stripped, and after Vitest hoists `vi.mock()`: lowered
      // earlier, an async mock factory becomes an eager `_asyncToGenerator(...)` call
      // that the hoisting would move above the helper's import.
      order: 'post',
      filter: {
        id: { include: SCRIPT_REGEX, exclude: /node_modules/ },
        code: /\basync\b/,
      },
      async handler(code, id, options) {
        if (!lowerAsync || options?.ssr) return

        // The code is JavaScript by now: name it so, or it would be stripped as
        // TypeScript a second time, under Angular's class-field semantics.
        const result = await transformForBrowser(code, id.replace(TS_EXT_REGEX, '.$1js$2'), {
          lowerAsync: true,
          sourcemap,
        })
        if (result.errors.length > 0) {
          this.error(result.errors.join('\n'))
        }
        return { code: result.code, map: result.map ?? null }
      },
    },
  }
}

/**
 * Without an explicit `zoneless`, an app that has zone.js installed is taken to use it. Looked up
 * in `node_modules` rather than with `require.resolve`, which also follows `NODE_PATH` (set by
 * pnpm to its hoisted store).
 */
function isZoneJsInstalled(root: string): boolean {
  if (process.versions['pnp']) {
    try {
      createRequire(join(root, 'package.json')).resolve('zone.js/package.json')
      return true
    } catch {
      return false
    }
  }
  for (let dir = root; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'node_modules/zone.js/package.json'))) return true
    if (dirname(dir) === dir) return false
  }
}
