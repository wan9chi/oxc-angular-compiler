// Replay check: compare the ngtsc baseline that `vp run compare` left (restored from the cache
// on a hit) with one generated without the cache.
//
//   node .github/replay/baseline.mjs snapshot <baseline> <copy>   copy the baseline, print its hash
//   node .github/replay/baseline.mjs compare <cached> <fresh> [<out dir>]
//                                    print where the two differ; copy both into <out dir> if they do
//
// `compare` prints one `replay-verify:` line per output that differs, exists only in the cached
// baseline or only in the fresh one, and a `replay-verify: done` line with the counts. A
// difference after a cache hit is a false hit unless ngtsc's output is nondeterministic.
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const [command, ...args] = process.argv.slice(2)
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

if (command === 'snapshot') {
  mkdirSync(dirname(args[1]), { recursive: true })
  copyFileSync(args[0], args[1])
  console.log(`replay-verify: snapshot ${hash(args[0])} ${args[0]}`)
} else if (command === 'compare') {
  const [cachedHash, freshHash] = [hash(args[0]), hash(args[1])]
  const cached = JSON.parse(readFileSync(args[0], 'utf8'))
  const fresh = JSON.parse(readFileSync(args[1], 'utf8'))
  for (const field of ['angularVersion', 'typescriptVersion']) {
    if (cached[field] !== fresh[field]) {
      console.log(`replay-verify: ${field} ${cached[field]} -> ${fresh[field]}`)
    }
  }
  const counts = { differs: 0, 'only-cached': 0, 'only-fresh': 0 }
  const keys = [...new Set([...Object.keys(cached.outputs), ...Object.keys(fresh.outputs)])].sort()
  for (const key of keys) {
    const a = cached.outputs[key]
    const b = fresh.outputs[key]
    const kind = !b
      ? 'only-cached'
      : !a
        ? 'only-fresh'
        : JSON.stringify(a) !== JSON.stringify(b)
          ? 'differs'
          : null
    if (!kind) continue
    counts[kind]++
    console.log(`replay-verify: ${kind} ${(a ?? b).fixture} ${key.slice(0, 12)}`)
    if (kind === 'differs') delta(a.code, b.code)
  }
  if (cachedHash !== freshHash && args[2]) {
    mkdirSync(args[2], { recursive: true })
    copyFileSync(args[0], join(args[2], 'cached.json'))
    copyFileSync(args[1], join(args[2], 'fresh.json'))
  }
  console.log(
    `replay-verify: done ${counts.differs} differ, ${counts['only-cached']} only cached, ${counts['only-fresh']} only fresh, ${keys.length} outputs, ${cachedHash === freshHash ? 'same' : 'different'} file`,
  )
} else {
  console.error('Usage: baseline.mjs snapshot <baseline> <copy> | compare <cached> <fresh>')
  process.exit(2)
}

// Print the differing middle of two outputs, trimmed to the common prefix and suffix.
function delta(a, b) {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++
  const show = (s) => JSON.stringify(s.slice(start, s.length - end).slice(0, 200))
  console.log(`replay-verify: delta at ${start}: ${show(a)} -> ${show(b)}`)
}
