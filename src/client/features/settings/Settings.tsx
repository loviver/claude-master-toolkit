import { useState } from 'react';
import { Settings as SettingsIcon, CheckCircle2 } from 'lucide-react';
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Button, Select, FormGroup,
  Table, TableHead, TableBody, TableRow, TableCell, Icon,
} from '../../components/ui';
import styles from './Settings.module.css';

const PREF_OPTIONS = [
  { value: 'inherit', label: 'Inherit (use current model)' },
  { value: 'auto',    label: 'Auto (smart routing)' },
  { value: 'opus',    label: 'Opus — always' },
  { value: 'sonnet',  label: 'Sonnet — always' },
  { value: 'haiku',   label: 'Haiku — always' },
];

const PREF_HELP: Record<string, string> = {
  inherit: 'Sub-agents use the same model as the main conversation',
  auto:    'Opus for architectural phases, Haiku for archive, inherit otherwise',
  opus:    'All delegated work uses Opus',
  sonnet:  'All delegated work uses Sonnet',
  haiku:   'All delegated work uses Haiku',
};

const CLI_COMMANDS = [
  { cmd: 'ctk model-pref get',          desc: 'Show current preference' },
  { cmd: 'ctk model-pref set auto',     desc: 'Enable smart routing' },
  { cmd: 'ctk model-pref set pinned:opus', desc: 'Lock everything to Opus' },
  { cmd: 'ctk model-pref clear',        desc: 'Reset to inherit (default)' },
  { cmd: 'ctk cost --json',             desc: 'Session cost in JSON format' },
  { cmd: 'ctk context --json',          desc: 'Context window usage in JSON' },
  { cmd: 'ctk slice file.ts funcName',  desc: 'Extract a function from a file' },
  { cmd: 'ctk dashboard',               desc: 'Open this dashboard' },
];

export function Settings() {
  const [pref, setPref] = useState('inherit');
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    try {
      const res = await fetch('/api/settings/model-pref', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preference: pref }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      alert(`Run in terminal: ctk model-pref set ${pref}`);
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader icon={SettingsIcon} title="Settings" description="CLI + model preferences" />

      <Card>
        <CardHeader><CardTitle>Model Preference</CardTitle></CardHeader>
        <CardContent>
          <FormGroup>
            <Select
              label="Preference"
              value={pref}
              onChange={(e) => setPref(e.target.value)}
              options={PREF_OPTIONS}
              helperText={PREF_HELP[pref]}
            />
            <Button onClick={handleSave}>
              {saved ? <><Icon icon={CheckCircle2} size="sm" /> Saved</> : 'Save Preference'}
            </Button>
          </FormGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>CLI Quick Reference</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell variant="head">Command</TableCell>
                <TableCell variant="head">Description</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {CLI_COMMANDS.map((c) => (
                <TableRow key={c.cmd}>
                  <TableCell className="mono">{c.cmd}</TableCell>
                  <TableCell>{c.desc}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
