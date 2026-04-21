import type { SessionDetail } from "../../../lib/types";
import {
  Table,
  TableBody,
  TableRow,
  TableCell,
  CopyableValue,
} from "../../../components/ui";
import { formatDate } from "../../../lib/format";

interface SessionMetadataProps {
  session: SessionDetail;
}

type Row =
  | { k: string; kind: "text"; v: string }
  | { k: string; kind: "copy"; v: string; max?: number; expandable?: boolean };

export function SessionMetadata({ session }: SessionMetadataProps) {
  const rows: Row[] = [
    { k: "Session ID", kind: "copy", v: session.id, max: 32 },
    { k: "Custom Title", kind: "text", v: session.customTitle ?? "—" },
    { k: "Entrypoint", kind: "copy", v: session.entrypoint ?? "—", max: 60 },
    { k: "Branch", kind: "copy", v: session.gitBranch ?? "—", max: 60 },
    { k: "Version", kind: "text", v: session.version ?? "—" },
    { k: "Started", kind: "text", v: formatDate(session.startedAt, true) },
    {
      k: "Last Active",
      kind: "text",
      v: formatDate(session.lastActiveAt, true),
    },
    {
      k: "Path",
      kind: "copy",
      v: session.projectPath,
      max: 60,
      expandable: true,
    },
    {
      k: "Last Prompt",
      kind: "copy",
      v: session.lastPrompt ?? "—",
      max: 80,
      expandable: true,
    },
  ];

  return (
    <Table>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.k}>
            <TableCell style={{ color: "var(--text-muted)", width: 140 }}>
              {row.k}
            </TableCell>
            <TableCell className="mono">
              {row.kind === "copy" && row.v !== "—" ? (
                <CopyableValue
                  value={row.v}
                  maxChars={row.max}
                  mono
                  expandable={row.expandable}
                  label={row.k}
                />
              ) : (
                row.v
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
