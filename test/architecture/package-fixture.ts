import { cp, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repositoryRoot = resolve('.')
const projectPaths = [
  'bin',
  'docs',
  'examples',
  'schemas',
  'scripts',
  'src',
  'README.md',
  'README.zh-CN.md',
  'package-lock.json',
  'package.json',
  'tsconfig.build.json',
  'tsconfig.json',
] as const

export interface IsolatedPackageProject {
  readonly directory: string
  cleanup(): Promise<void>
}

export async function createIsolatedPackageProject(
  prefix: string,
): Promise<IsolatedPackageProject> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  try {
    for (const path of projectPaths) {
      await cp(resolve(repositoryRoot, path), join(directory, path), { recursive: true })
    }
    await symlink(
      resolve(repositoryRoot, 'node_modules'),
      join(directory, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
  } catch (error: unknown) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  return {
    directory,
    async cleanup(): Promise<void> {
      await rm(directory, { recursive: true, force: true })
    },
  }
}
