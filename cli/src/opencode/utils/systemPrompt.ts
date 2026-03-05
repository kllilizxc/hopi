/**
 * OpenCode-specific system prompt for change_title tool.
 *
 * OpenCode exposes MCP tools with the naming pattern: <server-name>_<tool-name>
 * The hopi MCP server exposes `change_title`, so it's called as `hopi_change_title`.
 */

import { trimIdent } from '@/utils/trimIdent';
import { PRODUCT_SLUG } from '@hopi/protocol/brand';

const CHANGE_TITLE_TOOL_NAME = `${PRODUCT_SLUG}_change_title`

/**
 * Title instruction for OpenCode to call the hopi MCP tool.
 */
export const TITLE_INSTRUCTION = trimIdent(`
    ALWAYS when you start a new chat - you must call the tool "${CHANGE_TITLE_TOOL_NAME}" to set a chat title. When you think chat title is not relevant anymore - call the tool again to change it. When chat name is too generic and you have a chance to make it more specific - call the tool again to change it. This title is needed to easily find the chat in the future. Help human.
`);

/**
 * The system prompt to inject for OpenCode sessions.
 */
export const opencodeSystemPrompt = TITLE_INSTRUCTION;
