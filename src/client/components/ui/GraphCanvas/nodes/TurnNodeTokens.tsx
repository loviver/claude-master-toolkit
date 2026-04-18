import { formatTokens } from '../lib/formatters';
import styles from '../GraphCanvas.module.css';

interface Props {
  input: number;
  output: number;
  cacheRead: number;
}

export function TurnNodeTokens({ input, output, cacheRead }: Props) {
  return (
    <div className={styles.tokens}>
      <span className={styles.tokenIn} title={`Input: ${input.toLocaleString()}`}>
        ↓ {formatTokens(input)}
      </span>
      <span className={styles.tokenOut} title={`Output: ${output.toLocaleString()}`}>
        ↑ {formatTokens(output)}
      </span>
      <span className={styles.tokenCache} title={`Cache read: ${cacheRead.toLocaleString()}`}>
        ◈ {formatTokens(cacheRead)}
      </span>
    </div>
  );
}
