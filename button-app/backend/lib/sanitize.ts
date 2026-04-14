/**
 * Strip HTML/script content from user-supplied text (defense in depth vs XSS).
 */
export function stripHtmlAndScripts(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .trim();
}

export const MAX_USER_TEXT_LENGTH = 500;

export function sanitizeUserText(input: string, maxLen = MAX_USER_TEXT_LENGTH): string {
  const stripped = stripHtmlAndScripts(input);
  return stripped.length > maxLen ? stripped.slice(0, maxLen) : stripped;
}
