import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts are bundled, not fetched from a CDN: this app promises to work with no
// internet after setup, and a webfont link would silently fall back to system
// faces the moment the machine goes offline.
import '@fontsource-variable/inter';
import '@fontsource-variable/lora';
import '@fontsource-variable/outfit';
import App from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
