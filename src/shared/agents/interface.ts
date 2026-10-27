export type AgentId = 'claude-code' | 'opencode' | 'cursor' | 'codex';
export type SupportTier = 'full' | 'partial' | 'stub';

export interface PlatformProfile {
  platform: 'linux' | 'darwin' | 'win32';
  arch: string;
}

export interface DetectionResult {
  installed: boolean;
  binaryPath?: string;
  configPath?: string;
  configFound: boolean;
}

export type SystemPromptStrategy = 'replace' | 'append' | 'file-replace';
export type McpStrategy = 'json' | 'toml' | 'yaml';

/** What the agent's hook protocol can express. Renderers degrade results using this. */
export interface AgentCapabilities {
  /** PreToolUse can return "ask" (permission prompt). */
  hookAsk: boolean;
  /** PreCompact can inject context. */
  preCompactContext: boolean;
  /** Agent has a status line command. */
  statusLine: boolean;
  /** SessionEnd carries a meaningful reason (clear/logout/...). */
  sessionEndReason: boolean;
}

export interface AgentAdapter {
  agent(): AgentId;
  tier(): SupportTier;

  detect(homeDir: string): Promise<DetectionResult>;

  supportsAutoInstall(): boolean;
  installCommand(profile: PlatformProfile): string[][];

  globalConfigDir(homeDir: string): string;
  systemPromptDir(homeDir: string): string;
  systemPromptFile(homeDir: string): string;
  skillsDir(homeDir: string): string;
  settingsPath(homeDir: string): string;

  systemPromptStrategy(): SystemPromptStrategy;
  mcpStrategy(): McpStrategy;
  mcpConfigPath(homeDir: string, serverName: string): string;

  supportsOutputStyles(): boolean;
  outputStyleDir(homeDir: string): string;
  supportsSlashCommands(): boolean;
  commandsDir(homeDir: string): string;
  supportsSkills(): boolean;
  supportsSystemPrompt(): boolean;

  capabilities(): AgentCapabilities;
  /** File holding hook registrations (settings.json / hooks.json). */
  hooksConfigPath(homeDir: string): string;
  /** Directory of sub-agent definitions. */
  agentsDir(homeDir: string): string;
  /** Root where the agent writes session transcripts. */
  transcriptsRoot(homeDir: string): string;
  /** Env var the agent exports with its session id, if any. */
  sessionIdEnv(): string | null;
  /** Model configured by the user for the main thread, or null if unknown. */
  readMainModel(homeDir: string): string | null;
  /** Concrete model for a tier, or null when the agent has no verified tier mapping (-> inherit). */
  tierModel(tier: 'high' | 'mid' | 'low'): string | null;
  supportsMCP(): boolean;
}
