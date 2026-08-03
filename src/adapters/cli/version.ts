import { freezeJsonSnapshot } from '../../core/json.ts'

export interface ParsedCliVersion {
  readonly raw: string
  readonly version: string
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease?: string
  readonly build?: string
}

export interface CliCompatibilityReport {
  readonly schema: 'rolekit/cli-compatibility@1'
  readonly command: string
  readonly minimumTestedVersion: string
  readonly version?: ParsedCliVersion
  readonly versionMeetsMinimum: boolean
  readonly featureChecks: Readonly<Record<string, boolean>>
  readonly criticalFeatures: readonly string[]
  readonly missingCriticalFeatures: readonly string[]
  readonly compatible: boolean
}

export interface CreateCliCompatibilityReportInput {
  readonly command: string
  readonly versionOutput: string
  readonly minimumTestedVersion: string
  readonly featureChecks: Readonly<Record<string, boolean>>
  readonly criticalFeatures: readonly string[]
}

const VERSION_PATTERN =
  /(?:^|[^0-9A-Za-z.-])v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?(?=$|[^0-9A-Za-z.-])/gu
const NUMERIC_IDENTIFIER_PATTERN = /^\d+$/u
const SEMVER_IDENTIFIER_PATTERN = /^[0-9A-Za-z-]+$/u

function validCoreIdentifier(value: string): boolean {
  return NUMERIC_IDENTIFIER_PATTERN.test(value) && (value === '0' || !value.startsWith('0'))
}

function validIdentifierList(
  value: string | undefined,
  rejectNumericLeadingZeros: boolean,
): boolean {
  if (value === undefined) {
    return true
  }
  const identifiers = value.split('.')
  return identifiers.every(
    (identifier) =>
      identifier.length > 0 &&
      SEMVER_IDENTIFIER_PATTERN.test(identifier) &&
      (!rejectNumericLeadingZeros ||
        !NUMERIC_IDENTIFIER_PATTERN.test(identifier) ||
        identifier === '0' ||
        !identifier.startsWith('0')),
  )
}

export function parseCliVersion(output: string): ParsedCliVersion | undefined {
  for (const candidateLine of output.split(/\r?\n/u)) {
    const raw = candidateLine.trim()
    if (raw.length === 0) {
      continue
    }
    for (const match of raw.matchAll(VERSION_PATTERN)) {
      const majorText = match[1] ?? ''
      const minorText = match[2] ?? ''
      const patchText = match[3] ?? ''
      const prerelease = match[4]
      const build = match[5]
      if (
        ![majorText, minorText, patchText].every(validCoreIdentifier) ||
        !validIdentifierList(prerelease, true) ||
        !validIdentifierList(build, false)
      ) {
        continue
      }
      const major = Number.parseInt(majorText, 10)
      const minor = Number.parseInt(minorText, 10)
      const patch = Number.parseInt(patchText, 10)
      if (![major, minor, patch].every(Number.isSafeInteger)) {
        continue
      }
      return freezeJsonSnapshot(
        {
          raw,
          version: `${major}.${minor}.${patch}${prerelease === undefined ? '' : `-${prerelease}`}${build === undefined ? '' : `+${build}`}`,
          major,
          minor,
          patch,
          ...(prerelease === undefined ? {} : { prerelease }),
          ...(build === undefined ? {} : { build }),
        },
        'Parsed CLI version',
      ) as unknown as ParsedCliVersion
    }
  }
  return undefined
}

function compareNumericIdentifiers(left: string, right: string): number {
  if (left.length !== right.length) {
    return left.length < right.length ? -1 : 1
  }
  return left === right ? 0 : left < right ? -1 : 1
}

function comparePrereleases(left: string, right: string): number {
  const leftIdentifiers = left.split('.')
  const rightIdentifiers = right.split('.')
  const length = Math.max(leftIdentifiers.length, rightIdentifiers.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftIdentifiers[index]
    const rightIdentifier = rightIdentifiers[index]
    if (leftIdentifier === undefined) {
      return -1
    }
    if (rightIdentifier === undefined) {
      return 1
    }
    if (leftIdentifier === rightIdentifier) {
      continue
    }
    const leftNumeric = NUMERIC_IDENTIFIER_PATTERN.test(leftIdentifier)
    const rightNumeric = NUMERIC_IDENTIFIER_PATTERN.test(rightIdentifier)
    if (leftNumeric && rightNumeric) {
      return compareNumericIdentifiers(leftIdentifier, rightIdentifier)
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1
    }
    return leftIdentifier < rightIdentifier ? -1 : 1
  }
  return 0
}

function compareParsedVersions(left: ParsedCliVersion, right: ParsedCliVersion): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) {
      return left[key] < right[key] ? -1 : 1
    }
  }
  if (left.prerelease === right.prerelease) {
    return 0
  }
  if (left.prerelease === undefined) {
    return 1
  }
  if (right.prerelease === undefined) {
    return -1
  }
  return comparePrereleases(left.prerelease, right.prerelease)
}

export function cliVersionAtLeast(version: ParsedCliVersion, minimum: string): boolean {
  const parsedMinimum = parseCliVersion(minimum)
  if (parsedMinimum === undefined) {
    throw new TypeError(`Minimum tested CLI version "${minimum}" is not a supported version.`)
  }
  return compareParsedVersions(version, parsedMinimum) >= 0
}

function sortedFeatureChecks(
  checks: Readonly<Record<string, boolean>>,
): Readonly<Record<string, boolean>> {
  return Object.fromEntries(
    Object.entries(checks).sort(([left], [right]) => left.localeCompare(right)),
  )
}

export function createCliCompatibilityReport(
  input: CreateCliCompatibilityReportInput,
): CliCompatibilityReport {
  const version = parseCliVersion(input.versionOutput)
  const featureChecks = sortedFeatureChecks(input.featureChecks)
  const criticalFeatures = [...new Set(input.criticalFeatures)].sort()
  const missingCriticalFeatures = criticalFeatures.filter(
    (feature) => featureChecks[feature] !== true,
  )
  const versionMeetsMinimum =
    version !== undefined && cliVersionAtLeast(version, input.minimumTestedVersion)
  return freezeJsonSnapshot(
    {
      schema: 'rolekit/cli-compatibility@1',
      command: input.command,
      minimumTestedVersion: input.minimumTestedVersion,
      ...(version === undefined ? {} : { version }),
      versionMeetsMinimum,
      featureChecks,
      criticalFeatures,
      missingCriticalFeatures,
      compatible: versionMeetsMinimum && missingCriticalFeatures.length === 0,
    },
    `CLI compatibility report for "${input.command}"`,
  ) as unknown as CliCompatibilityReport
}
