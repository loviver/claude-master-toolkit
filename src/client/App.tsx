import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryProvider } from './providers/QueryProvider';
import { Layout } from './components/Layout';
import { Overview } from './features/overview/Overview';
import { SessionList } from './features/sessions/SessionList';
import { SessionDetail } from './features/session-detail/SessionDetail/SessionDetail';
import { Models } from './features/models/Models';
import { Tools } from './features/tools/Tools';
import { Phases } from './features/phases/Phases';
import { Efficiency } from './features/efficiency/Efficiency';
import { Memories } from './features/memories/Memories';
import { Projects } from './features/projects/Projects';
import { GraphExplorer } from './features/graph/GraphExplorer';
import { Settings } from './features/settings/Settings';
import { Skeleton } from './components/ui';

// three.js is heavy: the code graph ships as its own chunk, loaded only when visited.
const CodeGraphPage = lazy(() =>
  import('./features/code-graph/CodeGraphPage').then((m) => ({ default: m.CodeGraphPage })),
);

export function App() {
  return (
    <QueryProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/"              element={<Overview />} />
            <Route path="/sessions"      element={<SessionList />} />
            <Route path="/sessions/:id"  element={<SessionDetail />} />
            <Route path="/graph"         element={<GraphExplorer />} />
            <Route
              path="/code-graph"
              element={<Suspense fallback={<Skeleton height={640} radius="md" />}><CodeGraphPage /></Suspense>}
            />
            <Route path="/projects"      element={<Projects />} />
            <Route path="/models"        element={<Models />} />
            <Route path="/tools"         element={<Tools />} />
            <Route path="/phases"        element={<Phases />} />
            <Route path="/efficiency"    element={<Efficiency />} />
            <Route path="/memories"      element={<Memories />} />
            <Route path="/settings"      element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryProvider>
  );
}
