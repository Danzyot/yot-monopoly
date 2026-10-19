import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/inter';
import App from './App';
import { AuthProvider } from './auth';
import { ToastProvider } from './toast';
import { FeatureProvider } from './features';
import './index.css';
import { armAudioOnFirstGesture, armUiClickSounds } from './sound';
import { installButtonGlow } from './glow';

// Sound is unlocked by the first click/tap/key anywhere in the app.
armAudioOnFirstGesture();
// Every button and control gets a soft click tick (skipped when a game
// sound owns the moment, and silenced entirely by the mute switch).
armUiClickSounds();
// The primary buttons' aura follows the cursor. See glow.ts.
installButtonGlow();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <FeatureProvider>
          <App />
          </FeatureProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
