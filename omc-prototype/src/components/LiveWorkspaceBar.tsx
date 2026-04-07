import { startTransition, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Glyph } from '@/components/Visuals'
import NewProjectModal from '@/components/NewProjectModal'
import { bootstrapNewProject } from '@/prototype/newProjectBootstrap'
import { usePrototypeRemoteApi } from '@/prototype/remoteApi'
import { usePrototypeStore } from '@/prototype/store'

type LiveWorkspaceBarProps = {
    programName: string
    repoRoot: string
    checkpointLabel: string
    checkpointSynopsis: string
    activeInboxCount: number
    programs: Array<{ id: string; name: string; repoRoot: string }>
    selectedProgramId: string
    onProgramChange: (programId: string) => void
    onOpenInbox: () => void
}

type PartialSuccessState = {
    programId: string
    programName: string
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
        return error.message.trim()
    }

    const message = String(error).trim()
    return message || '项目创建失败，请重试。'
}

export default function LiveWorkspaceBar(props: LiveWorkspaceBarProps) {
    const api = usePrototypeRemoteApi()
    const navigate = useNavigate()
    const { actions, live } = usePrototypeStore()
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [repoRootInput, setRepoRootInput] = useState('')
    const [nameInput, setNameInput] = useState('')
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [partialSuccess, setPartialSuccess] = useState<PartialSuccessState | null>(null)
    const [successMessage, setSuccessMessage] = useState<string | null>(null)

    function clearModalFeedback() {
        setError(null)
        setPartialSuccess(null)
    }

    function closeModal() {
        if (pending) {
            return
        }

        setIsModalOpen(false)
        clearModalFeedback()
    }

    function resetModalState() {
        setRepoRootInput('')
        setNameInput('')
        clearModalFeedback()
        setPending(false)
    }

    async function handleSubmit() {
        setPending(true)
        setError(null)
        setPartialSuccess(null)

        try {
            const result = await bootstrapNewProject(api, {
                repoRoot: repoRootInput,
                name: nameInput,
            })

            startTransition(() => {
                actions.selectProgram?.(result.programId)
            })

            if (result.kind === 'seed-error') {
                setPartialSuccess({
                    programId: result.programId,
                    programName: result.attach.program.name,
                })
                setError(result.error)
                return
            }

            void navigate({ to: '/' })
            setSuccessMessage(result.seedCreated ? '项目已接入，并已创建 planning seed' : '项目已接入')
            setIsModalOpen(false)
            resetModalState()
        } catch (submitError) {
            setError(getErrorMessage(submitError))
        } finally {
            setPending(false)
        }
    }

    async function handleRetrySeed() {
        if (!partialSuccess) {
            return
        }

        setPending(true)
        setError(null)

        try {
            await api.createPlanningSeed(partialSuccess.programId)

            startTransition(() => {
                actions.selectProgram?.(partialSuccess.programId)
            })

            void navigate({ to: '/' })
            setSuccessMessage('项目已接入，并已创建 planning seed')
            setIsModalOpen(false)
            resetModalState()
        } catch (retryError) {
            setError(getErrorMessage(retryError))
        } finally {
            setPending(false)
        }
    }

    function handleProgramChange(programId: string) {
        startTransition(() => {
            props.onProgramChange(programId)
        })
        void navigate({ to: '/' })
    }

    function openModal() {
        setSuccessMessage(null)
        clearModalFeedback()
        setIsModalOpen(true)
    }

    return (
        <>
            <div className="flex flex-col border-b border-zinc-200">
                <div className="flex items-center justify-between px-6 py-4 bg-white">
                    <div className="flex flex-col">
                        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">One-Man-Company 2.0</p>
                        <strong className="text-lg font-bold text-zinc-900">{props.programName}</strong>
                        <span className="text-xs text-zinc-400 font-mono truncate max-w-[200px]">{props.repoRoot}</span>
                    </div>

                    <label className="flex items-center gap-3">
                        <span className="text-sm font-medium text-zinc-600">项目</span>
                        <select
                            value={props.selectedProgramId}
                            onChange={(event) => handleProgramChange(event.target.value)}
                            className="bg-zinc-50 border border-zinc-200 text-zinc-900 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 block w-full p-2 hover:bg-zinc-100 transition-colors cursor-pointer"
                        >
                            {props.programs.map((program) => (
                                <option key={program.id} value={program.id}>
                                    {program.name}
                                </option>
                            ))}
                        </select>
                    </label>

                    <div className="flex flex-col items-center px-4">
                        <span className="text-sm font-medium text-zinc-900">{props.checkpointLabel}</span>
                        <small className="text-xs text-zinc-500">{props.checkpointSynopsis}</small>
                    </div>

                    <div className="flex items-center gap-3">
                        <button type="button" className="px-4 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 shadow-sm transition-colors cursor-pointer whitespace-nowrap min-w-[80px]" onClick={openModal}>
                            新建项目
                        </button>
                        <button
                            type="button"
                            className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-zinc-900 text-white hover:bg-zinc-800 rounded-md shadow-sm transition-colors relative whitespace-nowrap"
                            onClick={props.onOpenInbox}
                        >
                            <Glyph name="digest" />
                            <span>消息</span>
                            {props.activeInboxCount > 0 ? <strong className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[20px] h-[20px] px-1 rounded-full bg-red-500 text-white text-[10px] shadow-sm">{props.activeInboxCount}</strong> : null}
                        </button>
                    </div>
                </div>

                {successMessage ? (
                    <div className="bg-green-50 px-6 py-2 border-t border-green-100" aria-live="polite" aria-atomic="true">
                        <p className="text-sm text-green-700 flex items-center gap-2" role="status">
                            <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
                            {successMessage}
                        </p>
                    </div>
                ) : null}

                {live?.error ? (
                    <div className="bg-red-50 px-6 py-2 border-t border-red-100">
                        <p className="text-sm text-red-700 flex items-center gap-2" role="alert">
                            <span className="w-2 h-2 rounded-full bg-red-500 inline-block"></span>
                            切换项目失败：{live.error}。当前仍显示已加载项目。
                        </p>
                    </div>
                ) : null}
            </div>

            <NewProjectModal
                open={isModalOpen}
                repoRoot={repoRootInput}
                name={nameInput}
                pending={pending}
                error={error}
                partialSuccess={partialSuccess}
                onRepoRootChange={setRepoRootInput}
                onNameChange={setNameInput}
                onSubmit={() => {
                    void handleSubmit()
                }}
                onRetrySeed={() => {
                    void handleRetrySeed()
                }}
                onClose={closeModal}
            />
        </>
    )
}
