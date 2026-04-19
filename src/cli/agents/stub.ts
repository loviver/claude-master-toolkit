import type {
  AgentAdapter,
  AgentId,
  DetectionResult,
  McpStrategy,
  PlatformProfile,
  SupportTier,
  SystemPromptStrategy,
} from './interface.js';

export class StubAdapter implements AgentAdapter {
  constructor(private readonly id: AgentId) {}

  private nope(): never {
    throw new Error(`${this.id} adapter not supported in Phase 0`);
  }

  agent(): AgentId {
    return this.id;
  }
  tier(): SupportTier {
    return 'stub';
  }

  async detect(_homeDir: string): Promise<DetectionResult> {
    return { installed: false, configFound: false };
  }

  supportsAutoInstall(): boolean {
    return false;
  }
  installCommand(_profile: PlatformProfile): string[][] {
    this.nope();
  }

  globalConfigDir(_homeDir: string): string {
    this.nope();
  }
  systemPromptDir(_homeDir: string): string {
    this.nope();
  }
  systemPromptFile(_homeDir: string): string {
    this.nope();
  }
  skillsDir(_homeDir: string): string {
    this.nope();
  }
  settingsPath(_homeDir: string): string {
    this.nope();
  }
  commandsDir(_homeDir: string): string {
    this.nope();
  }
  outputStyleDir(_homeDir: string): string {
    this.nope();
  }
  mcpConfigPath(_homeDir: string, _serverName: string): string {
    this.nope();
  }

  systemPromptStrategy(): SystemPromptStrategy {
    return 'file-replace';
  }
  mcpStrategy(): McpStrategy {
    return 'json';
  }

  supportsOutputStyles(): boolean {
    return false;
  }
  supportsSlashCommands(): boolean {
    return false;
  }
  supportsSkills(): boolean {
    return false;
  }
  supportsSystemPrompt(): boolean {
    return false;
  }
  supportsMCP(): boolean {
    return false;
  }
}
