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
import './styles/tooltip.css';
import './styles/manage.css';
import './styles/phone.css';
import './styles/gd.css';
import './styles/trades.css';
import { installTooltips } from './tooltip.ts';

installTooltips();
import './styles/cinematics.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
