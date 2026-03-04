import { useTranslation } from '@/lib/use-translation'
import { ArchiveIcon, EditIcon, ImportIcon, TaskCardMenuIcon, TrashIcon } from '@/assets/icons'
import { AdaptiveSelect } from '@/components/ui/AdaptiveSelect'
import { IconButton } from '@/components/ui/icon-button'

type SessionActionMenuProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    sessionActive: boolean
    onRename: () => void
    onArchive: () => void
    onDelete: () => void
    onImportAsTask?: () => void
}

export function SessionActionMenu(props: SessionActionMenuProps) {
    const { t } = useTranslation()
    const {
        open,
        onOpenChange,
        sessionActive,
        onRename,
        onArchive,
        onDelete,
        onImportAsTask,
    } = props

    const options = [
        ...(onImportAsTask
            ? [{
                value: 'import' as const,
                label: t('session.action.importTask'),
                icon: <ImportIcon />,
            }]
            : []),
        {
            value: 'rename' as const,
            label: t('session.action.rename'),
            icon: <EditIcon />,
        },
        sessionActive
            ? {
                value: 'archive' as const,
                label: t('session.action.archive'),
                icon: <ArchiveIcon />,
                destructive: true,
            }
            : {
                value: 'delete' as const,
                label: t('session.action.delete'),
                icon: <TrashIcon />,
                destructive: true,
            },
    ]

    return (
        <AdaptiveSelect
            title={t('session.more')}
            value={null}
            options={options}
            onValueChange={(value) => {
                onOpenChange(false)
                switch (value) {
                    case 'import':
                        onImportAsTask?.()
                        return
                    case 'rename':
                        onRename()
                        return
                    case 'archive':
                        onArchive()
                        return
                    case 'delete':
                        onDelete()
                        return
                    default:
                        return
                }
            }}
            open={open}
            onOpenChange={onOpenChange}
            align="end"
            trigger={(
                <IconButton
                    type="button"
                    variant="ghost"
                    size="md"
                    aria-label={t('session.more')}
                >
                    <TaskCardMenuIcon />
                </IconButton>
            )}
        />
    )
}
