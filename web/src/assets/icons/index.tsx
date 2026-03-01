import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export type IconProps = ComponentPropsWithoutRef<'svg'>

type CreateIconOptions = {
    className?: string
    width?: number | string
    height?: number | string
    viewBox?: string
    fill?: string
    stroke?: string
    strokeWidth?: number | string
    strokeLinecap?: 'round' | 'square' | 'butt'
    strokeLinejoin?: 'round' | 'miter' | 'bevel'
}

function createIcon(paths: ReactNode, props: IconProps, options: CreateIconOptions = {}) {
    const {
        className,
        style,
        width,
        height,
        viewBox,
        fill,
        stroke,
        strokeWidth,
        strokeLinecap,
        strokeLinejoin,
        ...rest
    } = props
    const resolvedClassName = className ?? options.className

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={width ?? options.width}
            height={height ?? options.height}
            viewBox={viewBox ?? options.viewBox ?? '0 0 24 24'}
            fill={fill ?? options.fill ?? 'none'}
            stroke={stroke ?? options.stroke ?? 'currentColor'}
            strokeWidth={strokeWidth ?? options.strokeWidth ?? 2}
            strokeLinecap={strokeLinecap ?? options.strokeLinecap ?? 'round'}
            strokeLinejoin={strokeLinejoin ?? options.strokeLinejoin ?? 'round'}
            className={resolvedClassName}
            style={style}
            {...rest}
        >
            {paths}
        </svg>
    )
}

export function CloseIcon(props: IconProps) {
    return createIcon(
        <path d="M6 18 18 6M6 6l12 12" />,
        props,
        {
            className: 'h-4 w-4',
            strokeWidth: 2
        }
    )
}

export function ShareIcon(props: IconProps) {
    return createIcon(
        <path d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3v12" />,
        props,
        { className: 'h-4 w-4', strokeWidth: 1.5 }
    )
}

export function PlusCircleIcon(props: IconProps) {
    return createIcon(
        <path d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
        props,
        { className: 'h-4 w-4', strokeWidth: 1.5 }
    )
}

export function CopyIcon(props: IconProps) {
    return createIcon(
        <>
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </>,
        props,
        {
            className: 'h-4 w-4',
            strokeWidth: 2
        }
    )
}

export function CheckIcon(props: IconProps) {
    return createIcon(
        <polyline points="20 6 9 17 4 12" />,
        props,
        {
            className: 'h-4 w-4',
            strokeWidth: 2
        }
    )
}

export function BackIcon(props: IconProps) {
    return createIcon(
        <polyline points="15 18 9 12 15 6" />,
        props,
        {
            width: 20,
            height: 20,
            strokeWidth: 2
        }
    )
}

export function ProjectIcon(props: IconProps) {
    return createIcon(
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
        props,
        {
            className: 'h-4 w-4',
            strokeWidth: 1.8
        }
    )
}

export function SessionIcon(props: IconProps) {
    return createIcon(
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
        props,
        {
            className: 'h-4 w-4',
            strokeWidth: 1.8
        }
    )
}

export function PlusIcon(props: IconProps) {
    return createIcon(
        <>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </>,
        props,
        {
            width: 24,
            height: 24,
            strokeWidth: 2
        }
    )
}

export function SettingsIcon(props: IconProps) {
    return createIcon(
        <>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </>,
        props,
        {
            width: 20,
            height: 20,
            strokeWidth: 2
        }
    )
}

export function RefreshIcon(props: IconProps) {
    return createIcon(
        <>
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <polyline points="21 3 21 9 15 9" />
        </>,
        props,
        {
            width: 18,
            height: 18,
            strokeWidth: 2
        }
    )
}

export function SearchIcon(props: IconProps) {
    return createIcon(
        <>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </>,
        props,
        {
            width: 16,
            height: 16,
            strokeWidth: 2
        }
    )
}

export function GitBranchIcon(props: IconProps) {
    return createIcon(
        <>
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="6" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
        </>,
        props,
        {
            width: 16,
            height: 16,
            strokeWidth: 2
        }
    )
}

