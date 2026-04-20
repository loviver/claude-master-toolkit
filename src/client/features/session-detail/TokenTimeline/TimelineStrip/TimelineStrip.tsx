import type { TimelineSegment } from '../../../../hooks/useTokenTimelineData';
import { colorForModel } from '../../../../lib/model-colors';
import { shortModel } from '../../../../lib/format';
import styles from './TimelineStrip.module.css';

interface TimelineStripProps {
  segments: TimelineSegment[];
}

export function TimelineStrip({ segments }: TimelineStripProps) {
  return (
    <div className={styles.strip}>
      {segments.map((s, i) => (
        <div
          key={i}
          className={styles.seg}
          style={{ flex: s.end - s.start + 1, background: colorForModel(s.model) }}
          title={`${shortModel(s.model)} · turns ${s.start + 1}–${s.end + 1}`}
        />
      ))}
    </div>
  );
}
