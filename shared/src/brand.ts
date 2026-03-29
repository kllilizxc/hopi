export const PRODUCT_NAME = 'HOPI'
export const PRODUCT_SLUG = 'hopi'
export const PRODUCT_CLI_COMMAND = PRODUCT_SLUG
export const PRODUCT_STARTING_MODE_FLAG = `--${PRODUCT_SLUG}-starting-mode`

export const PRODUCT_HOME_DIRNAME = `.${PRODUCT_SLUG}`
export const PRODUCT_DB_FILENAME = `${PRODUCT_SLUG}.db`
export const PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH = `${PRODUCT_HOME_DIRNAME}/actions.yaml`
export const PRODUCT_INIT_SCRIPT_RELATIVE_PATH = `${PRODUCT_HOME_DIRNAME}/init.sh`
export const PRODUCT_MERGE_SCRIPT_RELATIVE_PATH = `${PRODUCT_HOME_DIRNAME}/merge.sh`
export const PRODUCT_PREVIEW_SCRIPT_RELATIVE_PATH = `${PRODUCT_HOME_DIRNAME}/preview.sh`
export const PRODUCT_PREVIEW_READY_MARKER = `::${PRODUCT_SLUG}-preview-url::`

export const PRODUCT_DEFAULT_RELAY_API_DOMAIN = `relay.${PRODUCT_SLUG}.run`
export const PRODUCT_DEFAULT_SITE_URL = `https://${PRODUCT_SLUG}.run`
export const PRODUCT_DEFAULT_OFFICIAL_WEB_URL = `https://app.${PRODUCT_SLUG}.run`
export const PRODUCT_DEFAULT_DOCS_URL = `${PRODUCT_DEFAULT_SITE_URL}/docs`
export const PRODUCT_DEFAULT_VAPID_SUBJECT = `mailto:admin@${PRODUCT_SLUG}.run`
export const PRODUCT_CHANGE_TITLE_TOOL = `${PRODUCT_SLUG}__change_title`
export const PRODUCT_MCP_CHANGE_TITLE_TOOL = `mcp__${PRODUCT_CHANGE_TITLE_TOOL}`

export function productEnvKey(suffix: string): string {
    return `${PRODUCT_NAME}_${suffix}`
}

export function productHeaderKey(suffix: string): string {
    return `x-${PRODUCT_SLUG}-${suffix}`
}

export function productStorageKey(suffix: string): string {
    return `${PRODUCT_SLUG}-${suffix}`
}

export function productStorageNamespaceKey(suffix: string): string {
    return `${PRODUCT_SLUG}:${suffix}`
}

export const PRODUCT_ENV = {
    API_URL: productEnvKey('API_URL'),
    HOME: productEnvKey('HOME'),
    EXPERIMENTAL: productEnvKey('EXPERIMENTAL'),
    HTTP_MCP_URL: productEnvKey('HTTP_MCP_URL'),
    PROJECT_ROOT: productEnvKey('PROJECT_ROOT'),
    HOSTNAME: productEnvKey('HOSTNAME'),
    CLAUDE_PATH: productEnvKey('CLAUDE_PATH'),
    GIT_PATH: productEnvKey('GIT_PATH'),
    CLI_WORKING_DIRECTORY: productEnvKey('CLI_WORKING_DIRECTORY'),
    OPENCODE_HOOK_URL: productEnvKey('OPENCODE_HOOK_URL'),
    OPENCODE_HOOK_TOKEN: productEnvKey('OPENCODE_HOOK_TOKEN'),
    STRICT_WORKSPACE_WRITES: productEnvKey('STRICT_WORKSPACE_WRITES'),
    STRICT_WORKSPACE_WRITES_APPLIED: productEnvKey('STRICT_WORKSPACE_WRITES_APPLIED'),
    TERMINAL_IDLE_TIMEOUT_MS: productEnvKey('TERMINAL_IDLE_TIMEOUT_MS'),
    TERMINAL_MAX_TERMINALS: productEnvKey('TERMINAL_MAX_TERMINALS'),
    OUTBOX_MAX_BYTES: productEnvKey('OUTBOX_MAX_BYTES'),
    OUTBOX_MAX_ITEMS: productEnvKey('OUTBOX_MAX_ITEMS'),
    OUTBOX_MAX_ITEM_BYTES: productEnvKey('OUTBOX_MAX_ITEM_BYTES'),
    OUTBOX_MAX_AGE_MS: productEnvKey('OUTBOX_MAX_AGE_MS'),
    OUTBOX_DROP_LOG_INTERVAL_MS: productEnvKey('OUTBOX_DROP_LOG_INTERVAL_MS'),
    RUNNER_HTTP_TIMEOUT: productEnvKey('RUNNER_HTTP_TIMEOUT'),
    RUNNER_HEARTBEAT_INTERVAL: productEnvKey('RUNNER_HEARTBEAT_INTERVAL'),
    WORKTREE_BASE_PATH: productEnvKey('WORKTREE_BASE_PATH'),
    WORKTREE_BRANCH: productEnvKey('WORKTREE_BRANCH'),
    WORKTREE_NAME: productEnvKey('WORKTREE_NAME'),
    WORKTREE_PATH: productEnvKey('WORKTREE_PATH'),
    WORKTREE_CREATED_AT: productEnvKey('WORKTREE_CREATED_AT'),
    WORKTREE_BASE_COMMIT: productEnvKey('WORKTREE_BASE_COMMIT'),
    LISTEN_HOST: productEnvKey('LISTEN_HOST'),
    LISTEN_PORT: productEnvKey('LISTEN_PORT'),
    PUBLIC_URL: productEnvKey('PUBLIC_URL'),
    RELAY_API: productEnvKey('RELAY_API'),
    RELAY_AUTH: productEnvKey('RELAY_AUTH'),
    RELAY_FORCE_TCP: productEnvKey('RELAY_FORCE_TCP'),
    OFFICIAL_WEB_URL: productEnvKey('OFFICIAL_WEB_URL'),
    PREVIEW_ROOT: productEnvKey('PREVIEW_ROOT'),
    PREVIEW_PORT: productEnvKey('PREVIEW_PORT'),
    PREVIEW_TIMEOUT_SEC: productEnvKey('PREVIEW_TIMEOUT_SEC'),
    PREVIEW_WEB_PORT_BASE: productEnvKey('PREVIEW_WEB_PORT_BASE'),
    PREVIEW_HUB_PORT_BASE: productEnvKey('PREVIEW_HUB_PORT_BASE'),
    PREVIEW_MODE: productEnvKey('PREVIEW_MODE'),
    TASK_ID: productEnvKey('TASK_ID'),
    TASK_PROJECT_ID: productEnvKey('TASK_PROJECT_ID'),
    MERGE_TARGET_BRANCH: productEnvKey('MERGE_TARGET_BRANCH'),
    MERGE_SOURCE_BRANCH: productEnvKey('MERGE_SOURCE_BRANCH'),
} as const

export const PRODUCT_HEADERS = {
    LOCALE: productHeaderKey('locale'),
    PROTOCOL_VERSION: productHeaderKey('protocol-version'),
    HOOK_TOKEN: productHeaderKey('hook-token'),
} as const
