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
                <div className="flex items-center justify-between px-6 py-3 bg-white h-[72px]">
                    {/* Left: Project Branding & Status */}
                    <div className="flex items-center gap-8">
                        <div className="flex flex-col justify-center">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-0.5">One-Man-Company 2.0</span>
                            <div className="flex items-center gap-3">
                                <h1 className="text-lg font-bold text-zinc-900 m-0 leading-none">{props.programName}</h1>
                            </div>
                            <span className="text-[10px] text-zinc-400 font-mono truncate max-w-[200px] mt-0.5" title={props.repoRoot}>
                                {props.repoRoot}
                            </span>
                        </div>

                        {/* Actions right next to the title (mimicking the screenshot) */}
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                aria-label="新建项目"
                                className="flex items-center justify-center px-3 py-1.5 text-xs font-medium text-zinc-600 bg-white border border-zinc-200 rounded hover:bg-zinc-50 hover:text-zinc-900 transition-colors cursor-pointer whitespace-nowrap min-w-[80px]"
                                onClick={openModal}
                            >
                                新建项目
                            </button>
                            <button
                                type="button"
                                className="flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium bg-zinc-900 text-white hover:bg-zinc-800 rounded transition-colors relative whitespace-nowrap min-w-[80px] cursor-pointer"
                                onClick={props.onOpenInbox}
                            >
                                <Glyph name="digest" />
                                <span>消息</span>
                                {props.activeInboxCount > 0 ? (
                                    <strong className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] border-2 border-zinc-900">
                                        {props.activeInboxCount}
                                    </strong>
                                ) : null}
                            </button>
                        </div>
                    </div>

                    {/* Middle: Project Selector */}
                    <div className="flex flex-col items-center justify-center mx-8">
                        <label className="flex items-center gap-3">
                            <span className="text-xs font-medium text-zinc-500 whitespace-nowrap">项目</span>
                            <select
                                value={props.selectedProgramId}
                                onChange={(event) => handleProgramChange(event.target.value)}
                                aria-label="项目"
                                className="bg-white border border-indigo-500 text-zinc-800 text-sm rounded-md focus:ring-indigo-500 focus:border-indigo-500 block p-1.5 hover:bg-zinc-50 transition-colors cursor-pointer min-w-[160px] outline-none"
                            >
                                {props.programs.map((program) => (
                                    <option key={program.id} value={program.id}>
                                        {program.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    {/* Right: Checkpoint Status */}
                    <div className="flex flex-col items-center justify-center max-w-[400px]">
                        <span className="text-sm font-bold text-zinc-900 tracking-tight leading-none mb-1.5">{props.checkpointLabel}</span>
                        <span className="text-[11px] text-zinc-500 font-medium truncate max-w-xs">{props.checkpointSynopsis}</span>
                    </div>
                </div>

                {successMessage ? (
                    <div className="prototype-workspace-bar__toast bg-green-50 px-6 py-2 border-t border-green-100" aria-live="polite" aria-atomic="true">
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
