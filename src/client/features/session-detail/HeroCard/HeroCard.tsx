import { GitBranch, Image as ImageIcon } from 'lucide-react';
import type { SessionDetail } from '../../../lib/types';
import { CopyableValue, Icon } from '../../../components/ui';
import { formatProjectName } from '../../../lib/format';
import { summarizePrompt } from '../../../lib/prompt-summary';
import styles from './HeroCard.module.css';

interface HeroCardProps {
  session: SessionDetail;
}

export function HeroCard({ session }: HeroCardProps) {
  const title = session.customTitle || formatProjectName(session.projectPath);
  const prompt = session.lastPrompt ? summarizePrompt(session.lastPrompt) : null;
  return (
    <section className={styles.hero}>
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
      {prompt && (
        <div className={styles.prompt}>
          <span className={styles.promptLabel}>Last prompt</span>
          <div className={styles.promptBody}>
            {prompt.images > 0 && (
              <span className={styles.branch}>
                <Icon icon={ImageIcon} size="xs" />
                {prompt.images} {prompt.images === 1 ? 'image' : 'images'}
              </span>
            )}
            {prompt.text && <CopyableValue value={prompt.text} maxChars={220} expandable label="Last prompt" />}
          </div>
        </div>
      )}
    </section>
  );
}
