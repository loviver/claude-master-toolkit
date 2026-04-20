import { ArrowDown, ArrowUp, Database } from 'lucide-react';
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
        <ArrowDown size={10} /> {formatTokens(input)}
      </span>
      <span className={styles.tokenOut} title={`Output: ${output.toLocaleString()}`}>
        <ArrowUp size={10} /> {formatTokens(output)}
      </span>
      <span className={styles.tokenCache} title={`Cache read: ${cacheRead.toLocaleString()}`}>
        <Database size={10} /> {formatTokens(cacheRead)}
      </span>
    </div>
  );
}