export function FolderIcon(props: IconProps) {
    return createIcon(
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
        props,
        {
            width: 22,
            height: 22,
            strokeWidth: 1.6
        }
    )
}

export function BulbIcon(props: IconProps) {
    return createIcon(
        <>
            <path d="M9 18h6" />
            <path d="M10 22h4" />
            <path d="M12 2a7 7 0 0 0-4 12c.6.6 1 1.2 1 2h6c0-.8.4-1.4 1-2a7 7 0 0 0-4-12Z" />
        </>,
        props,
        {
            width: 24,
            height: 24,
            strokeWidth: 2
        }
    )
}

export function ChevronDownIcon(props: IconProps) {
    return createIcon(
        <polyline points="6 9 12 15 18 9" />,
        props,
        {
            width: 16,
            height: 16,
            strokeWidth: 2
        }
    )
}

export function ChevronRightIcon(props: IconProps) {
    return createIcon(
        <polyline points="9 18 15 12 9 6" />,
        props,
        {
            width: 16,
            height: 16,
            strokeWidth: 2
        }
    )
}

export function LanguageIcon(props: IconProps) {
    return createIcon(
        <>
            <path d="m5 8 6 6" />
            <path d="m4 14 6-6 2-3" />
            <path d="M2 5h12" />
            <path d="M7 2h1" />
            <path d="m22 22-5-10-5 10" />
            <path d="M14 18h6" />
        </>,
        props,
        {
            width: 18,
            height: 18,
            strokeWidth: 2
        }
    )
}

export function TaskCardMenuIcon(props: IconProps) {
    return createIcon(
        <>
            <circle cx="12" cy="12" r="1.25" />
            <circle cx="12" cy="5" r="1.25" />
            <circle cx="12" cy="19" r="1.25" />
        </>,
        props,
        {
            width: 18,
            height: 18,
            strokeWidth: 2
        }
    )
}

export function EditIcon(props: IconProps) {
    return createIcon(
        <>
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
        </>,
        props,
        {
            width: 18,
            height: 18,
            strokeWidth: 2
        }
    )
}

export function ArchiveIcon(props: IconProps) {
    return createIcon(
        <>
            <rect width="20" height="5" x="2" y="3" rx="1" />
            <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
            <path d="M10 12h4" />
        </>,
        props,
        {
            width: 18,
            height: 18,
            strokeWidth: 2
        }
    )
}

export function TrashIcon(props: IconProps) {
    return createIcon(
        <>
            <path d="M3 6h18" />
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            <line x1="10" x2="10" y1="11" y2="17" />
            <line x1="14" x2="14" y1="11" y2="17" />
        </>,
        props,
        {
            width: 18,
            height: 18,
            strokeWidth: 2
        }
    )
}

export function ImportIcon(props: IconProps) {
    return createIcon(
        <>
            <path d="M12 3v12" />
            <path d="m16 11-4 4-4-4" />
            <path d="M21 21H3" />
        </>,
        props,
        {
            width: 18,
            height: 18,
            strokeWidth: 2
        }
    )
}

export function FileDocumentIcon(props: IconProps & { size?: number }) {
    const size = props.size ?? 20
    return createIcon(
        <>
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
        </>,
        props,
        {
            width: size,
            height: size,
            strokeWidth: 1.6
        }
    )
}

export const FilesIcon = FileDocumentIcon

export function DiffIcon(props: IconProps) {
    return createIcon(
        <>
            <path d="M5 4v6h6" />
            <path d="M19 20v-6h-6" />
            <path d="M5 10a7 7 0 0 1 12-4.9l.5.5" />
            <path d="M19 14a7 7 0 0 1-12 4.9l-.5-.5" />
        </>,
        props,
        {
            width: 18,
            height: 18,
            strokeWidth: 2
        }
    )
}

