import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'

type TerminalConnectionState =
    | { status: 'idle' }
    | { status: 'connecting' }
    | { status: 'connected' }
    | { status: 'error'; error: string }

type UseTerminalSocketOptions = {
    baseUrl: string
    token: string
    sessionId: string
    terminalId: string
}

type TerminalReadyPayload = {
    terminalId: string
}

type TerminalOutputPayload = {
    terminalId: string
    data: string
}

type TerminalExitPayload = {
    terminalId: string
    code: number | null
    signal: string | null
}

type TerminalErrorPayload = {
    terminalId: string
    message: string
}

const MAX_SIGTERM_RECOVERY_ATTEMPTS = 6

export function useTerminalSocket(options: UseTerminalSocketOptions): {
    state: TerminalConnectionState
    connect: (cols: number, rows: number) => void
    write: (data: string) => void
    resize: (cols: number, rows: number) => void
    disconnect: () => void
    onOutput: (handler: (data: string) => void) => void
    onExit: (handler: (code: number | null, signal: string | null) => void) => void
} {
    const [state, setState] = useState<TerminalConnectionState>({ status: 'idle' })
    const socketRef = useRef<Socket | null>(null)
    const outputHandlerRef = useRef<(data: string) => void>(() => {})
    const exitHandlerRef = useRef<(code: number | null, signal: string | null) => void>(() => {})
    const terminalIdBaseRef = useRef(options.terminalId)
    const sessionIdRef = useRef(options.sessionId)
    const terminalIdRef = useRef(options.terminalId)
    const terminalIdAttemptRef = useRef(0)
    const needsFreshTerminalIdRef = useRef(false)
    const tokenRef = useRef(options.token)
    const baseUrlRef = useRef(options.baseUrl)
    const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null)
    const lastServerErrorRef = useRef<string | null>(null)
    const sigtermRecoveryAttemptsRef = useRef(0)
    const sigtermRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        sessionIdRef.current = options.sessionId
        terminalIdBaseRef.current = options.terminalId
        terminalIdAttemptRef.current = 0
        terminalIdRef.current = options.terminalId
        needsFreshTerminalIdRef.current = false
        baseUrlRef.current = options.baseUrl
    }, [options.sessionId, options.terminalId, options.baseUrl])

    const allocateFreshTerminalId = useCallback((): string => {
        terminalIdAttemptRef.current += 1
        const nextTerminalId = `${terminalIdBaseRef.current}-${terminalIdAttemptRef.current}`
        terminalIdRef.current = nextTerminalId
        return nextTerminalId
    }, [])

    const resetSigtermRecovery = useCallback(() => {
        sigtermRecoveryAttemptsRef.current = 0
        if (sigtermRecoveryTimerRef.current) {
            clearTimeout(sigtermRecoveryTimerRef.current)
            sigtermRecoveryTimerRef.current = null
        }
    }, [])

    useEffect(() => {
        tokenRef.current = options.token
        const socket = socketRef.current
        if (!socket) {
            return
        }
        if (!options.token) {
            if (socket.connected) {
                socket.disconnect()
            }
            return
        }
        socket.auth = { token: options.token }
        if (socket.connected) {
            socket.disconnect()
            socket.connect()
        }
    }, [options.token])

    const isCurrentTerminal = useCallback((terminalId: string) => terminalId === terminalIdRef.current, [])

    const emitCreate = useCallback((socket: Socket, size: { cols: number; rows: number }) => {
        lastServerErrorRef.current = null
        socket.emit('terminal:create', {
            sessionId: sessionIdRef.current,
            terminalId: terminalIdRef.current,
            cols: size.cols,
            rows: size.rows
        })
    }, [])

    const setErrorState = useCallback((message: string) => {
        console.warn('[terminal] error-state', {
            sessionId: sessionIdRef.current,
            terminalId: terminalIdRef.current,
            message
        })
        setState({ status: 'error', error: message })
    }, [])

    const connect = useCallback((cols: number, rows: number) => {
        lastSizeRef.current = { cols, rows }
        const token = tokenRef.current
        const sessionId = sessionIdRef.current
        const terminalId = terminalIdRef.current

        if (!token || !sessionId || !terminalId) {
            setErrorState('Missing terminal credentials.')
            return
        }

        if (needsFreshTerminalIdRef.current) {
            allocateFreshTerminalId()
            needsFreshTerminalIdRef.current = false
        }

        if (socketRef.current) {
            const socket = socketRef.current
            socket.auth = { token }
            if (socket.connected) {
                emitCreate(socket, { cols, rows })
            } else {
                socket.connect()
            }
            setState({ status: 'connecting' })
            return
        }

        const socket = io(`${baseUrlRef.current}/terminal`, {
            auth: { token },
            path: '/socket.io/',
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            transports: ['polling', 'websocket'],
            autoConnect: false
        })

        socketRef.current = socket
        setState({ status: 'connecting' })

        socket.on('connect', () => {
            const size = lastSizeRef.current ?? { cols, rows }
            setState({ status: 'connecting' })
            emitCreate(socket, size)
        })

        socket.on('terminal:ready', (payload: TerminalReadyPayload) => {
            if (!isCurrentTerminal(payload.terminalId)) {
                return
            }
            needsFreshTerminalIdRef.current = false
            resetSigtermRecovery()
            lastServerErrorRef.current = null
            setState({ status: 'connected' })
        })

        socket.on('terminal:output', (payload: TerminalOutputPayload) => {
            if (!isCurrentTerminal(payload.terminalId)) {
                return
            }
            outputHandlerRef.current(payload.data)
        })

        socket.on('terminal:exit', (payload: TerminalExitPayload) => {
            if (!isCurrentTerminal(payload.terminalId)) {
                return
            }

            console.warn('[terminal] exit', {
                sessionId: sessionIdRef.current,
                terminalId: payload.terminalId,
                code: payload.code,
                signal: payload.signal
            })

            const size = lastSizeRef.current
            const lastServerError = lastServerErrorRef.current
            if (lastServerError?.includes('Failed to attach terminal')) {
                needsFreshTerminalIdRef.current = true
                setErrorState(lastServerError)
                return
            }
            const isRecoverableExit =
                payload.code === null &&
                (payload.signal === 'SIGTERM' || payload.signal === null)
            if (isRecoverableExit && size) {
                const attempt = sigtermRecoveryAttemptsRef.current + 1
                sigtermRecoveryAttemptsRef.current = attempt
                if (attempt <= MAX_SIGTERM_RECOVERY_ATTEMPTS) {
                    const delayMs = Math.min(250 * (2 ** Math.min(attempt - 1, 4)), 3000)

                    console.warn('[terminal] exit-recover', {
                        sessionId: sessionIdRef.current,
                        fromTerminalId: payload.terminalId,
                        nextAttempt: attempt,
                        delayMs
                    })

                    allocateFreshTerminalId()
                    needsFreshTerminalIdRef.current = false
                    setState({ status: 'connecting' })

                    if (sigtermRecoveryTimerRef.current) {
                        clearTimeout(sigtermRecoveryTimerRef.current)
                    }
                    sigtermRecoveryTimerRef.current = setTimeout(() => {
                        sigtermRecoveryTimerRef.current = null
                        if (socket.connected) {
                            emitCreate(socket, size)
                            return
                        }
                        socket.connect()
                    }, delayMs)
                    return
                }

                resetSigtermRecovery()
            }

            needsFreshTerminalIdRef.current = true
            exitHandlerRef.current(payload.code, payload.signal)
            setState((prev) => {
                if (prev.status === 'error' && prev.error.trim()) {
                    return prev
                }
                return { status: 'error', error: 'Terminal exited.' }
            })
        })

        socket.on('terminal:error', (payload: TerminalErrorPayload) => {
            if (!isCurrentTerminal(payload.terminalId)) {
                return
            }
            lastServerErrorRef.current = payload.message
            console.warn('[terminal] server-error', {
                sessionId: sessionIdRef.current,
                terminalId: payload.terminalId,
                message: payload.message
            })
            setErrorState(payload.message)
        })

        socket.on('connect_error', (error) => {
            const message = error instanceof Error ? error.message : 'Connection error'
            console.warn('[terminal] connect-error', {
                sessionId: sessionIdRef.current,
                terminalId: terminalIdRef.current,
                message
            })
            setErrorState(message)
        })

        socket.on('disconnect', (reason) => {
            console.warn('[terminal] disconnect', {
                sessionId: sessionIdRef.current,
                terminalId: terminalIdRef.current,
                reason
            })
            resetSigtermRecovery()
            if (reason === 'io client disconnect') {
                setState({ status: 'idle' })
                return
            }
            setErrorState(`Disconnected: ${reason}`)
        })

        socket.connect()
    }, [allocateFreshTerminalId, emitCreate, resetSigtermRecovery, setErrorState, isCurrentTerminal])

    const write = useCallback((data: string) => {
        const socket = socketRef.current
        if (!socket || !socket.connected) {
            return
        }
        socket.emit('terminal:write', { terminalId: terminalIdRef.current, data })
    }, [])

    const resize = useCallback((cols: number, rows: number) => {
        lastSizeRef.current = { cols, rows }
        const socket = socketRef.current
        if (!socket || !socket.connected) {
            return
        }
        socket.emit('terminal:resize', { terminalId: terminalIdRef.current, cols, rows })
    }, [])

    const disconnect = useCallback(() => {
        const socket = socketRef.current
        if (!socket) {
            return
        }
        resetSigtermRecovery()
        socket.removeAllListeners()
        socket.disconnect()
        socketRef.current = null
        setState({ status: 'idle' })
    }, [resetSigtermRecovery])

    const onOutput = useCallback((handler: (data: string) => void) => {
        outputHandlerRef.current = handler
    }, [])

    const onExit = useCallback((handler: (code: number | null, signal: string | null) => void) => {
        exitHandlerRef.current = handler
    }, [])

    return {
        state,
        connect,
        write,
        resize,
        disconnect,
        onOutput,
        onExit
    }
}
