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

// Only the home page ships in the first download; every other page (and
// three.js with it) loads when it is first opened.
const RoomPage = lazy(() => import('./pages/RoomPage.tsx'));
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

/** Shown for the moment a page's code is still on its way. */
const PageLoading = () => <div className="center-msg"><p className="muted">Loading…</p></div>;

function Shell() {
  // The game screen is full-bleed 3D; everything else gets the site header.
  const path = useLocation().pathname;
  const inRoom = path.startsWith('/r/') || path.startsWith('/cards/r/');
  return (
    <>
      {!inRoom && <Header />}
      <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/r/:code" element={<RoomPage />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/characters" element={<Gallery />} />
        <Route path="/u/:id" element={<Profile />} />
        <Route path="/admin/*" element={<AdminPage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/sso" element={<Sso />} />
        <Route path="/cards" element={<CardsHome />} />
        <Route path="/cards/r/:code" element={<CardsRoomPage />} />
        <Route path="*" element={<Home />} />
      </Routes>
      </Suspense>
      <AuthModalHost />
      <BanScreen />
      <ToastHost />
      <DialogHost />
      <TextEditHost />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
