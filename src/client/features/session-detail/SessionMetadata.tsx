import type { SessionDetail } from '../../lib/types';
import { Table, TableBody, TableRow, TableCell } from '../../components/ui';
import { formatDate } from '../../lib/format';

interface Props {
  session: SessionDetail;
}

export function SessionMetadata({ session }: Props) {
  const rows: Array<[string, string]> = [
    ['Session ID', session.id],
    ['Branch', session.gitBranch ?? '—'],
    ['Version', session.version ?? '—'],
    ['Started', formatDate(session.startedAt, true)],
    ['Last Active', formatDate(session.lastActiveAt, true)],
    ['Path', session.projectPath],
  ];
  return (
    <Table>
      <TableBody>
        {rows.map(([k, v]) => (
          <TableRow key={k}>
            <TableCell style={{ color: 'var(--text-muted)', width: 140 }}>{k}</TableCell>
            <TableCell className="mono">{v}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
