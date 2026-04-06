import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react'

type NewProjectModalProps = {
    open: boolean
    repoRoot: string
    name: string
    pending: boolean
    error: string | null
    partialSuccess: { programId: string; programName: string } | null
    onRepoRootChange: (value: string) => void
    onNameChange: (value: string) => void
    onSubmit: () => void
    onRetrySeed: () => void
    onClose: () => void
}

export default function NewProjectModal(props: NewProjectModalProps) {
    const dialogRef = useRef<HTMLElement | null>(null)
    const previousFocusRef = useRef<HTMLElement | null>(null)
    const focusableSelector = [
        'button:not([disabled])',
        'input:not([disabled])',
        'textarea:not([disabled])',
        'select:not([disabled])',
        'a[href]',
        '[tabindex]:not([tabindex="-1"])',
    ].join(', ')

    useEffect(() => {
        if (!props.open) {
            return
        }

        previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const dialog = dialogRef.current
        const initialFocusTarget = dialog?.querySelector<HTMLElement>(focusableSelector)
        if (initialFocusTarget) {
            initialFocusTarget.focus()
        } else {
            dialog?.focus()
        }

        return () => {
            previousFocusRef.current?.focus()
            previousFocusRef.current = null
        }
    }, [props.open])

    if (!props.open) {
        return null
    }

    const isSubmitDisabled = props.pending || props.repoRoot.trim().length === 0

    function focusTrap(event: KeyboardEvent<HTMLElement>) {
        if (event.key !== 'Tab') {
            return
        }

        const dialog = dialogRef.current
        if (!dialog) {
            return
        }

        const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
            (element) => !element.hasAttribute('disabled'),
        )

        if (focusableElements.length === 0) {
            event.preventDefault()
            dialog.focus()
            return
        }

        const activeElement = document.activeElement
        const currentIndex = focusableElements.findIndex((element) => element === activeElement)

        if (event.shiftKey) {
            if (currentIndex <= 0) {
                event.preventDefault()
                focusableElements[focusableElements.length - 1]?.focus()
            }
            return
        }

        if (currentIndex === -1 || currentIndex === focusableElements.length - 1) {
            event.preventDefault()
            focusableElements[0]?.focus()
        }
    }

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()

        if (isSubmitDisabled) {
            return
        }

        props.onSubmit()
    }

    function handleFormKeyDown(event: KeyboardEvent<HTMLFormElement>) {
        if (event.key !== 'Enter' || event.defaultPrevented) {
            return
        }

        const target = event.target
        if (!(target instanceof HTMLElement)) {
            return
        }

        const tagName = target.tagName
        if (tagName === 'TEXTAREA' || tagName === 'BUTTON') {
            return
        }

        if (isSubmitDisabled) {
            return
        }

        event.preventDefault()
        event.currentTarget.requestSubmit()
    }

    return (
        <div
            className="prototype-new-project-modal"
            onClick={() => {
                if (!props.pending) {
                    props.onClose()
                }
            }}
        >
            <section
                className="prototype-new-project-modal__dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="new-project-modal-title"
                tabIndex={-1}
                ref={dialogRef}
                onClick={(event) => {
                    event.stopPropagation()
                }}
                onKeyDown={focusTrap}
            >
                <form onSubmit={handleSubmit} onKeyDown={handleFormKeyDown}>
                    <header className="prototype-new-project-modal__header">
                        <h2 id="new-project-modal-title">新建项目</h2>
                        <p>
                            接入一个已有的本地 Git 仓库，缺少 planning 时会自动创建 seed 运行材料。
                        </p>
                    </header>

                    <div className="prototype-new-project-modal__body">
                        <label className="prototype-new-project-modal__field">
                            <span>Repo 路径</span>
                            <input
                                type="text"
                                value={props.repoRoot}
                                disabled={props.pending}
                                onChange={(event) => {
                                    props.onRepoRootChange(event.currentTarget.value)
                                }}
                            />
                        </label>

                        <label className="prototype-new-project-modal__field">
                            <span>项目名</span>
                            <input
                                type="text"
                                value={props.name}
                                disabled={props.pending}
                                onChange={(event) => {
                                    props.onNameChange(event.currentTarget.value)
                                }}
                            />
                        </label>

                        {props.error ? (
                            <p className="prototype-new-project-modal__error" role="alert" aria-live="assertive" aria-atomic="true">
                                {props.error}
                            </p>
                        ) : null}

                        {props.partialSuccess ? (
                            <div className="prototype-new-project-modal__partial-success">
                                <p>
                                    seed 已部分完成：{props.partialSuccess.programName}
                                </p>
                                <button
                                    type="button"
                                    className="prototype-button--ghost"
                                    onClick={props.onRetrySeed}
                                    disabled={props.pending}
                                >
                                    重试 seed
                                </button>
                            </div>
                        ) : null}
                    </div>

                    <footer className="prototype-new-project-modal__actions">
                        <button
                            type="submit"
                            className="prototype-primary-button"
                            disabled={isSubmitDisabled}
                        >
                            创建项目
                        </button>
                        <button
                            type="button"
                            className="prototype-button--ghost"
                            onClick={props.onClose}
                            disabled={props.pending}
                        >
                            取消
                        </button>
                    </footer>
                </form>
            </section>
        </div>
    )
}
