import type { CodeGraphOverlay } from '../CodeGraph3D';
import type { RenderGraph } from '../graph-model';

/** What every graph-shaped view receives; the same contract as the 2D and 3D renderers. */
export interface GraphViewProps {
  graph: RenderGraph;
  selectedId: string | null;
  overlay: CodeGraphOverlay;
  onSelect: (id: string | null) => void;
}
