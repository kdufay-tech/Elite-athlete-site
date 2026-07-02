import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// RevenueCat init (iOS native only — no-op on web/Android)
import { Capacitor } from '@capacitor/core';
import { Purchases, LOG_LEVEL } from '@revenuecat/purchases-capacitor';
import { StatusBar, Style } from '@capacitor/status-bar';

if (Capacitor.getPlatform() === 'ios') {
  Purchases.setLogLevel({ level: LOG_LEVEL.WARN });
  Purchases.configure({ apiKey: import.meta.env.VITE_REVENUECAT_APPLE_KEY })
    .catch(err => console.warn('RevenueCat configure failed:', err));
  // Native status bar: dark background, light text (matches black/gold theme)
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  StatusBar.setBackgroundColor({ color: '#060504' }).catch(() => {});
}

// Register service worker for PWA install (Android + iOS)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('SW registered:', reg.scope))
      .catch(err => console.warn('SW registration failed:', err));
  });
}

// Capture install prompt for Android "Add to Home Screen"
window.__pwaInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__pwaInstallPrompt = e;
  window.dispatchEvent(new Event('pwaInstallReady'));
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
