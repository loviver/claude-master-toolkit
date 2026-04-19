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
  supportsMCP(): boolean;
}
