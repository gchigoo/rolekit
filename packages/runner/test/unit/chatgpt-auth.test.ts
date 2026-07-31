import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { ExecutorIncompatibleError } from '../../src/errors.ts'
import {
  ensureAccessToken,
  isAccessTokenExpired,
  loadChatgptAuth,
  resolveChatgptAuthPath,
} from '../../src/executors/chatgpt-auth.ts'

describe('chatgpt-auth', () => {
  it('resolveChatgptAuthPath prefers ROLEKIT_CHATGPT_AUTH_FILE', () => {
    assert.equal(
      resolveChatgptAuthPath(
        { ROLEKIT_CHATGPT_AUTH_FILE: 'D:\\x\\auth.json' },
        () => 'C:\\Users\\u',
      ),
      'D:\\x\\auth.json',
    )
  })

  it('loadChatgptAuth rejects bad auth_mode', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'rk-auth-')), 'auth.json')
    writeFileSync(path, JSON.stringify({ auth_mode: 'api', tokens: {} }), 'utf8')
    await assert.rejects(
      () => loadChatgptAuth(path),
      (err: unknown) =>
        err instanceof ExecutorIncompatibleError && err.code === 'missing_chatgpt_auth',
    )
  })

  it('isAccessTokenExpired respects exp skew', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600
    const jwt = `${b64({ alg: 'none' })}.${b64({ exp })}.x`
    assert.equal(isAccessTokenExpired(jwt, Date.now()), false)
    assert.equal(isAccessTokenExpired(jwt, (exp + 1) * 1000), true)
  })

  it('ensureAccessToken refreshes expired token and rewrites file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rk-auth-'))
    const path = join(dir, 'auth.json')
    const expired = Math.floor(Date.now() / 1000) - 10
    writeFileSync(
      path,
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: `${b64({ alg: 'none' })}.${b64({ exp: expired })}.x`,
          refresh_token: 'rt-old',
          account_id: 'acct-1',
        },
      }),
      'utf8',
    )
    const freshExp = Math.floor(Date.now() / 1000) + 7200
    const fresh = `${b64({ alg: 'none' })}.${b64({ exp: freshExp })}.y`
    const fetchFn: typeof fetch = async () =>
      new Response(JSON.stringify({ access_token: fresh, refresh_token: 'rt-new' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    const result = await ensureAccessToken(path, { fetch: fetchFn })
    assert.equal(result.accessToken, fresh)
    assert.equal(result.accountId, 'acct-1')
    const written = JSON.parse(readFileSync(path, 'utf8')) as {
      tokens: { refresh_token: string }
    }
    assert.equal(written.tokens.refresh_token, 'rt-new')
  })
})

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}
