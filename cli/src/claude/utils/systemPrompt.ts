import { trimIdent } from "@/utils/trimIdent";
import { shouldIncludeCoAuthoredBy } from "./claudeSettings";
import {
    PRODUCT_DEFAULT_SITE_URL,
    PRODUCT_NAME,
    PRODUCT_MCP_CHANGE_TITLE_TOOL,
    PRODUCT_SLUG
} from "@hopi/protocol/brand";

/**
 * Base system prompt shared across all configurations
 */
const BASE_SYSTEM_PROMPT = (() => trimIdent(`
    ALWAYS when you start a new chat - you must call a tool "${PRODUCT_MCP_CHANGE_TITLE_TOOL}" to set a chat title. When you think chat title is not relevant anymore - call the tool again to change it. When chat name is too generic and you have a change to make it more specific - call the tool again to change it. This title is needed to easily find the chat in the future. Help human.
`))();

/**
 * Co-authored-by credits to append when enabled
 */
const CO_AUTHORED_CREDITS = (() => trimIdent(`
    When making commit messages, you SHOULD also give credit to ${PRODUCT_NAME} like so:

    <main commit message>

    via [${PRODUCT_NAME}](${PRODUCT_DEFAULT_SITE_URL})

    Co-Authored-By: ${PRODUCT_NAME} <noreply@${PRODUCT_SLUG}.run>
`))();

/**
 * System prompt with conditional Co-Authored-By lines based on Claude's settings.json configuration.
 * Settings are read once on startup for performance.
 */
export const systemPrompt = (() => {
  const includeCoAuthored = shouldIncludeCoAuthoredBy();
  
  if (includeCoAuthored) {
    return BASE_SYSTEM_PROMPT + '\n\n' + CO_AUTHORED_CREDITS;
  } else {
    return BASE_SYSTEM_PROMPT;
  }
})();
