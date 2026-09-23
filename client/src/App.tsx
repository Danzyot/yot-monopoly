import { Route, Routes } from 'react-router-dom';
import Home from './pages/Home.tsx';
import RoomPage from './pages/RoomPage.tsx';
import { ToastHost } from './toast.tsx';

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/r/:code" element={<RoomPage />} />
        <Route path="*" element={<Home />} />
      </Routes>
      <ToastHost />
    </>
  );
}
