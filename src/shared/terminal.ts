import chalk from 'chalk';
import boxen from 'boxen';
import ora from 'ora';

// Semantic color palette matched to design tokens
export const c = {
  muted: chalk.hex('#a09e98'),
  primary: chalk.hex('#1a1917'),
  success: chalk.hex('#16a34a'),
  error: chalk.hex('#dc2626'),
  warn: chalk.hex('#f59e0b'),
  accent: chalk.hex('#da7756'),     // Claude coral
  blue: chalk.hex('#7c6af7'),
  mono: chalk.hex('#5c5b57'),
  value: chalk.bold,
  check: chalk.hex('#16a34a'),      // ✓ success
};

/**
 * Create a boxed output with title
 */
export function boxedOutput(title: string, lines: string[]): string {
  const content = lines.join('\n');
  return boxen(content, {
    title: title,
    titleAlignment: 'left',
    padding: { top: 1, bottom: 1, left: 1, right: 1 },
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
    borderStyle: 'round',
    borderColor: '#a09e98', // --text-muted
  });
}

/**
 * Create a spinner with consistent styling
 */
export function spinner(text: string) {
  return ora({
    text: c.muted(text),
    spinner: 'dots',
    stream: process.stdout,
  });
}

/**
 * Format cost with semantic color
 * Green: < $0.01
 * Orange: < $0.10
 * Red: >= $0.10
 */
export function formatCostColored(usd: number): string {
  const str = `$${usd.toFixed(4)}`;
  if (usd < 0.01) return c.success(str);
  if (usd < 0.10) return c.warn(str);
  return c.error(str);
}

/**
 * Format token count with monospace styling
 */
export function formatTokensColored(n: number): string {
  const units = ['', 'k', 'M', 'B'];
  let i = 0;
  let val = n;
  while (val >= 1000 && i < units.length - 1) {
    val /= 1000;
    i++;
  }
  return c.mono(`${val.toFixed(1)}${units[i]}`);
}

/**
 * Pad string to width for table alignment
 */
export function padRight(str: string, width: number): string {
  return str + ' '.repeat(Math.max(0, width - str.length));
}

/**
 * Success indicator
 */
export function success(text: string): string {
  return `${c.check('✓')}  ${text}`;
}

/**
 * Error indicator
 */
export function errorIcon(text: string): string {
  return `${c.error('✗')}  ${text}`;
}

/**
 * Arrow indicator
 */
export function arrow(text: string): string {
  return `${c.accent('→')}  ${text}`;
}
