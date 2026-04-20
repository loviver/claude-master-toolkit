import type { SessionDetail } from '../../../lib/types';
import { StatsBand } from '../StatsBand';

interface SessionStatsProps {
  session: SessionDetail;
}

export function SessionStats({ session }: SessionStatsProps) {
  return <StatsBand session={session} />;
}
