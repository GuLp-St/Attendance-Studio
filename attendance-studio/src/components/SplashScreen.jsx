import { useState, useEffect } from 'react';

export default function SplashScreen({ isReady, onComplete }) {
  const [fading, setFading] = useState(false);
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);

  useEffect(() => {
    // Force a minimum display time of 1s so it doesn't flash off instantly
    const timer = setTimeout(() => setMinTimeElapsed(true), 1000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (minTimeElapsed && isReady) {
      setFading(true);
      const timer = setTimeout(onComplete, 500); // 0.5s fade out
      return () => clearTimeout(timer);
    }
  }, [minTimeElapsed, isReady, onComplete]);

  return (
    <div className={`splash-container ${fading ? 'fade-out' : ''}`}>
      <div className="splash-logo">
        <img src="/favicon.png" alt="App Logo" className="splash-icon" />
        <h1 className="splash-title">ATTENDANCE<br/>STUDIO</h1>
        <div className="splash-loader"></div>
      </div>
    </div>
  );
}
