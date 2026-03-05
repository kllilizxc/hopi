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
    text: string
    localId: string
    createdAt: number
    attachments?: AttachmentMetadata[]
}

type BlockedReason = 'no-api' | 'no-session' | 'pending'

type UseSendMessageOptions = {
    resolveSessionId?: (sessionId: string) => Promise<string>
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
        onMutate: async (input) => {
            const optimisticMessage: DecryptedMessage = {
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

            appendOptimisticMessage(input.sessionId, optimisticMessage)
        },
        onSuccess: (_, input) => {
            updateMessageStatus(input.sessionId, input.localId, 'sent')
            haptic.notification('success')
        },
        onError: (_, input) => {
            updateMessageStatus(input.sessionId, input.localId, 'failed')
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
        void (async () => {
            let targetSessionId = sessionId
            const resolveSessionId = resolveSessionIdRef.current
            if (resolveSessionId) {
                resolveGuardRef.current = true
                setIsResolving(true)
                try {
                    const resolved = await resolveSessionId(sessionId)
                    if (resolved && resolved !== sessionId) {
                        onSessionResolvedRef.current?.(resolved)
                        targetSessionId = resolved
                    }
                } catch (error) {
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
