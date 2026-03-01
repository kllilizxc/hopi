import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as ts from 'typescript'

const TESTING_LIBRARY_MODULE = '@testing-library/react'
const RENDER_HELPER_IMPORT = '@/test/renderWithProviders'
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx)$/
const SRC_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const POLICY_TEST_PATH = fileURLToPath(import.meta.url)

function collectTestFiles(dirPath: string): string[] {
    const entries = readdirSync(dirPath, { withFileTypes: true })
    const files: string[] = []

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name)

        if (entry.isDirectory()) {
            files.push(...collectTestFiles(fullPath))
            continue
        }

        if (!entry.isFile() || !TEST_FILE_PATTERN.test(entry.name)) {
            continue
        }

        files.push(fullPath)
    }

    return files
}

function findRenderImportViolations(filePath: string): string[] {
    const sourceText = readFileSync(filePath, 'utf8')
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const relativePath = path.relative(SRC_ROOT, filePath)
    const violations: string[] = []

    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) {
            continue
        }

        if (!ts.isStringLiteral(statement.moduleSpecifier)) {
            continue
        }

        if (statement.moduleSpecifier.text !== TESTING_LIBRARY_MODULE) {
            continue
        }

        const importClause = statement.importClause
        if (!importClause) {
            continue
        }

        const line = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1
        if (importClause.name) {
            violations.push(`${relativePath}:${line} disallow default import from ${TESTING_LIBRARY_MODULE}`)
        }

        const namedBindings = importClause.namedBindings
        if (!namedBindings) {
            continue
        }

        if (ts.isNamespaceImport(namedBindings)) {
            violations.push(`${relativePath}:${line} disallow namespace import from ${TESTING_LIBRARY_MODULE}`)
            continue
        }

        for (const element of namedBindings.elements) {
            const importedName = element.propertyName?.text ?? element.name.text
            if (importedName !== 'render') {
                continue
            }

            violations.push(`${relativePath}:${line} disallow importing "render" from ${TESTING_LIBRARY_MODULE}`)
        }
    }

    return violations
}

describe('test render policy', () => {
    it('forces tests to render through renderWithProviders', () => {
        const testFiles = collectTestFiles(SRC_ROOT).filter((filePath) => path.resolve(filePath) !== POLICY_TEST_PATH)
        const violations = testFiles.flatMap((filePath) => findRenderImportViolations(filePath))

        expect(
            violations,
            `Use ${RENDER_HELPER_IMPORT} instead of importing render from ${TESTING_LIBRARY_MODULE}:\n${violations.join('\n')}`
        ).toEqual([])
    })
})
