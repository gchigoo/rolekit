import { runSupervisorMain } from './run-supervisor.ts'

const projectRoot = process.argv[2]
const runId = process.argv[3]

if (!projectRoot || !runId) {
  process.stderr.write('Usage: rolekit-supervisor <projectRoot> <runId>\n')
  process.exit(2)
}

runSupervisorMain(projectRoot, runId)
  .then(() => {
    process.exit(0)
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exit(1)
  })
