import { existsSync } from 'fs';
import { join } from 'path';
import type {
  AgentAdapter,
  AgentId,
  DetectionResult,
  McpStrategy,
  PlatformProfile,
  SupportTier,
  SystemPromptStrategy,
} from './interface.js';

export class ClaudeCodeAdapter implements AgentAdapter {
  agent(): AgentId {
    return 'claude-code';
  }
  tier(): SupportTier {
    return 'full';
  }

  async detect(homeDir: string): Promise<DetectionResult> {
    const configPath = this.settingsPath(homeDir);
    const configFound = existsSync(configPath);
    const claudeMd = this.systemPromptFile(homeDir);
    return {
      installed: existsSync(this.globalConfigDir(homeDir)),
      configPath: configFound ? configPath : undefined,
      configFound: configFound || existsSync(claudeMd),
    };
  }

  supportsAutoInstall(): boolean {
    return false;
  }
  installCommand(_profile: PlatformProfile): string[][] {
    return [];
  }

  globalConfigDir(homeDir: string): string {
    return join(homeDir, '.claude');
  }
  systemPromptDir(homeDir: string): string {
    return this.globalConfigDir(homeDir);
  }
  systemPromptFile(homeDir: string): string {
    return join(this.globalConfigDir(homeDir), 'CLAUDE.md');
  }
  skillsDir(homeDir: string): string {
    return join(this.globalConfigDir(homeDir), 'skills');
  }
  settingsPath(homeDir: string): string {
    return join(this.globalConfigDir(homeDir), 'settings.json');
  }
  commandsDir(homeDir: string): string {
    return join(this.globalConfigDir(homeDir), 'commands');
  }
  outputStyleDir(homeDir: string): string {
    return join(this.globalConfigDir(homeDir), 'output-styles');
  }
  mcpConfigPath(homeDir: string, _serverName: string): string {
    return this.settingsPath(homeDir);
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
    return true;
  }
  supportsSkills(): boolean {
    return true;
  }
  supportsSystemPrompt(): boolean {
    return true;
  }
  supportsMCP(): boolean {
    return true;
  }
}
