import { Suspense, lazy } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import Home from './pages/Home.tsx';
import Header from './components/Header.tsx';
import BanScreen from './components/BanScreen.tsx';
import { AuthModalHost } from './components/AuthModal.tsx';
import { AuthProvider } from './auth.tsx';
import { ToastHost } from './toast.tsx';
import { DialogHost } from './components/Modal.tsx';
import { TextEditHost } from './textEdit.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { useRouteMeta } from './routeMeta.ts';
import WelcomeHost from './components/WelcomeHost.tsx';
import './styles/site.css';

// Only the home page ships in the first download; every other page (and
// three.js with it) loads when it is first opened.
const RoomPage = lazy(() => import('./pages/RoomPage.tsx'));
// Monopoly's own home (the hub at / is about all three games).
const MonopolyHome = lazy(() => import('./pages/MonopolyHome.tsx'));
const Gallery = lazy(() => import('./pages/Gallery.tsx'));
const Leaderboard = lazy(() => import('./pages/Leaderboard.tsx'));
const Profile = lazy(() => import('./pages/Profile.tsx'));
const AdminPage = lazy(() => import('./pages/AdminPage.tsx'));
const WalletPage = lazy(() => import('./wallet/WalletPage.tsx'));
// Sign in here and carry on at poker (poker's "Sign in via Chog Games" button lands here).
const Sso = lazy(() => import('./pages/Sso.tsx'));
// Chog Cards: its own pages (and styles), loaded only when opened.
const CardsHome = lazy(() => import('./cards/CardsHome.tsx'));
const CardsRoomPage = lazy(() => import('./cards/CardsRoomPage.tsx'));
// Chog Poker's home here: its tournaments, Play and Host (the tables are on poker's own site).
const PokerHome = lazy(() => import('./poker/PokerHome.tsx'));
// Tournaments for both games: the list, the create form, one event.
const TournamentsPage = lazy(() => import('./tournaments/TournamentsPage.tsx'));
const CreateTournament = lazy(() => import('./tournaments/CreateTournament.tsx'));
const TournamentPage = lazy(() => import('./tournaments/TournamentPage.tsx'));
// The footer and the info and not-found pages: after the page, never in the first download.
const Footer = lazy(() => import('./components/Footer.tsx'));
const LegalPage = lazy(() => import('./pages/LegalPage.tsx'));
const NotFound = lazy(() => import('./pages/NotFound.tsx'));

/** Shown for the moment a page's code is still on its way: the page's shape, not a blank. */
const PageLoading = () => (
  <div className="page-loading" aria-busy="true" aria-label="Loading">
    <div className="sk sk-title" /><div className="sk sk-hero" /><div className="sk sk-row" /><div className="sk sk-row" />
  </div>
);

function Shell() {
  // The game screen is full-bleed 3D; everything else gets the site header.
  const path = useLocation().pathname;
  const inRoom = path.startsWith('/r/') || path.startsWith('/cards/r/');
  // Title, description and share tags for the page (shared/seo.ts).
  useRouteMeta();
  return (
    <>
      {/* Keyboard users can jump past the header's links straight to the page. */}
      {!inRoom && <a className="skip-link" href="#main">Skip to content</a>}
      {!inRoom && <Header />}
      <span id="main" tabIndex={-1} className="sr-only" />
      {/* A page that throws shows "Something broke" (and is reported); a new page clears it. */}
      <ErrorBoundary resetKey={path}>
      <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/monopoly" element={<MonopolyHome />} />
        <Route path="/r/:code" element={<RoomPage />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/characters" element={<Gallery />} />
        <Route path="/u/:id" element={<Profile />} />
        <Route path="/admin/*" element={<AdminPage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/sso" element={<Sso />} />
        <Route path="/cards" element={<CardsHome />} />
        <Route path="/cards/r/:code" element={<CardsRoomPage />} />
        <Route path="/poker" element={<PokerHome />} />
        <Route path="/tournaments" element={<TournamentsPage />} />
        <Route path="/tournaments/new" element={<CreateTournament />} />
        <Route path="/tournaments/:id" element={<TournamentPage />} />
        <Route path="/terms" element={<LegalPage slug="terms" />} />
        <Route path="/privacy" element={<LegalPage slug="privacy" />} />
        <Route path="/fair-play" element={<LegalPage slug="fair-play" />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
      </ErrorBoundary>
      {/* Every page but the game screens; its own boundary so it never holds a page up. */}
      {!inRoom && <Suspense fallback={null}><ErrorBoundary resetKey={path}><Footer /></ErrorBoundary></Suspense>}
      <AuthModalHost />
      <WelcomeHost />
      <BanScreen />
      <ToastHost />
      <DialogHost />
      <TextEditHost />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary full>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </ErrorBoundary>
  );
}
