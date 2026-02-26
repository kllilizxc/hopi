import { useTranslation } from '@/lib/use-translation'

export function ProjectOverviewPage() {
    const { t } = useTranslation()
    return (
        <div className="h-full flex items-center justify-center p-4 text-sm text-[var(--app-hint)]">
            {t('projects.project.hint')}
        </div>
    )
}

