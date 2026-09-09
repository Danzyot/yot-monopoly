import { Navigate, Route, Routes } from 'react-router-dom';
import ConnectionBanner from './components/ConnectionBanner';
import Header from './components/Header';
import Audit from './pages/Audit';
import Home from './pages/Home';
import Leaderboard from './pages/Leaderboard';
import Lobby from './pages/Lobby';
import TablePage from './pages/TablePage';
import TablesOverview from './pages/TablesOverview';
import TournamentPage from './pages/TournamentPage';
import { useFeatureState } from './features';

export default function App() {
  // Three-state on purpose: while the answer is still in flight this route
  // must render nothing rather than redirect. Treating "not known yet" as
  // "off" bounced every shared /leaderboard link to the home page before the
  // config landed, so the link never worked for anyone who followed it.
  const leaderboard = useFeatureState('leaderboard');
  return (
    <div className="app">
      <Header />
      <ConnectionBanner />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/audit" element={<Audit />} />
        <Route
          path="/leaderboard"
          element={leaderboard === null ? null : leaderboard ? <Leaderboard /> : <Navigate to="/" replace />}
        />
        <Route path="/t/:id" element={<TournamentPage />} />
        <Route path="/t/:id/tables" element={<TablesOverview />} />
        <Route path="/table/:id" element={<TablePage />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </div>
  );
}
