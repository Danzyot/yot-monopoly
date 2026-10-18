import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './fonts/fonts.css';
import './index.css';
import './styles/outfits.css';
import './styles/turnflow.css';
import './styles/ui-polish.css';
import './styles/boards.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
