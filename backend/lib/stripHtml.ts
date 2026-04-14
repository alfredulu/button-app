/**
 * Remove HTML/script tags and trim. Used for all user-supplied text before DB.
 */
export function stripHtmlAndScripts(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[<>]/g, "")
    .trim();
}
