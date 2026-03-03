import { useTranslation } from '@/lib/use-translation'
import { ArchiveIcon, EditIcon, ImportIcon, TrashIcon } from '@/assets/icons'
import { ActionSheet, ActionSheetItem } from '@/components/ui/ActionSheet'

type SessionActionMenuProps = {
    isOpen: boolean
    onClose: () => void
    sessionActive: boolean
    onRename: () => void
    onArchive: () => void
    onDelete: () => void
    onImportAsTask?: () => void
}

export function SessionActionMenu(props: SessionActionMenuProps) {
    const { t } = useTranslation()
    const {
        isOpen,
        onClose,
        sessionActive,
        onRename,
        onArchive,
        onDelete,
        onImportAsTask,
    } = props

    const handleRename = () => {
        onClose()
        onRename()
    }

    const handleArchive = () => {
        onClose()
        onArchive()
    }

    const handleDelete = () => {
        onClose()
        onDelete()
    }

    const handleImport = () => {
        if (!onImportAsTask) return
        onClose()
        onImportAsTask()
    }

    return (
        <ActionSheet
            open={isOpen}
            onOpenChange={(open) => {
                if (!open) {
                    onClose()
                }
            }}
            title={t('session.more')}
        >
            <div className="flex flex-col gap-1">
                {onImportAsTask ? (
                    <ActionSheetItem icon={<ImportIcon />} onClick={handleImport}>
                        {t('session.action.importTask')}
                    </ActionSheetItem>
                ) : null}

                <ActionSheetItem icon={<EditIcon />} onClick={handleRename}>
                    {t('session.action.rename')}
                </ActionSheetItem>

                {sessionActive ? (
                    <ActionSheetItem destructive icon={<ArchiveIcon />} onClick={handleArchive}>
                        {t('session.action.archive')}
                    </ActionSheetItem>
                ) : (
                    <ActionSheetItem destructive icon={<TrashIcon />} onClick={handleDelete}>
                        {t('session.action.delete')}
                    </ActionSheetItem>
                )}
            </div>
        </ActionSheet>
    )
}

