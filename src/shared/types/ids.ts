// ── Branded ID types for type safety ──

declare const __brand: unique symbol;

export type SessionId = string & { readonly [__brand]: 'SessionId' };
export type MessageId = string & { readonly [__brand]: 'MessageId' };
export type UUId = string & { readonly [__brand]: 'UUId' };
export type RequestId = string & { readonly [__brand]: 'RequestId' };
export type ToolId = string & { readonly [__brand]: 'ToolId' };

// ── Safe branding functions ──

export function brandSessionId(s: string): SessionId {
  return s as SessionId;
}

export function brandMessageId(s: string): MessageId {
  return s as MessageId;
}

export function brandUUId(s: string): UUId {
  return s as UUId;
}

export function brandRequestId(s: string): RequestId {
  return s as RequestId;
}

export function brandToolId(s: string): ToolId {
  return s as ToolId;
}