export function TaskIcon(props: IconProps) {
    return createIcon(
        <>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
            <path d="M9 12h6" />
            <path d="M9 16h6" />
        </>,
        props,
        {
            width: 18,
            height: 18,
            strokeWidth: 2
        }
    )
}

type SpeakerIconProps = IconProps & {
    muted?: boolean
}

export function SpeakerIcon(props: SpeakerIconProps) {
    if (props.muted) {
        return createIcon(
            <>
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="22" y1="9" x2="16" y2="15" />
                <line x1="16" y1="9" x2="22" y2="15" />
            </>,
            props,
            {
                width: 18,
                height: 18,
                strokeWidth: 2
            }
        )
    }

    return createIcon(
        <>
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </>,
        props,
        {
            width: 18,
            height: 18,
            strokeWidth: 2
        }
    )
}

export function SwitchToRemoteIcon(props: IconProps) {
    return createIcon(
        <>
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
            <line x1="12" y1="18" x2="12.01" y2="18" />
        </>,
        props,
        {
            width: 18,
            height: 18,
            strokeWidth: 2
        }
    )
}

export function TerminalIcon(props: IconProps) {
    return createIcon(
        <>
            <rect x="3" y="4" width="18" height="16" rx="2" ry="2" />
            <polyline points="7 9 10 12 7 15" />
            <line x1="12" y1="15" x2="17" y2="15" />
        </>,
        props,
        {
            className: 'h-4 w-4',
            width: 18,
            height: 18,
            strokeWidth: 1.8
        }
    )
}

export function AttachmentIcon(props: IconProps) {
    return createIcon(
        <path d="M21.44 11.05l-8.49 8.49a5.5 5.5 0 0 1-7.78-7.78l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a1.5 1.5 0 0 1-2.12-2.12l7.78-7.78" />,
        props,
        {
            width: 18,
            height: 18,
            strokeWidth: 2
        }
    )
}

export function VoiceAssistantIcon(props: IconProps) {
    return createIcon(
        <>
            <path d="M12 6v12" />
            <path d="M8 9v6" />
            <path d="M16 9v6" />
            <path d="M4 11v2" />
            <path d="M20 11v2" />
        </>,
        props,
        {
            width: 18,
            height: 18,
            strokeWidth: 2
        }
    )
}

export function SendIcon(props: IconProps) {
    return createIcon(
        <>
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
        </>,
        props,
        {
            width: 16,
            height: 16,
            strokeWidth: 2.5
        }
    )
}

export function StopIcon(props: IconProps) {
    const className = props.className
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
            className={className}
            style={props.style}
        >
            <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
    )
}

export function SpinnerIcon(props: IconProps) {
    const { className, style, ...rest } = props
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={style}
            {...rest}
        >
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.75" />
        </svg>
    )
}

export function LoadingIcon(props: IconProps) {
    const { className, style, ...rest } = props
    return (
        <svg
            className={className ?? 'animate-spin'}
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={style}
            {...rest}
        >
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="0.75" />
        </svg>
    )
}

type AbortIconProps = {
    spinning: boolean
    className?: string
}

export function AbortIcon(props: AbortIconProps) {
    if (props.spinning) {
        return (
            <svg
                className={props.className ?? 'animate-spin'}
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
            >
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="0.75" />
            </svg>
        )
    }

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 16 16"
            fill="currentColor"
            className={props.className}
        >
            <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4-2.5a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5v-4Z" />
        </svg>
    )
}

