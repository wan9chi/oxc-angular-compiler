import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Plugin } from 'vite'
import { afterAll, describe, expect, it } from 'vitest'
import { startVitest } from 'vitest/node'

import { angular, type PluginOptions } from '../vite-plugin/index.js'

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/lower-async')

const SOURCE = `export class A {
  b = 1;
  async f() {
    for await (const x of this.xs()) await x;
  }
}
export const g = async () => 1;
`

const roots: string[] = []
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })))

function tempRoot(withZoneJs: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'oxc-angular-lower-async-'))
  roots.push(root)
  if (withZoneJs) {
    const zone = join(root, 'node_modules/zone.js')
    mkdirSync(zone, { recursive: true })
    writeFileSync(join(zone, 'package.json'), '{"name":"zone.js","main":"zone.js"}')
    writeFileSync(join(zone, 'zone.js'), '')
  }
  return root
}

async function transform(
  options: PluginOptions,
  { root = tempRoot(false), ssr = false, id = '/src/a.ts' } = {},
): Promise<string | undefined> {
  const plugin = angular({ liveReload: false, sourceMap: false, ...options }).find(
    (candidate) => candidate.name === '@oxc-angular/vite-lower-async',
  ) as Plugin & { configResolved: (config: unknown) => void; transform: { handler: Function } }
  plugin.configResolved({ root })
  const result = await plugin.transform.handler.call(
    {
      error(message: string) {
        throw new Error(message)
      },
    },
    SOURCE,
    id,
    { ssr },
  )
  return result?.code
}

describe('async lowering for zone.js', () => {
  it('lowers async functions, async generators and for await to generators', async () => {
    const code = await transform({ zoneless: false })
    expect(code).not.toMatch(/\basync\b|for await/)
    expect(code).toContain(
      'import _asyncToGenerator from "@oxc-project/runtime/helpers/asyncToGenerator"',
    )
  })

  it('only lowers async: the class field of the already-stripped TypeScript stays a field', async () => {
    const code = await transform({ zoneless: false })
    expect(code).toMatch(/^\s*b = 1;/m)
    expect(code).not.toContain('this.b')
  })

  it('keeps async native when zoneless', async () => {
    expect(await transform({ zoneless: true })).toBeUndefined()
  })

  it('keeps async native in server (SSR) transforms', async () => {
    expect(await transform({ zoneless: false }, { ssr: true })).toBeUndefined()
  })

  it('defaults to lowering when zone.js resolves from the root, and to native otherwise', async () => {
    expect(await transform({}, { root: tempRoot(true) })).toContain('_asyncToGenerator')
    expect(await transform({}, { root: tempRoot(false) })).toBeUndefined()
  })

  it('runs after Vitest hoists vi.mock, so an async mock factory still finds its helper', async () => {
    const vitest = await startVitest(
      'test',
      [],
      {
        root: fixtureRoot,
        config: false,
        include: ['*.check.ts'],
        environment: './client-environment.ts',
        watch: false,
        reporters: [],
      },
      { plugins: [angular({ zoneless: false, liveReload: false })] },
    )
    const files = vitest.state.getFiles()
    await vitest.close()
    const errors = files.flatMap((file) => [
      ...(file.result?.errors ?? []),
      ...file.tasks.flatMap((task) => task.result?.errors ?? []),
    ])
    expect(errors.map((error) => error.message)).toEqual([])
    expect(files.map((file) => file.result?.state)).toEqual(['pass'])
  }, 60_000)
})
