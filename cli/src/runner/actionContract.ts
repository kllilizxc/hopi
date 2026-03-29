import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH } from '@hopi/protocol/brand';
import {
    ProjectActionContractSchema,
    type ProjectActionContract
} from '@hopi/protocol/actions';

export type LoadLocalActionContractResult =
    | {
        kind: 'missing'
        manifestPath: string
    }
    | {
        kind: 'invalid'
        manifestPath: string
        error: string
    }
    | {
        kind: 'valid'
        manifestPath: string
        contract: ProjectActionContract
    }

function formatSchemaIssues(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
            return `${path}: ${issue.message}`;
        })
        .join('; ');
}

export function parseLocalActionContract(options: {
    manifestPath: string
    raw: string
}): LoadLocalActionContractResult {
    let parsedYaml: unknown;
    try {
        parsedYaml = parseYaml(options.raw);
    } catch (error) {
        return {
            kind: 'invalid',
            manifestPath: options.manifestPath,
            error: `YAML parse error: ${error instanceof Error ? error.message : String(error)}`
        };
    }

    const parsed = ProjectActionContractSchema.safeParse(parsedYaml);
    if (!parsed.success) {
        return {
            kind: 'invalid',
            manifestPath: options.manifestPath,
            error: formatSchemaIssues(parsed.error)
        };
    }

    return {
        kind: 'valid',
        manifestPath: options.manifestPath,
        contract: parsed.data
    };
}

export async function loadLocalActionContract(rootPath: string): Promise<LoadLocalActionContractResult> {
    const manifestPath = join(rootPath, PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH);

    let raw: string;
    try {
        raw = await readFile(manifestPath, 'utf8');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('ENOENT') || message.toLowerCase().includes('no such file')) {
            return {
                kind: 'missing',
                manifestPath
            };
        }
        return {
            kind: 'invalid',
            manifestPath,
            error: `Failed to read manifest: ${message}`
        };
    }

    return parseLocalActionContract({ manifestPath, raw });
}
