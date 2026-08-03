export interface ControlledNpmPaths {
  readonly userConfig: string
  readonly globalConfig: string
  readonly cache?: string
}

const allowedRetrievalConfig = new Set([
  '_auth',
  '_auth-token',
  '_authtoken',
  '_password',
  'always-auth',
  'ca',
  'cafile',
  'cert',
  'https-proxy',
  'key',
  'no-proxy',
  'noproxy',
  'proxy',
  'registry',
  'strict-ssl',
  'username',
])

function normalizedNpmConfigName(key: string): string | undefined {
  if (!/^npm_config_/iu.test(key)) {
    return undefined
  }
  const name = key.slice('npm_config_'.length)
  if (name.startsWith('//')) {
    return name.toLowerCase()
  }
  return name.replaceAll('_', '-').toLowerCase()
}

function isRetrievalConfig(name: string): boolean {
  if (allowedRetrievalConfig.has(name)) {
    return true
  }
  if (/^@[^:]+:registry$/u.test(name)) {
    return true
  }
  return (
    name.startsWith('//') &&
    /:(?:_auth|_auth-token|_authtoken|_password|always-auth|cert|key|username)$/u.test(name)
  )
}

export function createControlledNpmEnvironment(
  environment: NodeJS.ProcessEnv,
  paths: ControlledNpmPaths,
): NodeJS.ProcessEnv {
  const controlled: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(environment)) {
    const configName = normalizedNpmConfigName(key)
    if (configName === undefined || isRetrievalConfig(configName)) {
      controlled[key] = value
    }
  }
  controlled.NPM_CONFIG_USERCONFIG = paths.userConfig
  controlled.NPM_CONFIG_GLOBALCONFIG = paths.globalConfig
  if (paths.cache !== undefined) {
    controlled.NPM_CONFIG_CACHE = paths.cache
  }
  return controlled
}
