export function userEventToContent(
  raw: string,
  hash: string,
  size: number,
  eventId: number,
  role: 'user' | 'tool_result',
) {
  return { eventId, role, content: raw, contentHash: hash, byteSize: size };
}
