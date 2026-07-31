/**
 * Superpowers 5.1.3 source gate (D11): version, MIT license, 14 skill slugs.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MigrationError } from '../../types.ts'
import { REQUIRED_SKILL_SLUGS, SUPERPOWERS_VERSION } from './templates.ts'

export interface SuperpowersGateResult {
  pluginVersion: string
  skillSlugs: string[]
  licenseText: string
}

/**
 * Validates a Superpowers source root against the frozen 5.1.3 gate.
 */
export async function validateSuperpowersGate(sourceRoot: string): Promise<SuperpowersGateResult> {
  const pluginPath = join(sourceRoot, '.codex-plugin', 'plugin.json')
  let pluginRaw: string
  try {
    pluginRaw = await readFile(pluginPath, 'utf8')
  } catch {
    throw new MigrationError('migration_source_version_unsupported', {
      detail: {
        code: 'migration_source_version_unsupported',
        message_code: 'migration_source_version_unsupported',
        refs: ['.codex-plugin/plugin.json'],
      },
    })
  }

  let plugin: Record<string, unknown>
  try {
    plugin = JSON.parse(pluginRaw) as Record<string, unknown>
  } catch {
    throw new MigrationError('migration_source_version_unsupported', {
      detail: {
        code: 'migration_source_version_unsupported',
        message_code: 'migration_source_version_unsupported',
        refs: ['.codex-plugin/plugin.json:json'],
      },
    })
  }

  if (plugin.name !== 'superpowers' || plugin.version !== SUPERPOWERS_VERSION) {
    throw new MigrationError('migration_source_version_unsupported', {
      detail: {
        code: 'migration_source_version_unsupported',
        message_code: 'migration_source_version_unsupported',
        refs: [`name:${String(plugin.name)}`, `version:${String(plugin.version)}`],
      },
    })
  }

  const licensePath = join(sourceRoot, 'LICENSE')
  let licenseText: string
  try {
    licenseText = await readFile(licensePath, 'utf8')
  } catch {
    throw new MigrationError('migration_license_invalid', {
      detail: {
        code: 'migration_license_invalid',
        message_code: 'migration_license_invalid',
        refs: ['LICENSE'],
      },
    })
  }

  if (!isMitLicense(licenseText)) {
    throw new MigrationError('migration_license_invalid', {
      detail: {
        code: 'migration_license_invalid',
        message_code: 'migration_license_invalid',
        refs: ['LICENSE:content'],
      },
    })
  }

  const skillsDir = join(sourceRoot, 'skills')
  let entries: string[]
  try {
    entries = await readdir(skillsDir)
  } catch {
    throw new MigrationError('migration_source_version_unsupported', {
      detail: {
        code: 'migration_source_version_unsupported',
        message_code: 'migration_source_version_unsupported',
        refs: ['skills/'],
      },
    })
  }

  const skillSlugs = entries.sort()
  const required = [...REQUIRED_SKILL_SLUGS].sort()
  if (skillSlugs.length !== required.length || skillSlugs.some((slug, i) => slug !== required[i])) {
    throw new MigrationError('migration_source_version_unsupported', {
      detail: {
        code: 'migration_source_version_unsupported',
        message_code: 'migration_source_version_unsupported',
        refs: ['skills:slug-set', `expected:${required.length}`, `actual:${skillSlugs.length}`],
      },
    })
  }

  for (const slug of required) {
    try {
      await readFile(join(skillsDir, slug, 'SKILL.md'), 'utf8')
    } catch {
      throw new MigrationError('migration_source_version_unsupported', {
        detail: {
          code: 'migration_source_version_unsupported',
          message_code: 'migration_source_version_unsupported',
          refs: [`skills/${slug}/SKILL.md`],
        },
      })
    }
  }

  return {
    pluginVersion: String(plugin.version),
    skillSlugs: required,
    licenseText,
  }
}

function isMitLicense(text: string): boolean {
  const normalized = text.replace(/\r\n/g, '\n')
  return (
    /MIT License/i.test(normalized) &&
    /Permission is hereby granted, free of charge/i.test(normalized) &&
    /THE SOFTWARE IS PROVIDED "AS IS"/i.test(normalized)
  )
}
