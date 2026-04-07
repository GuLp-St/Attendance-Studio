import { useState, useEffect } from 'react';

export default function SplashScreen({ onComplete }) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    // 1.5 second display, then 0.5s fade out
    const timer1 = setTimeout(() => setFading(true), 1500);
    const timer2 = setTimeout(() => {
      onComplete();
    }, 2000);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [onComplete]);

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
