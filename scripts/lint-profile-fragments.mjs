/**
 * Cleanliness lint: fragments must not contain source-host proprietary references.
 * Usage: node scripts/lint-profile-fragments.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fragmentsRoot = join(root, 'profiles/fragments')

const forbidden = [
  { label: 'role_agent', re: /role_agent/ },
  { label: 'agentScope', re: /agentScope/ },
  { label: 'delivery-* skill name', re: /delivery-[a-z0-9-]+/ },
]

/**
 * Walks markdown files under dir.
 */
function walkMd(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) {
      walkMd(abs, out)
    } else if (name.endsWith('.md')) {
      out.push(abs)
    }
  }
  return out
}

const files = walkMd(fragmentsRoot)
let failed = false
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  for (const rule of forbidden) {
    if (rule.re.test(text)) {
      process.stderr.write(
        `forbidden ${rule.label} in ${relative(root, file).replace(/\\/g, '/')}\n`,
      )
      failed = true
    }
  }
}

if (!failed) {
  process.stdout.write(`lint-profile-fragments: ${files.length} files clean\n`)
}
process.exit(failed ? 1 : 0)
