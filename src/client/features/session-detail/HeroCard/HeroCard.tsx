import { GitBranch } from 'lucide-react';
import type { SessionDetail } from '../../../lib/types';
import { CopyableValue, Icon } from '../../../components/ui';
import { formatProjectName } from '../../../lib/format';
import styles from './HeroCard.module.css';

interface HeroCardProps {
  session: SessionDetail;
}

export function HeroCard({ session }: HeroCardProps) {
  const title = session.customTitle || formatProjectName(session.projectPath);
  return (
    <section className={styles.hero}>
      <div className={styles.accent} />
      <header className={styles.head}>
        <h1 className={styles.title}>{title}</h1>
        <div className={styles.meta}>
          <CopyableValue value={session.id} maxChars={8} mono label="Session ID" />
          {session.gitBranch && (
            <span className={styles.branch}>
              <Icon icon={GitBranch} size="xs" />
              {session.gitBranch}
            </span>
          )}
        </div>
      </header>
      {session.lastPrompt && (
        <div className={styles.prompt}>
          <span className={styles.promptLabel}>Last prompt</span>
          <CopyableValue value={session.lastPrompt} maxChars={220} expandable label="Last prompt" />
        </div>
      )}
    </section>
  );
}
