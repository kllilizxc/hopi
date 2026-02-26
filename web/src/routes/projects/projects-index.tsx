import { useTranslation } from '@/lib/use-translation'

export function ProjectsIndexPage() {
    const { t } = useTranslation()
    return (
        <div className="h-full flex items-center justify-center p-4 text-sm text-[var(--app-hint)]">
            {t('projects.index.hint')}
        </div>
    )
}

