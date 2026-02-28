import { isAbsolute, resolve } from 'node:path'

export const HAPI_CLI_WORKING_DIRECTORY_ENV = 'HAPI_CLI_WORKING_DIRECTORY'

export function resolveCliWorkingDirectory(): string {
    const envDirectory = process.env[HAPI_CLI_WORKING_DIRECTORY_ENV]
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
