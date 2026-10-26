import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'smol-toml';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentId,
  DetectionResult,
  McpStrategy,
  PlatformProfile,
  SupportTier,
  SystemPromptStrategy,
} from './interface.js';

export class CodexAdapter implements AgentAdapter {
  agent(): AgentId {
    return 'codex';
  }
  tier(): SupportTier {
    return 'partial';
  }

  async detect(homeDir: string): Promise<DetectionResult> {
    const configPath = this.settingsPath(homeDir);
    const configFound = existsSync(configPath);
    return {
      installed: existsSync(this.globalConfigDir(homeDir)),
      configPath: configFound ? configPath : undefined,
      configFound: configFound || existsSync(this.systemPromptFile(homeDir)),
    };
  }

  supportsAutoInstall(): boolean {
    return false;
  }
  installCommand(_profile: PlatformProfile): string[][] {
    return [];
  }

  globalConfigDir(homeDir: string): string {
    return join(homeDir, '.codex');
  }
  systemPromptDir(homeDir: string): string {
    return this.globalConfigDir(homeDir);
  }
  systemPromptFile(homeDir: string): string {
    return join(this.globalConfigDir(homeDir), 'AGENTS.md');
  }
  skillsDir(homeDir: string): string {
    return join(this.globalConfigDir(homeDir), 'skills');
  }
  settingsPath(homeDir: string): string {
    return join(this.globalConfigDir(homeDir), 'config.toml');
  }
  commandsDir(homeDir: string): string {
    return join(this.globalConfigDir(homeDir), 'prompts');
  }
  outputStyleDir(homeDir: string): string {
    return join(this.globalConfigDir(homeDir), 'output-styles');
  }
  mcpConfigPath(homeDir: string, _serverName: string): string {
    return this.settingsPath(homeDir);
  }
  hooksConfigPath(homeDir: string): string {
    return join(this.globalConfigDir(homeDir), 'hooks.json');
  }
  agentsDir(homeDir: string): string {
    return join(this.globalConfigDir(homeDir), 'agents');
  }
  transcriptsRoot(homeDir: string): string {
    return join(this.globalConfigDir(homeDir), 'sessions');
  }
  /** Verified (Phase 0): Codex exports no session-id env to hook/MCP children. */
  sessionIdEnv(): string | null {
    return null;
  }

  systemPromptStrategy(): SystemPromptStrategy {
    return 'file-replace';
  }
  mcpStrategy(): McpStrategy {
    return 'toml';
  }

  supportsOutputStyles(): boolean {
    return false;
  }
  supportsSlashCommands(): boolean {
    return false;
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

  /** No verified tier→model mapping for Codex yet: always inherit the main model. */
  tierModel(_tier: 'high' | 'mid' | 'low'): string | null {
    return null;
  }

  capabilities(): AgentCapabilities {
    return { hookAsk: false, preCompactContext: false, statusLine: false, sessionEndReason: false };
  }

  readMainModel(homeDir: string): string | null {
    try {
      const cfg = parse(readFileSync(this.settingsPath(homeDir), 'utf-8'));
      return typeof cfg['model'] === 'string' ? cfg['model'] : null;
    } catch {
      return null;
    }
  }
}
