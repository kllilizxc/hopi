import { ListDirectoryRequestSchema } from '@hopi/protocol/schemas'
import type { DirectoryEntry, ListDirectoryRequest, ListDirectoryResponse } from '@hopi/protocol/types'
import { logger } from '@/ui/logger'
import { readdir, stat } from 'fs/promises'
import { basename, join, resolve } from 'path'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { validatePath } from '../pathSecurity'
import { getErrorMessage, rpcError } from '../rpcResponses'

interface GetDirectoryTreeRequest {
    path: string
    maxDepth: number
    cwd?: string
}

interface TreeNode {
    name: string
    path: string
    type: 'file' | 'directory'
    size?: number
    modified?: number
    children?: TreeNode[]
}

interface GetDirectoryTreeResponse {
    success: boolean
    tree?: TreeNode
    error?: string
}

export function registerDirectoryHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    rpcHandlerManager.registerHandler<ListDirectoryRequest, ListDirectoryResponse>('listDirectory', async (data) => {
        const parsedRequest = ListDirectoryRequestSchema.safeParse(data)
        if (!parsedRequest.success) {
            return rpcError('Invalid directory request')
        }

        logger.debug('List directory request:', parsedRequest.data.path)

        const requestedCwd = parsedRequest.data.cwd
        let scopedWorkingDirectory = workingDirectory
        if (requestedCwd) {
            const cwdValidation = validatePath(requestedCwd, workingDirectory)
            if (!cwdValidation.valid) {
                return rpcError(cwdValidation.error ?? 'Invalid working directory')
            }
            scopedWorkingDirectory = resolve(workingDirectory, requestedCwd)
        }

        const targetPath = parsedRequest.data.path || '.'

        const validation = validatePath(targetPath, scopedWorkingDirectory)
        if (!validation.valid) {
            return rpcError(validation.error ?? 'Invalid directory path')
        }

        try {
            const resolvedPath = resolve(scopedWorkingDirectory, targetPath)
            const entries = await readdir(resolvedPath, { withFileTypes: true })

            const directoryEntries: DirectoryEntry[] = await Promise.all(
                entries.map(async (entry) => {
                    const fullPath = join(resolvedPath, entry.name)
                    let type: 'file' | 'directory' | 'other' = 'other'
                    let size: number | undefined
                    let modified: number | undefined

                    if (entry.isDirectory()) {
                        type = 'directory'
                    } else if (entry.isFile()) {
                        type = 'file'
                    } else if (entry.isSymbolicLink()) {
                        type = 'other'
                    }

                    if (!entry.isSymbolicLink()) {
                        try {
                            const stats = await stat(fullPath)
                            size = stats.size
                            modified = stats.mtime.getTime()
                        } catch (error) {
                            logger.debug(`Failed to stat ${fullPath}:`, error)
                        }
                    }

                    return {
                        name: entry.name,
                        type,
                        size,
                        modified
                    }
                })
            )

            directoryEntries.sort((a, b) => {
                if (a.type === 'directory' && b.type !== 'directory') return -1
                if (a.type !== 'directory' && b.type === 'directory') return 1
                return a.name.localeCompare(b.name)
            })

            return {
                success: true,
                path: resolvedPath,
                entries: directoryEntries
            }
        } catch (error) {
            logger.debug('Failed to list directory:', error)
            return rpcError(getErrorMessage(error, 'Failed to list directory'))
        }
    })

    rpcHandlerManager.registerHandler<GetDirectoryTreeRequest, GetDirectoryTreeResponse>('getDirectoryTree', async (data) => {
        logger.debug('Get directory tree request:', data.path, 'maxDepth:', data.maxDepth)

        const requestedCwd = typeof data.cwd === 'string' ? data.cwd : undefined
        let scopedWorkingDirectory = workingDirectory
        if (requestedCwd) {
            const cwdValidation = validatePath(requestedCwd, workingDirectory)
            if (!cwdValidation.valid) {
                return rpcError(cwdValidation.error ?? 'Invalid working directory')
            }
            scopedWorkingDirectory = resolve(workingDirectory, requestedCwd)
        }

        const targetPath = data.path || '.'

        const validation = validatePath(targetPath, scopedWorkingDirectory)
        if (!validation.valid) {
            return rpcError(validation.error ?? 'Invalid directory path')
        }

        const resolvedRoot = resolve(scopedWorkingDirectory, targetPath)

        async function buildTree(path: string, name: string, currentDepth: number): Promise<TreeNode | null> {
            try {
                const stats = await stat(path)

                const node: TreeNode = {
                    name,
                    path,
                    type: stats.isDirectory() ? 'directory' : 'file',
                    size: stats.size,
                    modified: stats.mtime.getTime()
                }

                if (stats.isDirectory() && currentDepth < data.maxDepth) {
                    const entries = await readdir(path, { withFileTypes: true })
                    const children: TreeNode[] = []

                    await Promise.all(
                        entries.map(async (entry) => {
                            if (entry.isSymbolicLink()) {
                                logger.debug(`Skipping symlink: ${join(path, entry.name)}`)
                                return
                            }

                            const childPath = join(path, entry.name)
                            const childNode = await buildTree(childPath, entry.name, currentDepth + 1)
                            if (childNode) {
                                children.push(childNode)
                            }
                        })
                    )

                    children.sort((a, b) => {
                        if (a.type === 'directory' && b.type !== 'directory') return -1
                        if (a.type !== 'directory' && b.type === 'directory') return 1
                        return a.name.localeCompare(b.name)
                    })

                    node.children = children
                }

                return node
            } catch (error) {
                logger.debug(`Failed to process ${path}:`, error instanceof Error ? error.message : String(error))
                return null
            }
        }

        try {
            if (data.maxDepth < 0) {
                return rpcError('maxDepth must be non-negative')
            }

            const baseName = resolvedRoot === '/' ? '/' : basename(resolvedRoot) || resolvedRoot
            const tree = await buildTree(resolvedRoot, baseName, 0)

            if (!tree) {
                return rpcError('Failed to access the specified path')
            }

            return { success: true, tree }
        } catch (error) {
            logger.debug('Failed to get directory tree:', error)
            return rpcError(getErrorMessage(error, 'Failed to get directory tree'))
        }
    })
}