export function DetailsIcon(props: IconProps) {
    return (
        <svg
            className={props.className ?? 'h-4 w-4'}
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={props.style}
        >
            <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

export function CliIcon(props: IconProps) {
    return (
        <svg
            className={props.className ?? 'h-4 w-4'}
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={props.style}
        >
            <path d="M3 4.5l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8.5 10.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    )
}

export function ErrorCircleIcon(props: IconProps) {
    return (
        <svg
            className={props.className ?? 'h-4 w-4'}
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={props.style}
        >
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="8" cy="11" r="0.75" fill="currentColor" />
        </svg>
    )
}

export function RemoveIcon(props: IconProps) {
    return createIcon(
        <>
            <line x1="3" y1="3" x2="9" y2="9" />
            <line x1="9" y1="3" x2="3" y2="9" />
        </>,
        props,
        {
            width: 12,
            height: 12,
            viewBox: '0 0 12 12',
            strokeWidth: 2
        }
    )
}

export function StatusCompletedIcon(props: IconProps) {
    return (
        <svg
            className={props.className ?? 'h-3 w-3'}
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={props.style}
        >
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5.2 8.3l1.8 1.8 3.8-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

export function StatusErrorIcon(props: IconProps) {
    return (
        <svg
            className={props.className ?? 'h-3 w-3'}
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={props.style}
        >
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    )
}

export function StatusPendingIcon(props: IconProps) {
    return (
        <svg
            className={props.className ?? 'h-3 w-3'}
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={props.style}
        >
            <rect x="4.5" y="7" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M6 7V5.8a2 2 0 0 1 4 0V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    )
}

export function EyeIcon(props: IconProps) {
    return createIcon(
        <>
            <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
            <circle cx="12" cy="12" r="2.5" />
        </>,
        props,
        {
            className: 'h-4 w-4',
            strokeWidth: 1.8
        }
    )
}

export function FileDiffIcon(props: IconProps) {
    return createIcon(
        <>
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
            <path d="M14 2v5h5" />
            <path d="M9 12h2" />
            <path d="M9 16h6" />
            <path d="M13 12h2" />
        </>,
        props,
        {
            className: 'h-4 w-4',
            strokeWidth: 1.8
        }
    )
}

export function GlobeIcon(props: IconProps) {
    return createIcon(
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18" />
            <path d="M12 3a12 12 0 0 1 0 18" />
            <path d="M12 3a12 12 0 0 0 0 18" />
        </>,
        props,
        {
            className: 'h-4 w-4',
            strokeWidth: 1.8
        }
    )
}

export function ClipboardIcon(props: IconProps) {
    return createIcon(
        <>
            <rect x="8" y="3" width="8" height="4" rx="1" />
            <path d="M9 7H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2" />
        </>,
        props,
        {
            className: 'h-4 w-4',
            strokeWidth: 1.8
        }
    )
}

export function PuzzleIcon(props: IconProps) {
    return createIcon(
        <path d="M9 3a2 2 0 0 1 2 2v1h2V5a2 2 0 1 1 4 0v3h-3v2h1a2 2 0 1 1 0 4h-1v2h3v3H6a2 2 0 0 1-2-2v-3h3v-2H6a2 2 0 1 1 0-4h1V8H4V5a2 2 0 0 1 2-2h3z" />,
        props,
        {
            className: 'h-4 w-4',
            strokeWidth: 1.8
        }
    )
}

export function RocketIcon(props: IconProps) {
    return createIcon(
        <>
            <path d="M12 2c4 1 6 4 7 8-2 1-4 2-7 2s-5-1-7-2c1-4 3-7 7-8z" />
            <path d="M9 14l-2 6 5-3" />
            <path d="M15 14l2 6-5-3" />
            <circle cx="12" cy="8.5" r="1.2" />
        </>,
        props,
        {
            className: 'h-4 w-4',
            strokeWidth: 1.8
        }
    )
}

export function WrenchIcon(props: IconProps) {
    return createIcon(
        <path d="M21 7a5 5 0 0 1-7 4L7 18a2 2 0 0 1-3-3l7-7a5 5 0 0 1 6-6l-3 3 4 4 3-3z" />,
        props,
        {
            className: 'h-4 w-4',
            strokeWidth: 1.8
        }
    )
}

export function QuestionIcon(props: IconProps) {
    return createIcon(
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9a2.5 2.5 0 1 1 4.1 1.9c-.9.7-1.6 1.3-1.6 2.6" />
            <path d="M12 17h.01" />
        </>,
        props,
        {
            className: 'h-4 w-4',
            strokeWidth: 1.8
        }
    )
}
