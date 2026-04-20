import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Network as NetworkIcon } from 'lucide-react';
import { useSessionDetail, useSessionGitStats, useSessionDetailLive } from '../../../hooks/queries/useSessions';
import { Tabs, Icon, Skeleton, EmptyState, SkeletonGrid } from '../../../components/ui';
import { HeroCard } from '../HeroCard';
import { StatsBand } from '../StatsBand';
import { TokenTimeline } from '../TokenTimeline/TokenTimeline';
import { ModelBreakdownTable } from '../ModelBreakdownTable/ModelBreakdownTable';
import { GitStatsPanel } from '../GitStatsPanel/GitStatsPanel';
import { SessionMetadata } from '../SessionMetadata/SessionMetadata';
import { SessionGraph } from '../../session-graph/SessionGraph';
import styles from './SessionDetail.module.css';

interface SectionProps {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}

function Section({ title, aside, children }: SectionProps) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {aside}
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: session, isLoading } = useSessionDetail(id);
  const { data: gitStats } = useSessionGitStats(id);
  useSessionDetailLive(id);

  if (isLoading) {
    return (
      <div className={styles.page}>
        <Skeleton width={240} height={120} />
        <SkeletonGrid count={6} height={96} />
      </div>
    );
  }

  if (!session) {
    return <EmptyState icon={NetworkIcon} title="Session not found" description={`No session with id ${id}`} />;
  }

  return (
    <div className={styles.page}>
      <Link to="/sessions" className={styles.back}>
        <Icon icon={ArrowLeft} size="sm" />
        <span>Back to sessions</span>
      </Link>

      <HeroCard session={session} />
      <StatsBand session={session} />

      {gitStats && (
        <Section title="Code Changes">
          <GitStatsPanel stats={gitStats} />
        </Section>
      )}

      <Section title="Token Timeline">
        <TokenTimeline events={session.events} />
      </Section>

      <Section title="Model Breakdown">
        <ModelBreakdownTable breakdown={session.modelBreakdown} />
      </Section>

      <Tabs
        defaultValue="graph"
        tabs={[
          { value: 'graph', label: 'Turn Graph', content: <SessionGraph sessionId={session.id} /> },
          { value: 'meta', label: 'Metadata', content: <SessionMetadata session={session} /> },
        ]}
      />
    </div>
  );
}
