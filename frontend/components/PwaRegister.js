'use client';

import { useEffect, useState } from 'react';

/**
 * Registers the service worker (offline PWA) and surfaces the native
 * "Add to home screen / Install" prompt when the browser offers it.
 */
export default function PwaRegister() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Service worker registration (only for the PWA install path).
    if ('serviceWorker' in navigator && process.env.NEXT_PUBLIC_NO_SW !== 'true') {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    const onPrompt = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!installPrompt || installed) return null;

  return (
    <button
      onClick={async () => {
        installPrompt.prompt();
        await installPrompt.userChoice.catch(() => {});
        setInstallPrompt(null);
      }}
      className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-blue-500"
    >
      ⬇ Install App
    </button>
  );
}
