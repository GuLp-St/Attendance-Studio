import { useState, useEffect, useRef } from 'react';

export default function A2HSPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const autoTriggerRef = useRef(false);

  useEffect(() => {
    if (localStorage.getItem('atd_a2hs_dismissed') === 'true') return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);

      // If the banner is already open and user hasn't installed yet, auto-trigger the prompt
      if (autoTriggerRef.current) {
        autoTriggerRef.current = false;
        e.prompt();
        e.userChoice.then(({ outcome }) => {
          if (outcome === 'accepted') setShowPrompt(false);
          setDeferredPrompt(null);
        });
      }
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Show banner after 2s
    const t = setTimeout(() => setShowPrompt(true), 2000);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      clearTimeout(t);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      // Native install prompt available — trigger it directly
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setShowPrompt(false);
      setDeferredPrompt(null);
    } else {
      // beforeinstallprompt hasn't fired yet — set flag so it auto-triggers when ready
      // and show manual Android instructions as fallback
      autoTriggerRef.current = true;
      setShowManual(true);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem('atd_a2hs_dismissed', 'true');
    setShowPrompt(false);
    setShowManual(false);
  };

  if (!showPrompt) return null;

  return (
    <div className="a2hs-banner">
      {showManual ? (
        /* Fallback: browser didn't fire beforeinstallprompt yet */
        <div style={{ flex: 1, width: '100%' }}>
          <h4 style={{ margin: '0 0 8px', color: 'var(--primary)' }}>INSTALL MANUALLY</h4>
          <p style={{ margin: '0 0 6px', fontSize: '0.75rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
            Tap <strong style={{ color: '#fff' }}>⋮ (3-dot menu)</strong> in your browser, then select <strong style={{ color: '#fff' }}>"Add to Home screen"</strong>.
          </p>
          <p style={{ margin: '0 0 12px', fontSize: '0.7rem', color: '#555' }}>
            (The install prompt will appear automatically if your browser supports it.)
          </p>
          <button className="btn" style={{ width: '100%', padding: '10px' }} onClick={handleDismiss}>DISMISS</button>
        </div>
      ) : (
        <>
          <div style={{ flex: 1, width: '100%', textAlign: 'center', marginBottom: '10px' }}>
            <h4 style={{ margin: 0, color: 'var(--primary)', marginBottom: '5px' }}>ADD TO HOME SCREEN</h4>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              Install Attendance Studio for push notifications and faster access.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
            <button className="btn" style={{ borderColor: 'var(--primary)', color: 'var(--primary)', width: '100%', padding: '10px' }} onClick={handleInstallClick}>INSTALL APP</button>
            <button className="btn" style={{ width: '100%', padding: '10px' }} onClick={handleDismiss}>MAYBE LATER</button>
          </div>
        </>
      )}
    </div>
  );
}
