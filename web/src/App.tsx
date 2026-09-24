import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LiveProvider, useLive } from "./live/LiveProvider";
import { CompetitorList } from "./pages/CompetitorList";
import { CompetitorTimeline } from "./pages/CompetitorTimeline";

export function App() {
  return (
    <ErrorBoundary>
      <LiveProvider>
        <BrowserRouter>
          <div className="app">
            <header className="site-header">
              <h1>CompetitorPulse</h1>
              <p>Track competitor listings and read what changed.</p>
              <ConnectionStatus />
            </header>
            <main>
              <Routes>
                <Route path="/" element={<CompetitorList />} />
                <Route path="/competitors/:id" element={<CompetitorTimeline />} />
              </Routes>
            </main>
          </div>
        </BrowserRouter>
      </LiveProvider>
    </ErrorBoundary>
  );
}

function ConnectionStatus() {
  const { connected, connectionError } = useLive();
  return <p className="muted">{connected ? "Live updates" : (connectionError ?? "Connecting…")}</p>;
}
