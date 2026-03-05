/**
 * Codex-specific system prompt for local mode.
 *
 * This prompt instructs Codex to call the product-specific change_title function
 * to set appropriate chat session titles.
 */

import { trimIdent } from '@/utils/trimIdent';
import { PRODUCT_CHANGE_TITLE_TOOL, PRODUCT_MCP_CHANGE_TITLE_TOOL } from '@hopi/protocol/brand';

/**
 * Title instruction for Codex to call the product MCP tool.
 * Note: Codex exposes MCP tools under the `functions.` namespace,
 * so the tool is called as `functions.<product>__change_title`.
 */
export const TITLE_INSTRUCTION = trimIdent(`
    ALWAYS when you start a new chat, call the title tool to set a concise task title.
    Prefer calling functions.${PRODUCT_CHANGE_TITLE_TOOL}.
    If that exact tool name is unavailable, call an equivalent alias such as ${PRODUCT_CHANGE_TITLE_TOOL}, ${PRODUCT_MCP_CHANGE_TITLE_TOOL}, or ${PRODUCT_CHANGE_TITLE_TOOL.replace('__', '_')}.
    If the task focus changes significantly later, call the title tool again with a better title.
`);

/**
 * The system prompt to inject via developer_instructions in local mode.
 */
export const codexSystemPrompt = TITLE_INSTRUCTION;
