import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Network, ArrowRight } from 'lucide-react';
import { useSessions } from '../../hooks/queries/useSessions';
import { useProjects } from '../../hooks/queries/useStats';
import { useFilters } from '../../lib/filters';
import {
  PageHeader, FilterBar, Card, CardHeader, CardTitle, CardContent, Select,
  EmptyState, Skeleton, Badge, modelKeyBadgeVariant, Button, Icon,
} from '../../components/ui';
import { formatProjectName, formatRelativeTime } from '../../lib/format';
import { SessionGraph } from '../session-graph/SessionGraph';
import styles from './GraphExplorer.module.css';

export function GraphExplorer() {
  const { filters } = useFilters();
  const { data: projects } = useProjects(filters);
  const { data: sessions, isLoading } = useSessions({ ...filters, limit: 50 });
  const navigate = useNavigate();
  const [picked, setPicked] = useState<string | undefined>(undefined);

  const pickable = useMemo(
    () => (sessions ?? []).filter((s) => s.turnCount > 0),
    [sessions],
  );

  const pickOptions = useMemo(() => {
    const opts = [{ value: '', label: 'Pick a session…' }];
    for (const s of pickable) {
      opts.push({
        value: s.id,
        label: `${formatProjectName(s.projectPath)} · ${s.turnCount} turns · ${formatRelativeTime(s.lastActiveAt)}`,
      });
    }
    return opts;
  }, [pickable]);

  const activeId = picked ?? pickable[0]?.id;

  return (
    <div className={styles.page}>
      <PageHeader icon={Network} title="Graph Explorer" description="Inspect turn-level structure across recent sessions" />
      <FilterBar projects={projects ?? []} />

      {isLoading ? (
        <Skeleton height={600} radius="md" />
      ) : pickable.length === 0 ? (
        <Card>
          <EmptyState icon={Network} title="No sessions to explore" />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle>Select Session</CardTitle></CardHeader>
            <CardContent>
              <div className={styles.pickRow}>
                <Select
                  value={picked ?? ''}
                  onChange={(e) => setPicked(e.target.value || undefined)}
                  options={pickOptions}
                  className={styles.pickInput}
                />
                {activeId && (
                  <Button variant="ghost" onClick={() => navigate(`/sessions/${activeId}`)}>
                    Open session
                    <Icon icon={ArrowRight} size="sm" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {activeId && (
            <Card>
              <CardHeader>
                <CardTitle>Turn Graph</CardTitle>
                {(() => {
                  const s = pickable.find((x) => x.id === activeId);
                  return s ? <Badge variant={modelKeyBadgeVariant(s.primaryModelKey)}>{s.primaryModelKey}</Badge> : null;
                })()}
              </CardHeader>
              <CardContent>
                <SessionGraph sessionId={activeId} />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
