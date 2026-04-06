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
            <div className="prototype-workspace-bar-shell">
                <div className="prototype-workspace-bar">
                    <div className="prototype-workspace-bar__identity">
                        <p className="prototype-eyebrow">One-Man-Company 2.0</p>
                        <strong>{props.programName}</strong>
                        <span>{props.repoRoot}</span>
                    </div>

                    <label className="prototype-program-picker">
                        <span>项目</span>
                        <select
                            value={props.selectedProgramId}
                            onChange={(event) => handleProgramChange(event.target.value)}
                        >
                            {props.programs.map((program) => (
                                <option key={program.id} value={program.id}>
                                    {program.name}
                                </option>
                            ))}
                        </select>
                    </label>

                    <div className="prototype-workspace-bar__status">
                        <span>{props.checkpointLabel}</span>
                        <small>{props.checkpointSynopsis}</small>
                    </div>

                    <div className="prototype-workspace-bar__actions">
                        <button type="button" className="prototype-button--ghost" onClick={openModal}>
                            新建项目
                        </button>
                        <button
                            type="button"
                            className="prototype-message-toggle prototype-message-toggle--header"
                            onClick={props.onOpenInbox}
                        >
                            <Glyph name="digest" />
                            <span>消息</span>
                            {props.activeInboxCount > 0 ? <strong>{props.activeInboxCount}</strong> : null}
                        </button>
                    </div>
                </div>

                {successMessage ? (
                    <div className="prototype-workspace-bar__toast" aria-live="polite" aria-atomic="true">
                        <p className="prototype-workspace-bar__success" role="status">
                            {successMessage}
                        </p>
                    </div>
                ) : null}

                {live?.error ? (
                    <div className="prototype-workspace-bar__toast">
                        <p className="prototype-workspace-bar__error" role="alert">
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
