/** Links between a session and the code graph: both views keep their state in the URL. */

export interface CodeGraphLink {
  project: string;
  session: string;
  /** Repo-relative file to open in the editor. */
  open?: string;
}

/** The code graph in review mode, spotlighting what the session touched. */
export function codeGraphHref({ project, session, open }: CodeGraphLink): string {
  const params = new URLSearchParams({ project, session, review: '1' });
  if (open) params.set('open', open);
  return `/code-graph?${params}`;
}

/** The session detail with one turn's preview open. */
export function sessionTurnHref(session: string, eventId: number): string {
  return `/sessions/${encodeURIComponent(session)}?turn=${eventId}`;
}
