import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Code2, Network as NetworkIcon } from 'lucide-react';
import {
  useSessionDetail, useSessionGitStats, useSessionDetailLive, useSessionGraphLive, useSessionCodeActivity,
} from '../../../hooks/queries/useSessions';
import type { SessionCodeActivityDTO } from '../../../lib/types';
import { Tabs, Icon, Skeleton, EmptyState, SkeletonGrid, Button } from '../../../components/ui';
import { codeGraphHref } from '../code-graph-link';
import { HeroCard } from '../HeroCard';
import { StatsBand } from '../StatsBand';
import { TokenTimeline } from '../TokenTimeline/TokenTimeline';
import { ModelBreakdownTable } from '../ModelBreakdownTable/ModelBreakdownTable';
import { GitStatsPanel } from '../GitStatsPanel/GitStatsPanel';
import { SessionMetadata } from '../SessionMetadata/SessionMetadata';
import { HealthStrip, ActivityPanel } from '../SessionInsights';
import { computeSessionInsights } from '../session-insights';
import { SessionGraph } from '../../session-graph/SessionGraph';
import { SessionsSideBar } from '../../sessions/SessionsSideBar';
import { WorkbenchSlot } from '../../../shell/slots';
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

/** Opens the code graph on the session's project, spotlighting the files it touched. */
function ReviewInCodeGraph({ activity }: { activity: SessionCodeActivityDTO }) {
  const navigate = useNavigate();
  const { indexed, projectPath, sessionId, files } = activity;
  const hint = !indexed
    ? `Project not indexed: run ctk index build in ${projectPath}`
    : `Review ${files.length} touched file${files.length === 1 ? '' : 's'} in the code graph`;
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={!indexed || files.length === 0}
      title={hint}
      onClick={() => navigate(codeGraphHref({ project: projectPath, session: sessionId }))}
    >
      <Icon icon={Code2} size="sm" /> Review in Code Graph
    </Button>
  );
}

/** The detail fills the editor; recent sessions stay one click away under the navigation. */
export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  return (
    <>
      <WorkbenchSlot name="sideBarSection"><SessionsSideBar activeId={id} /></WorkbenchSlot>
      <SessionDetailContent />
    </>
  );
}

function SessionDetailContent() {
  const { id } = useParams<{ id: string }>();
  const { data: session, isLoading } = useSessionDetail(id);
  const { data: gitStats } = useSessionGitStats(id);
  const { data: activity } = useSessionCodeActivity(id);
  // Same query the Turn Graph uses, so the per-turn enrichment is fetched once.
  const { data: graph } = useSessionGraphLive(id);
  const insights = useMemo(() => (graph ? computeSessionInsights(graph.nodes) : null), [graph]);
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

      {insights && (
        <Section title="Health">
          <HealthStrip insights={insights} />
        </Section>
      )}

      {(gitStats || activity) && (
        <Section title="Code Changes" aside={activity && <ReviewInCodeGraph activity={activity} />}>
          {gitStats && <GitStatsPanel stats={gitStats} />}
        </Section>
      )}

      {insights && (
        <Section title="Activity">
          <ActivityPanel insights={insights} />
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
