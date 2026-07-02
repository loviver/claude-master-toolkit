import type {
  TurnToolCall,
  ThinkingBlockDTO,
} from '../../shared/api-types.js';

const PREVIEW_CHARS = 8000;

function truncate(s: string, n = PREVIEW_CHARS): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function extractContentBlocks(raw: string): unknown[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = raw; }

  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).content)) {
    return (parsed as any).content;
  }
  return [];
}

export type ExtractedTurnContent = {
  assistantText: string | null;
  userPrompt: string | null;
  toolCalls: TurnToolCall[];
  thinkingBlocks?: ThinkingBlockDTO[];
};

export function extractTurnContent(
  raw: string,
  role: 'user' | 'assistant',
): ExtractedTurnContent {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = raw; }

  const blocks = extractContentBlocks(raw);

  let assistantText: string | null = null;
  let userPrompt: string | null = null;
  const toolCalls: TurnToolCall[] = [];
  const thinkingBlocks: ThinkingBlockDTO[] = [];

  if (typeof parsed === 'string') {
    if (role === 'assistant') assistantText = parsed;
    else userPrompt = parsed;
  }

  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    const type = (b as any).type as string | undefined;

    if (type === 'thinking') {
      const raw = (b as any).thinking;
      const text = typeof raw === 'string' && raw.length > 0
        ? truncate(raw, 2000)
        : '[thinking redacted by Claude Code — only signature stored]';
      const sig = (b as any).signature;
      thinkingBlocks.push({
        text,
        signature: typeof sig === 'string' ? sig.slice(0, 60) + '…' : undefined,
      });
      continue;
    }

    if (type === 'text' && typeof (b as any).text === 'string') {
      if (role === 'assistant') {
        assistantText = (assistantText ? assistantText + '\n\n' : '') + (b as any).text;
      } else {
        userPrompt = (userPrompt ? userPrompt + '\n\n' : '') + (b as any).text;
      }
    } else if (type === 'tool_use') {
      toolCalls.push({
        tool: (b as any).name ?? 'unknown',
        toolUseId: typeof (b as any).id === 'string' ? (b as any).id : undefined,
        inputPreview: truncate(JSON.stringify((b as any).input ?? {}, null, 2), 400),
        resultPreview: null,
      });
    } else if (type === 'tool_result') {
      const content = resolveResultContent((b as any).content);
      const last = toolCalls[toolCalls.length - 1];
      if (last && !last.resultPreview) {
        last.resultPreview = truncate(content, 400);
        last.isError = !!(b as any).is_error;
      } else {
        toolCalls.push({
          tool: 'result',
          inputPreview: '',
          resultPreview: truncate(content, 400),
          isError: !!(b as any).is_error,
        });
      }
    }
  }

  return {
    assistantText,
    userPrompt,
    toolCalls,
    thinkingBlocks: thinkingBlocks.length ? thinkingBlocks : undefined,
  };
}

export function applyToolResultsFromUser(toolCalls: TurnToolCall[], userContentRaw: string): void {
  const blocks = extractContentBlocks(userContentRaw);
  const byId = new Map<string, TurnToolCall>();
  for (const tc of toolCalls) if (tc.toolUseId) byId.set(tc.toolUseId, tc);

  for (const b of blocks) {
    if (!b || typeof b !== 'object' || (b as any).type !== 'tool_result') continue;
    const id = (b as any).tool_use_id;
    const match = typeof id === 'string' ? byId.get(id) : undefined;
    if (!match) continue;
    match.isError = !!(b as any).is_error;
    if (!match.resultPreview) {
      match.resultPreview = truncate(resolveResultContent((b as any).content), 400);
    }
  }
}

function resolveResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('\n');
  }
  return JSON.stringify(content ?? '');
}
