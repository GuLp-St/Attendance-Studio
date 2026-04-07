import { useState, useEffect } from 'react';

export default function A2HSPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // Show the prompt immediately if not running standalone
    // We do this because the user explicitly wants to see it to indicate they should install!
    if (!window.matchMedia('(display-mode: standalone)').matches) {
       setTimeout(() => setShowPrompt(true), 2000);
    }

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowPrompt(false);
      }
      setDeferredPrompt(null);
    } else {
      // Fallback if the browser doesn't send beforeinstallprompt or it was missed
      alert("To install: tap the Share button (iOS) or browser menu (Android/Desktop) and select 'Add to Home Screen'.");
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
  };

  if (!showPrompt) return null;

  return (
    <div className="a2hs-banner">
      <div style={{ flex: 1 }}>
        <h4 style={{ margin: 0, color: 'var(--primary)', marginBottom: '5px' }}>ADD TO HOME SCREEN</h4>
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          Install Attendance Studio for push notifications and faster access.
        </p>
      </div>
      <div style={{ display: 'flex', gap: '10px' }}>
        <button className="btn" onClick={handleDismiss}>MAYBE LATER</button>
        <button className="btn" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }} onClick={handleInstallClick}>INSTALL APP</button>
      </div>
    </div>
  );
}
