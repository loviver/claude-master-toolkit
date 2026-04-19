import { basename } from 'path';
import {
  getLatestSessionFile,
  getSessionTokens,
  getLatestTurnUsage,
} from '../../shared/jsonl-parser/index.js';
import { computeCost, resolveModelKey } from '../../shared/pricing.js';
import { output, outputError, isJsonMode, formatTokens, formatCost, readMainModel, formatTokensWithColor, formatCostWithColor } from '../../shared/output.js';
import { c, padRight } from '../../shared/terminal.js';

export async function costCommand(options: { quiet?: boolean }): Promise<void> {
  const sessionFile = getLatestSessionFile();

  if (!sessionFile) {
    if (options.quiet) return;
    outputError('cost: no session data');
    return;
  }

  const tokens = await getSessionTokens(sessionFile);
  const model = readMainModel();
  const modelKey = resolveModelKey(model);
  const cost = computeCost(modelKey, tokens);

  if (isJsonMode()) {
    output({
      model: modelKey,
      tokens,
      costUsd: Number(cost.toFixed(4)),
    });
  } else if (options.quiet) {
    console.log(cost.toFixed(4));
  } else {
    const line1 = padRight(`${c.muted('Model')}   ${modelKey}`, 40);
    const line2 = padRight(`${c.muted('In')}       ${formatTokensWithColor(tokens.inputTokens)}`, 40);
    const line3 = padRight(`${c.muted('Out')}      ${formatTokensWithColor(tokens.outputTokens)}`, 40);
    const line4 = padRight(`${c.muted('Cache R/W')} ${formatTokensWithColor(tokens.cacheReadTokens)} / ${formatTokensWithColor(tokens.cacheCreationTokens)}`, 40);
    const line5 = `${c.muted('Cost')}    ${formatCostWithColor(cost)}`;

    console.log(`\n${line1}\n${line2}\n${line3}\n${line4}\n${line5}\n`);
  }
}

const CONTEXT_WINDOW = 200_000;

export async function contextCommand(): Promise<void> {
  const sessionFile = getLatestSessionFile();

  if (!sessionFile) {
    outputError('context: no Claude Code session data');
    return;
  }

  // Current window = last turn (input + cache_read + output)
  const lastTurn = await getLatestTurnUsage(sessionFile);
  const window = lastTurn.inputTokens + lastTurn.cacheReadTokens + lastTurn.outputTokens;
  const pct = Math.round((window * 100) / CONTEXT_WINDOW);

  // Cumulative cost
  const cumulative = await getSessionTokens(sessionFile);
  const model = readMainModel();
  const modelKey = resolveModelKey(model);
  const cost = computeCost(modelKey, cumulative);

  if (isJsonMode()) {
    output({
      session: basename(sessionFile),
      window: {
        tokens: window,
        pct,
        lastTurn,
      },
      cumulative: {
        tokens: cumulative,
        costUsd: Number(cost.toFixed(4)),
        model: modelKey,
      },
      advice: pct >= 95 ? 'CRITICAL — /compact now' :
              pct >= 85 ? 'Strong /compact recommendation' :
              pct >= 70 ? 'Consider /compact soon' : null,
    });
  } else {
    console.log(`\n${c.muted('Session')}  ${basename(sessionFile)}`);

    const windowStr = `${formatTokensWithColor(window)} tokens (~${c.warn(`${pct}%`)} of 200k)`;
    const lastTurnStr = `in=${formatTokensWithColor(lastTurn.inputTokens)} cache_r=${formatTokensWithColor(lastTurn.cacheReadTokens)} out=${formatTokensWithColor(lastTurn.outputTokens)}`;
    console.log(`${c.muted('Window')}   ${windowStr} — last turn: ${lastTurnStr}`);

    const cumulativeStr = `in=${formatTokensWithColor(cumulative.inputTokens)} out=${formatTokensWithColor(cumulative.outputTokens)} cache_r=${formatTokensWithColor(cumulative.cacheReadTokens)} cache_w=${formatTokensWithColor(cumulative.cacheCreationTokens)} (cumulative)`;
    console.log(`${c.muted('Session')}  ${cumulativeStr}`);

    console.log(`${c.muted('Cost')}     ${formatCostWithColor(cost)} (${modelKey})`);

    if (pct >= 70) {
      const adviceText = pct >= 95 ? c.error('/compact now') :
                         pct >= 85 ? c.warn('/compact strongly recommended') :
                         c.warn('/compact soon');
      console.log(`${c.muted('Advice')}    ${adviceText} (continuing) or /clear (new task)`);
    }
    console.log('');
  }
}
