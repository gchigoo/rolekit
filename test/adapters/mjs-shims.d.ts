declare module '*check-delegated-run.mjs' {
  export interface DelegatedRunCheck {
    ok: boolean
    skill?: string
    source?: string
    commands: Array<{ cmd: string }>
    errors: string[]
  }
  export function checkDelegatedRun(sessionPath: string, runDir: string): DelegatedRunCheck
}

declare module '*extract-pi-session.mjs' {
  export interface ExtractedPiSession {
    skillLoaded: boolean
    commands: Array<{ cmd: string }>
    transcript: string
  }
  export function extractPiSession(raw: string): ExtractedPiSession
}
