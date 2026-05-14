import { useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { AttachmentMetadata, DecryptedMessage } from '@/types/api'
import { makeClientSideId } from '@/lib/messages'
import {
    appendOptimisticMessage,
    getMessageWindowState,
    updateMessageStatus,
} from '@/lib/message-window-store'
import { usePlatform } from '@/hooks/usePlatform'

type SendMessageInput = {
    sessionId: string
    sourceSessionId?: string
    text: string
    localId: string
    createdAt: number
    attachments?: AttachmentMetadata[]
}

type BlockedReason = 'no-api' | 'no-session' | 'pending'

type SessionResolution = string | {
    sessionId: string
    notify?: boolean
    handled?: boolean
}

type UseSendMessageOptions = {
    resolveSessionId?: (sessionId: string, message: {
        text: string
        localId: string
        createdAt: number
        attachments?: AttachmentMetadata[]
    }) => Promise<SessionResolution>
    onSessionResolved?: (sessionId: string) => void
    onBlocked?: (reason: BlockedReason) => void
}

function findMessageByLocalId(
    sessionId: string,
    localId: string,
): DecryptedMessage | null {
    const state = getMessageWindowState(sessionId)
    for (const message of state.messages) {
        if (message.localId === localId) return message
    }
    for (const message of state.pending) {
        if (message.localId === localId) return message
    }
    return null
}

function createOptimisticUserMessage(input: {
    localId: string
    text: string
    createdAt: number
    attachments?: AttachmentMetadata[]
}): DecryptedMessage {
    return {
        id: input.localId,
        seq: null,
        localId: input.localId,
        content: {
            role: 'user',
            content: {
                type: 'text',
                text: input.text,
                attachments: input.attachments
            }
        },
        createdAt: input.createdAt,
        status: 'sending',
        originalText: input.text,
    }
}

function updateMessageStatusForResolvedSession(input: SendMessageInput, status: 'sent' | 'failed'): void {
    updateMessageStatus(input.sessionId, input.localId, status)
    if (input.sourceSessionId && input.sourceSessionId !== input.sessionId) {
        updateMessageStatus(input.sourceSessionId, input.localId, status)
    }
}

function normalizeSessionResolution(
    resolution: SessionResolution,
    currentSessionId: string
): { sessionId: string; notify: boolean; handled: boolean } | null {
    if (typeof resolution === 'string') {
        return resolution
            ? { sessionId: resolution, notify: resolution !== currentSessionId, handled: false }
            : null
    }
    const resolvedSessionId = resolution.sessionId.trim()
    if (!resolvedSessionId) {
        return null
    }
    return {
        sessionId: resolvedSessionId,
        notify: resolution.notify ?? resolvedSessionId !== currentSessionId,
        handled: resolution.handled ?? false
    }
}

export function useSendMessage(
    api: ApiClient | null,
    sessionId: string | null,
    options?: UseSendMessageOptions
): {
    sendMessage: (text: string, attachments?: AttachmentMetadata[]) => void
    retryMessage: (localId: string) => void
    isSending: boolean
} {
    const { haptic } = usePlatform()
    const [isResolving, setIsResolving] = useState(false)
    const resolveGuardRef = useRef(false)
    const resolveSessionIdRef = useRef(options?.resolveSessionId)
    const onSessionResolvedRef = useRef(options?.onSessionResolved)
    const onBlockedRef = useRef(options?.onBlocked)

    useEffect(() => {
        resolveSessionIdRef.current = options?.resolveSessionId
        onSessionResolvedRef.current = options?.onSessionResolved
        onBlockedRef.current = options?.onBlocked
    }, [options])

    const mutation = useMutation({
        mutationFn: async (input: SendMessageInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            await api.sendMessage(input.sessionId, input.text, input.localId, input.attachments)
        },
        onSuccess: (_, input) => {
            updateMessageStatusForResolvedSession(input, 'sent')
            haptic.notification('success')
        },
        onError: (_, input) => {
            updateMessageStatusForResolvedSession(input, 'failed')
            haptic.notification('error')
        },
    })

    const sendMessage = useCallback((text: string, attachments?: AttachmentMetadata[]) => {
        if (!api) {
            onBlockedRef.current?.('no-api')
            haptic.notification('error')
            return
        }
        if (!sessionId) {
            onBlockedRef.current?.('no-session')
            haptic.notification('error')
            return
        }
        if (mutation.isPending || resolveGuardRef.current) {
            onBlockedRef.current?.('pending')
            return
        }
        const localId = makeClientSideId('local')
        const createdAt = Date.now()
        appendOptimisticMessage(sessionId, createOptimisticUserMessage({
            localId,
            text,
            createdAt,
            attachments,
        }))
        void (async () => {
            let targetSessionId = sessionId
            const resolveSessionId = resolveSessionIdRef.current
            if (resolveSessionId) {
                resolveGuardRef.current = true
                setIsResolving(true)
                try {
                    const resolved = await resolveSessionId(sessionId, {
                        text,
                        localId,
                        createdAt,
                        attachments,
                    })
                    const resolution = normalizeSessionResolution(resolved, sessionId)
                    if (resolution) {
                        if (resolution.notify) {
                            onSessionResolvedRef.current?.(resolution.sessionId)
                        }
                        targetSessionId = resolution.sessionId
                        if (resolution.handled) {
                            updateMessageStatusForResolvedSession({
                                sessionId: targetSessionId,
                                sourceSessionId: sessionId,
                                text,
                                localId,
                                createdAt,
                                attachments,
                            }, 'sent')
                            haptic.notification('success')
                            return
                        }
                    }
                } catch (error) {
                    updateMessageStatus(sessionId, localId, 'failed')
                    haptic.notification('error')
                    console.error('Failed to resolve session before send:', error)
                    return
                } finally {
                    resolveGuardRef.current = false
                    setIsResolving(false)
                }
            }
            mutation.mutate({
                sessionId: targetSessionId,
                sourceSessionId: sessionId,
                text,
                localId,
                createdAt,
                attachments,
            })
        })()
    }, [api, haptic, mutation.isPending, mutation.mutate, sessionId])

    const retryMessage = useCallback((localId: string) => {
        if (!api) {
            onBlockedRef.current?.('no-api')
            haptic.notification('error')
            return
        }
        if (!sessionId) {
            onBlockedRef.current?.('no-session')
            haptic.notification('error')
            return
        }
        if (mutation.isPending || resolveGuardRef.current) {
            onBlockedRef.current?.('pending')
            return
        }

        const message = findMessageByLocalId(sessionId, localId)
        if (!message?.originalText) return

        updateMessageStatus(sessionId, localId, 'sending')

        mutation.mutate({
            sessionId,
            text: message.originalText,
            localId,
            createdAt: message.createdAt,
        })
    }, [api, haptic, mutation.isPending, mutation.mutate, sessionId])

    return {
        sendMessage,
        retryMessage,
        isSending: mutation.isPending || isResolving,
    }
}
