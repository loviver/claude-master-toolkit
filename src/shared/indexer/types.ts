export interface SymbolMatch {
  file: string;
  symbol: string;
  kind: string;
  signature: string | null;
  range: [number, number];
  exported: boolean;
  tokens: number;
  deps: string[];
  callers: string[];
}

export interface SymbolAlternative {
  file: string;
  symbol: string;
  kind: string;
  range: [number, number];
}

export interface UnderstandResult extends SymbolMatch {
  body: string;
  /** True when the bare name has more than one definition in the project. */
  ambiguous: boolean;
  /** Other definitions of the same name (max 10). Pass `file` to pin one. */
  alternatives: SymbolAlternative[];
  /** `deps`/`callers` are capped; these carry the full counts. */
  depsCount: number;
  callersCount: number;
}

export interface FileImport {
  module: string;
  names: string[];
  external: boolean;
}

export interface DepsResult {
  file: string;
  exports: string[];
  /** Full export count; `exports` is capped on file-level queries. */
  exportsCount: number;
  /** Call edges (calls, `new`, JSX usage). */
  deps: string[];
  /** Non-call references to in-project symbols (types, consts). */
  refs: string[];
  /** File-level imports, including external packages. */
  imports: FileImport[];
}

export interface CallerInfo {
  file: string;
  symbol: string;
  line: number;
  /** Lines inside the caller where the call happens. Absent on indexes built before call-site tracking. */
  callSites?: number[];
}

export interface CallerDefinition {
  file: string;
  callers: CallerInfo[];
  referrers: CallerInfo[];
}

export interface CallersResult {
  symbol: string;
  /** Call edges (calls, `new`, JSX), flat union across matched definitions. */
  callers: CallerInfo[];
  /** Non-call usage (type annotations, constant refs), flat union. */
  referrers: CallerInfo[];
  /** Same callers grouped per matched definition. */
  definitions: CallerDefinition[];
}

export type FindingType = 'bug' | 'assumption' | 'decision' | 'deadend' | 'pattern';

export interface Finding {
  id: number;
  sessionId: string;
  agentRole: string;
  type: FindingType;
  symbol: string | null;
  file: string | null;
  finding: string;
  confidence: number;
  createdAt: number;
}

export interface RecordFindingInput {
  sessionId?: string;
  agentRole?: string;
  type: FindingType;
  symbol?: string;
  file?: string;
  finding: string;
  confidence?: number;
}

export interface RecallOpts {
  type?: FindingType;
  symbol?: string;
  sessionId?: string;
  sinceMs?: number;
}

export type BriefStatus = 'active' | 'frozen' | 'done';

export interface BriefData {
  id: string;
  projectPath: string;
  task: string;
  constraints: string[];
  knownContext: Array<{ symbol?: string; file?: string; range?: [number, number] }>;
  allowedActions: Array<{ type: string; file?: string; range?: [number, number] }>;
  unknowns: string[];
  successCriteria: string[];
  status: BriefStatus;
  createdAt: number;
}

export interface BriefValidation {
  valid: boolean;
  missing: string[];
}
