import Gallery from './pages/Gallery.tsx';
import { Route, Routes, useLocation } from 'react-router-dom';
import Home from './pages/Home.tsx';
import RoomPage from './pages/RoomPage.tsx';
import Leaderboard from './pages/Leaderboard.tsx';
import Profile from './pages/Profile.tsx';
import AdminPage from './pages/AdminPage.tsx';
import Header from './components/Header.tsx';
import BanScreen from './components/BanScreen.tsx';
import { AuthModalHost } from './components/AuthModal.tsx';
import { AuthProvider } from './auth.tsx';
import { ToastHost } from './toast.tsx';
import { DialogHost } from './components/Modal.tsx';

function Shell() {
  // The game screen is full-bleed 3D; everything else gets the site header.
  const inRoom = useLocation().pathname.startsWith('/r/');
  return (
    <>
      {!inRoom && <Header />}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/r/:code" element={<RoomPage />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/characters" element={<Gallery />} />
        <Route path="/u/:id" element={<Profile />} />
        <Route path="/admin/*" element={<AdminPage />} />
        <Route path="*" element={<Home />} />
      </Routes>
      <AuthModalHost />
      <BanScreen />
      <ToastHost />
      <DialogHost />
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
