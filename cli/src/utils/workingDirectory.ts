import { isAbsolute, resolve } from 'node:path'
import { PRODUCT_ENV } from '@hopi/protocol/brand'

export const PRODUCT_CLI_WORKING_DIRECTORY_ENV = PRODUCT_ENV.CLI_WORKING_DIRECTORY

export function resolveCliWorkingDirectory(): string {
    const envDirectory = process.env[PRODUCT_CLI_WORKING_DIRECTORY_ENV]
    if (!envDirectory) {
        return process.cwd()
    }

    const trimmedDirectory = envDirectory.trim()
    if (!trimmedDirectory) {
        return process.cwd()
    }

    return isAbsolute(trimmedDirectory)
        ? trimmedDirectory
        : resolve(process.cwd(), trimmedDirectory)
}
