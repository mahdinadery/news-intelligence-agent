/** Plain fallback must not expose raw Markdown links or escape characters. */
export function markdownToPlainText(text: string): string {
  return text
    .replace(/\[((?:\\.|[^\]\\])*)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label: string, url: string) => `${label}: ${url}`)
    .replace(/\\([\\_*\[\]`])/g, "$1");
}
