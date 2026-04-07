import { useState, useEffect } from 'react';

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Show only if not completed and we are not recently logged in (so we don't conflict with splash screen)
    const isDone = localStorage.getItem('atd_tutorial_done') === 'true';
    if (!isDone) {
      setTimeout(() => setShow(true), 1500);
    }
  }, []);

  const steps = [
    {
      text: "Welcome to Attendance Studio! This is your control center for managing classes and activities.",
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      arrow: 'none'
    },
    {
      text: "The CLASSES tab shows all your current subjects and your timetable overview.",
      top: '150px',
      left: '20px',
      transform: 'none',
      arrow: 'up'
    },
    {
      text: "Jump into COURSEHUB to manage advanced settings and autoscan configurations.",
      top: '150px',
      right: '20px',
      transform: 'none',
      arrow: 'up'
    },
    {
      text: "Use the SCHEDULER to view automated jobs running in the background.",
      top: '150px',
      right: '20px',
      transform: 'none',
      arrow: 'up'
    }
  ];

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      endTutorial();
    }
  };

  const endTutorial = () => {
    localStorage.setItem('atd_tutorial_done', 'true');
    setShow(false);
  };

  if (!show) return null;

  const current = steps[step];

  return (
    <>
      <div className="onboarding-overlay" style={{
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', 
        background: 'rgba(0,0,0,0.6)', zIndex: 9998, pointerEvents: 'auto'
      }}></div>

      <div className="onboarding-tooltip" style={{
        position: 'fixed',
        top: current.top,
        left: current.left,
        right: current.right,
        bottom: current.bottom,
        transform: current.transform,
        zIndex: 9999,
        background: 'rgba(0, 20, 20, 0.95)',
        border: '1px solid var(--primary)',
        boxShadow: '0 0 20px var(--primary-dim)',
        padding: '20px',
        borderRadius: '8px',
        width: '90%',
        maxWidth: '300px',
        color: '#fff',
        backdropFilter: 'blur(10px)'
      }}>
        <div style={{ marginBottom: '15px', fontSize: '0.9rem', lineHeight: '1.4' }}>
          {current.text}
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
            Step {step + 1} of {steps.length}
          </span>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn" style={{ padding: '5px 10px', fontSize: '0.7rem' }} onClick={endTutorial}>
              SKIP
            </button>
            <button className="btn" style={{ padding: '5px 15px', fontSize: '0.75rem', borderColor: 'var(--primary)', color: 'var(--primary)' }} onClick={handleNext}>
              {step === steps.length - 1 ? 'DONE' : 'NEXT'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
