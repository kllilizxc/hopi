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
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm transition-opacity"
            onClick={() => {
                if (!props.pending) {
                    props.onClose()
                }
            }}
        >
            <section
                className="w-full max-w-md bg-white rounded-xl shadow-2xl overflow-hidden transform transition-all"
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
                    <header className="px-6 py-5 border-b border-zinc-100 bg-zinc-50/50">
                        <h2 id="new-project-modal-title" className="text-xl font-bold text-zinc-900 mb-1">新建项目</h2>
                        <p className="text-sm text-zinc-500 leading-relaxed">
                            接入一个已有的本地 Git 仓库，缺少 planning 时会自动创建 seed 运行材料。
                        </p>
                    </header>

                    <div className="flex flex-col gap-5 px-6 py-6">
                        <label className="flex flex-col gap-1.5">
                            <span className="text-sm font-medium text-zinc-700">Repo 路径</span>
                            <input
                                type="text"
                                className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-zinc-100 disabled:text-zinc-500 transition-colors"
                                value={props.repoRoot}
                                disabled={props.pending}
                                onChange={(event) => {
                                    props.onRepoRootChange(event.currentTarget.value)
                                }}
                            />
                        </label>

                        <label className="flex flex-col gap-1.5">
                            <span className="text-sm font-medium text-zinc-700">项目名</span>
                            <input
                                type="text"
                                className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-zinc-100 disabled:text-zinc-500 transition-colors"
                                value={props.name}
                                disabled={props.pending}
                                onChange={(event) => {
                                    props.onNameChange(event.currentTarget.value)
                                }}
                            />
                        </label>

                        {props.error ? (
                            <p className="text-sm text-red-600 bg-red-50 p-3 rounded-md border border-red-100" role="alert" aria-live="assertive" aria-atomic="true">
                                {props.error}
                            </p>
                        ) : null}

                        {props.partialSuccess ? (
                            <div className="flex items-center justify-between p-3 bg-amber-50 rounded-md border border-amber-100">
                                <p className="text-sm text-amber-800 font-medium">
                                    seed 已部分完成：{props.partialSuccess.programName}
                                </p>
                                <button
                                    type="button"
                                    className="px-3 py-1.5 text-sm font-medium text-amber-700 bg-white border border-amber-200 rounded-md hover:bg-amber-50 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap min-w-[80px]"
                                    onClick={props.onRetrySeed}
                                    disabled={props.pending}
                                >
                                    重试 seed
                                </button>
                            </div>
                        ) : null}
                    </div>

                    <footer className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-100 bg-zinc-50">
                        <button
                            type="submit"
                            className="order-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 disabled:bg-zinc-300 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap min-w-[100px]"
                            disabled={isSubmitDisabled}
                        >
                            创建项目
                        </button>
                        <button
                            type="button"
                            className="order-1 px-4 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap min-w-[80px]"
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
