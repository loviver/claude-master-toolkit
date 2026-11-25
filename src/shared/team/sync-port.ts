/** Boundary between the team-vault rules and where the team data lives (git today, HTTP later). */
import type { TeamMemory } from './format.js';

export interface Proposal {
  branch: string;
  /** null when the backend could not open the review request (the branch is still published). */
  url: string | null;
}

export interface Snapshot {
  cursor: string;
  memories: TeamMemory[];
  /** Entries rejected because they do not match the format. */
  invalid: string[];
}

export interface SyncPort {
  /** Project owners allowed to feed this vault; null when it sets no restriction. */
  allowedOwners(): string[] | null;
  /** Publishes memories for review. Nothing reaches the team until the review is accepted. */
  propose(memories: TeamMemory[]): Proposal;
  /** Accepted memories, or null when nothing changed since `cursor`. */
  fetch(cursor: string | undefined): Snapshot | null;
}
