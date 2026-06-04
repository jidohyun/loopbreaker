/**
 * import-isolation-sub-ac-3b.test.ts
 *
 * Sub-AC 3b: Import isolation check — MockEmbedClient and all other M3 internal
 * modules must NOT import from the RealEmbedClient file
 * (src/api/real-embed-client.ts).
 *
 * Strategy: static import analysis.
 *   - Read every TypeScript source file under src/
 *   - Parse import/export-from statements
 *   - Assert none of them reference 'real-embed-client'
 *
 * The only allowed reference to real-embed-client is the file itself
 * (src/api/real-embed-client.ts) and the dedicated skeleton test
 * (tests/real-embed-client-sub-ac-3a.test.ts).
 *
 * Rationale: keeping the real-client stub isolated prevents accidental
 * activation of API calls in tests. All tests must use MockEmbedClient.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

// ─── helpers ────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, '..')
const SRC_DIR = join(PROJECT_ROOT, 'src')

/** Recursively collect all .ts files under a directory. */
function collectTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(fullPath))
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath)
    }
  }
  return files
}

/**
 * Return all import/export-from specifiers found in the given source text.
 * Matches:
 *   import ... from '...'
 *   export ... from '...'
 *   import('...')  (dynamic imports)
 */
function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = []

  // Static import/export-from: single or double quotes
  const staticRe = /(?:import|export)\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = staticRe.exec(source)) !== null) {
    specifiers.push(m[1])
  }

  // Dynamic import()
  const dynamicRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((m = dynamicRe.exec(source)) !== null) {
    specifiers.push(m[1])
  }

  return specifiers
}

/** True when a specifier references the real-embed-client module. */
function referencesRealEmbedClient(specifier: string): boolean {
  // Match any specifier containing 'real-embed-client' (with or without .js extension)
  return specifier.includes('real-embed-client')
}

// ─── file sets ───────────────────────────────────────────────────────────────

const allSrcFiles = collectTsFiles(SRC_DIR)

/**
 * Files that are ALLOWED to reference real-embed-client:
 *   - The stub file itself (it IS real-embed-client)
 *   - The ApiClients factory (api-clients.ts) — conditionally returns Real stubs via DI;
 *     the factory is the single gating point; all tests inject Mock via opts.embedClient/mock.
 */
const ALLOWED_REFERENCING_FILES = new Set([
  join(SRC_DIR, 'api', 'real-embed-client.ts'),
  join(SRC_DIR, 'api', 'api-clients.ts'),
])

/** src/ files that must not import real-embed-client */
const filesToCheck = allSrcFiles.filter(f => !ALLOWED_REFERENCING_FILES.has(f))

// ─── tests ───────────────────────────────────────────────────────────────────

describe('Import isolation: no src module imports real-embed-client (Sub-AC 3b)', () => {
  test('src/ tree is non-empty (sanity)', () => {
    expect(allSrcFiles.length).toBeGreaterThan(0)
  })

  test('real-embed-client.ts exists at expected path', () => {
    const path = join(SRC_DIR, 'api', 'real-embed-client.ts')
    expect(() => statSync(path)).not.toThrow()
  })

  test('MockEmbedClient source (embed-client.ts) does not import real-embed-client', () => {
    const filePath = join(SRC_DIR, 'api', 'embed-client.ts')
    const source = readFileSync(filePath, 'utf8')
    const specifiers = extractImportSpecifiers(source)
    const forbidden = specifiers.filter(referencesRealEmbedClient)

    expect(forbidden).toEqual([])
  })

  test('semantic-stage.ts does not import real-embed-client', () => {
    const filePath = join(SRC_DIR, 'detect', 'semantic-stage.ts')
    const source = readFileSync(filePath, 'utf8')
    const specifiers = extractImportSpecifiers(source)
    const forbidden = specifiers.filter(referencesRealEmbedClient)

    expect(forbidden).toEqual([])
  })

  test('m3-pipeline.ts does not import real-embed-client', () => {
    const filePath = join(SRC_DIR, 'detect', 'm3-pipeline.ts')
    const source = readFileSync(filePath, 'utf8')
    const specifiers = extractImportSpecifiers(source)
    const forbidden = specifiers.filter(referencesRealEmbedClient)

    expect(forbidden).toEqual([])
  })

  test('judge-client.ts does not import real-embed-client', () => {
    const filePath = join(SRC_DIR, 'api', 'judge-client.ts')
    const source = readFileSync(filePath, 'utf8')
    const specifiers = extractImportSpecifiers(source)
    const forbidden = specifiers.filter(referencesRealEmbedClient)

    expect(forbidden).toEqual([])
  })

  test('embed-client-providers.ts does not import real-embed-client', () => {
    const filePath = join(SRC_DIR, 'api', 'embed-client-providers.ts')
    const source = readFileSync(filePath, 'utf8')
    const specifiers = extractImportSpecifiers(source)
    const forbidden = specifiers.filter(referencesRealEmbedClient)

    expect(forbidden).toEqual([])
  })

  test('cache-key.ts does not import real-embed-client', () => {
    const filePath = join(SRC_DIR, 'api', 'cache-key.ts')
    const source = readFileSync(filePath, 'utf8')
    const specifiers = extractImportSpecifiers(source)
    const forbidden = specifiers.filter(referencesRealEmbedClient)

    expect(forbidden).toEqual([])
  })

  test('anthropic-judge-client.ts does not import real-embed-client', () => {
    const filePath = join(SRC_DIR, 'api', 'anthropic-judge-client.ts')
    const source = readFileSync(filePath, 'utf8')
    const specifiers = extractImportSpecifiers(source)
    const forbidden = specifiers.filter(referencesRealEmbedClient)

    expect(forbidden).toEqual([])
  })

  test('detection-pipeline.ts does not import real-embed-client', () => {
    const filePath = join(SRC_DIR, 'detect', 'detection-pipeline.ts')
    const source = readFileSync(filePath, 'utf8')
    const specifiers = extractImportSpecifiers(source)
    const forbidden = specifiers.filter(referencesRealEmbedClient)

    expect(forbidden).toEqual([])
  })

  // ── exhaustive: all src/ files except the stub itself ─────────────────────

  describe('exhaustive check: every src/ file except real-embed-client.ts itself', () => {
    for (const filePath of filesToCheck) {
      const label = relative(PROJECT_ROOT, filePath)

      test(`${label} does not import real-embed-client`, () => {
        const source = readFileSync(filePath, 'utf8')
        const specifiers = extractImportSpecifiers(source)
        const forbidden = specifiers.filter(referencesRealEmbedClient)

        if (forbidden.length > 0) {
          throw new Error(
            `${label} imports real-embed-client via: ${JSON.stringify(forbidden)}.\n` +
            `All tests must use MockEmbedClient from src/api/embed-client.ts instead.`
          )
        }

        expect(forbidden).toEqual([])
      })
    }
  })
})
