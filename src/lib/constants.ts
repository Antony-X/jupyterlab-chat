// Prefix for frontend-synthesized follow-up user messages (view-image,
// view-output, continue chains, autoFix retries). UserMessage hides the text
// bubble when a message starts with this. Uses mathematical white square
// brackets — extremely unlikely for a human to type, so we don't risk
// swallowing a legit user message by accident.
export const AUTO_PREFIX = '\u27E6auto\u27E7 ';
