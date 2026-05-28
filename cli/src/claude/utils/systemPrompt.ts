import { trimIdent } from "@/utils/trimIdent";
import { shouldIncludeCoAuthoredBy } from "./claudeSettings";
import {
    PRODUCT_DEFAULT_SITE_URL,
    PRODUCT_NAME,
    PRODUCT_SLUG
} from "@hopi/protocol/brand";

/**
 * Base system prompt shared across all configurations
 */
const BASE_SYSTEM_PROMPT = '';

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
    return [BASE_SYSTEM_PROMPT, CO_AUTHORED_CREDITS].filter(Boolean).join('\n\n');
  } else {
    return BASE_SYSTEM_PROMPT;
  }
})();
