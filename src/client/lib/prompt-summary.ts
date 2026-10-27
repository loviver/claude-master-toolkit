export interface PromptSummary {
  text: string;
  images: number;
}

const NUMBERED_REF = /\[Image #(\d+)\]/g;
const SOURCE_REF = /\[Image: source: [^\]]*?(\d+)?\.\w+\]/g;

/**
 * Claude Code stores pasted images as `[Image #N]` refs plus `[Image: source: …/N.png]`
 * lines. Both are noise in a prompt preview: strip them and report how many images there were.
 */
export function summarizePrompt(raw: string): PromptSummary {
  const ids = new Set<string>();
  let anonymous = 0;
  const text = raw
    .replace(NUMBERED_REF, (_, n: string) => { ids.add(n); return ' '; })
    .replace(SOURCE_REF, (_, n?: string) => {
      if (n) ids.add(n);
      else anonymous++;
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { text, images: ids.size + anonymous };
}
