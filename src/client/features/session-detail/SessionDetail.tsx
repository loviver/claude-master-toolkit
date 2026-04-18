import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Network as NetworkIcon } from 'lucide-react';
import { useSessionDetail, useSessionGitStats } from '../../hooks/queries/useSessions';
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Tabs, Icon, Skeleton,
  EmptyState, SkeletonGrid,
} from '../../components/ui';
import { formatProjectName } from '../../lib/format';
import { SessionStats } from './SessionStats';
import { TokenTimeline } from './TokenTimeline';
import { ModelBreakdownTable } from './ModelBreakdownTable';
import { GitStatsPanel } from './GitStatsPanel';
import { SessionMetadata } from './SessionMetadata';
import { SessionGraph } from '../session-graph/SessionGraph';
import styles from './SessionDetail.module.css';

export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: session, isLoading } = useSessionDetail(id);
  const { data: gitStats } = useSessionGitStats(id);

  if (isLoading) {
    return (
      <div className={styles.page}>
        <Skeleton width={200} height={20} />
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

      <PageHeader
        title={formatProjectName(session.projectPath)}
        description={`Session ${session.id.slice(0, 8)}… · ${session.gitBranch ?? 'no branch'}`}
      />

      <SessionStats session={session} />

      {gitStats?.available && (
        <Card>
          <CardHeader><CardTitle>Code Changes</CardTitle></CardHeader>
          <CardContent>
            <GitStatsPanel stats={gitStats} />
          </CardContent>
        </Card>
      )}

      <Tabs
        defaultValue="timeline"
        tabs={[
          {
            value: 'timeline',
            label: 'Token Timeline',
            content: (
              <Card>
                <CardContent>
                  <TokenTimeline events={session.events} />
                </CardContent>
              </Card>
            ),
          },
          {
            value: 'graph',
            label: 'Turn Graph',
            content: <SessionGraph sessionId={session.id} />,
          },
          {
            value: 'models',
            label: 'Model Breakdown',
            content: (
              <Card>
                <CardContent>
                  <ModelBreakdownTable breakdown={session.modelBreakdown} />
                </CardContent>
              </Card>
            ),
          },
          {
            value: 'meta',
            label: 'Metadata',
            content: (
              <Card>
                <CardContent>
                  <SessionMetadata session={session} />
                </CardContent>
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
}
