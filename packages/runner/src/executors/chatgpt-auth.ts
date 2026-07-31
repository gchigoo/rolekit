import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { ExecutorIncompatibleError } from '../errors.ts'

const OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

export interface ChatgptAuthTokens {
  access_token: string
  refresh_token: string
  account_id: string
  id_token?: string
}

export interface ChatgptAuthFile {
  auth_mode: string
  tokens: ChatgptAuthTokens
  last_refresh?: string
}

export interface ChatgptAuthDeps {
  fetch?: typeof globalThis.fetch
  env?: NodeJS.ProcessEnv
  homedir?: () => string
  now?: () => number
}

/**
 * Resolves auth.json path: ROLEKIT_CHATGPT_AUTH_FILE or ~/.codex/auth.json.
 */
export function resolveChatgptAuthPath(env: NodeJS.ProcessEnv, home = homedir): string {
  const override = env.ROLEKIT_CHATGPT_AUTH_FILE
  if (typeof override === 'string' && override.trim()) {
    return override.trim()
  }
  return join(home(), '.codex', 'auth.json')
}

/**
 * Loads and validates ChatGPT subscription auth file (no network).
 */
export async function loadChatgptAuth(path: string): Promise<ChatgptAuthFile> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    throw new ExecutorIncompatibleError(
      `ChatGPT auth file missing or unreadable: ${path}`,
      'missing_chatgpt_auth',
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ExecutorIncompatibleError(
      'ChatGPT auth file is not valid JSON',
      'missing_chatgpt_auth',
    )
  }
  const root = asRecord(parsed)
  if (root.auth_mode !== 'chatgpt') {
    throw new ExecutorIncompatibleError('ChatGPT auth_mode must be chatgpt', 'missing_chatgpt_auth')
  }
  const tokens = asRecord(root.tokens)
  const access = typeof tokens.access_token === 'string' ? tokens.access_token.trim() : ''
  const refresh = typeof tokens.refresh_token === 'string' ? tokens.refresh_token.trim() : ''
  const account = typeof tokens.account_id === 'string' ? tokens.account_id.trim() : ''
  if (!refresh && !access) {
    throw new ExecutorIncompatibleError(
      'ChatGPT auth missing access_token and refresh_token',
      'missing_chatgpt_auth',
    )
  }
  if (!account) {
    throw new ExecutorIncompatibleError('ChatGPT auth missing account_id', 'missing_chatgpt_auth')
  }
  return {
    auth_mode: 'chatgpt',
    tokens: {
      access_token: access,
      refresh_token: refresh,
      account_id: account,
      ...(typeof tokens.id_token === 'string' ? { id_token: tokens.id_token } : {}),
    },
    ...(typeof root.last_refresh === 'string' ? { last_refresh: root.last_refresh } : {}),
  }
}

/**
 * Returns true when JWT access_token looks expired (exp - 60s skew).
 * Non-JWT or unparsable tokens are treated as needing refresh if refresh_token exists.
 */
export function isAccessTokenExpired(accessToken: string, nowMs: number): boolean {
  const parts = accessToken.split('.')
  if (parts.length < 2) return true
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      exp?: number
    }
    if (typeof payload.exp !== 'number') return true
    return nowMs >= (payload.exp - 60) * 1000
  } catch {
    return true
  }
}

/**
 * Ensures a usable access_token; refreshes and atomically rewrites auth file when needed.
 */
export async function ensureAccessToken(
  path: string,
  deps: ChatgptAuthDeps = {},
): Promise<{ accessToken: string; accountId: string }> {
  const fetchFn = deps.fetch ?? globalThis.fetch.bind(globalThis)
  const now = deps.now ?? Date.now
  const auth = await loadChatgptAuth(path)
  const { tokens } = auth
  if (tokens.access_token && !isAccessTokenExpired(tokens.access_token, now())) {
    return { accessToken: tokens.access_token, accountId: tokens.account_id }
  }
  if (!tokens.refresh_token) {
    throw new ExecutorIncompatibleError(
      'ChatGPT access_token expired and refresh_token missing',
      'missing_chatgpt_auth',
    )
  }
  const body = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
  })
  let res: Response
  try {
    res = await fetchFn(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  } catch (error) {
    throw new ExecutorIncompatibleError(
      error instanceof Error ? error.message : 'ChatGPT token refresh network error',
      'missing_chatgpt_auth',
    )
  }
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = asRecord(JSON.parse(text))
  } catch {
    parsed = {}
  }
  if (!res.ok) {
    throw new ExecutorIncompatibleError(
      `ChatGPT token refresh failed: HTTP ${res.status}`,
      'missing_chatgpt_auth',
    )
  }
  const access = typeof parsed.access_token === 'string' ? parsed.access_token : tokens.access_token
  const refresh =
    typeof parsed.refresh_token === 'string' ? parsed.refresh_token : tokens.refresh_token
  if (!access) {
    throw new ExecutorIncompatibleError(
      'ChatGPT token refresh returned no access_token',
      'missing_chatgpt_auth',
    )
  }
  const next: ChatgptAuthFile = {
    auth_mode: 'chatgpt',
    tokens: {
      access_token: access,
      refresh_token: refresh,
      account_id: tokens.account_id,
      ...(tokens.id_token ? { id_token: tokens.id_token } : {}),
      ...(typeof parsed.id_token === 'string' ? { id_token: parsed.id_token } : {}),
    },
    last_refresh: new Date(now()).toISOString(),
  }
  await writeAuthFileAtomic(path, next)
  return { accessToken: access, accountId: tokens.account_id }
}

/**
 * Atomically writes auth.json via temp + rename; best-effort chmod on non-Windows.
 */
export async function writeAuthFileAtomic(path: string, auth: ChatgptAuthFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  const payload = `${JSON.stringify(auth, null, 2)}\n`
  await writeFile(tmp, payload, 'utf8')
  try {
    await chmod(tmp, 0o600)
  } catch {
    // Windows may not support POSIX mode; non-blocking
  }
  await rename(tmp, path)
  try {
    await chmod(path, 0o600)
  } catch {
    // ignore
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}
