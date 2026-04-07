import React, { useState, useEffect, useRef } from 'react';

export default function Onboarding() {
  const [stepIndex, setStepIndex] = useState(0);
  const [show, setShow] = useState(false);
  const [targetRect, setTargetRect] = useState(null);
  const [windowSize, setWindowSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  // Add a listener to resize
  useEffect(() => {
    const handleResize = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const endTutorial = () => {
    localStorage.setItem('atd_tutorial_done', 'true');
    setShow(false);
  };

  useEffect(() => {
    const isDone = localStorage.getItem('atd_tutorial_done') === 'true';
    if (!isDone) setTimeout(() => setShow(true), 2000);
  }, []);

  // Complex sequence of steps matching specific user instructions
  const steps = [
    // --- CLASSES TAB (Step 0 - 2) ---
    {
      actionType: 'info',
      title: 'TIMETABLE & CLASSES',
      text: 'The line traversing the screen indicates the current time. Note that it will highlight any UPCOMING and ONGOING classes.',
      targetSelector: '.timetable-grid',
      position: 'center'
    },
    {
      actionType: 'click', // Waits for click on target
      title: 'INTERACT WITH A CLASS',
      text: 'Click on one of the class rows below to open its management view.',
      targetSelector: '.time-slot',
      position: 'bottom'
    },
    {
      actionType: 'info',
      title: 'CLASS MANAGEMENT',
      text: 'This is where you can manually SCAN, EXEMPT, or DELETE your attendance. Note that manual scanning is only available within the class time range. You can also quickly toggle AUTOSCAN here.',
      targetSelector: null, // Full screen overlay
      position: 'center'
    },
    
    // --- ACTIVITIES TAB (Step 3 - 4) ---
    {
      actionType: 'click',
      title: 'SWITCH TO ACTIVITIES',
      text: 'Now, let\'s look at Activities. Click the ACTIVITIES tab button.',
      targetSelector: 'button.btn[style*="--accent"]', // Approximate match for Activities tab
      position: 'bottom'
    },
    {
      actionType: 'info',
      title: 'ACTIVITIES HUB',
      text: 'This is where you can add unregistered activities such as labs, events, or tutorials. Once added, it will function just like a regular class—you can manage attendance and even enable AUTOSCAN.',
      targetSelector: null,
      position: 'center'
    },

    // --- COURSEHUB (Step 5 - 7) ---
    {
      actionType: 'click',
      title: 'SWITCH TO COURSEHUB',
      text: 'Click the COURSEHUB tab button.',
      targetSelector: 'button.btn[style*="#0f0"]', // Coursehub tab
      position: 'bottom'
    },
    {
      actionType: 'info',
      title: 'COURSE EXPLORATION',
      text: 'The first thing you see are your registered courses. You can use the search bar to find other courses to add, or even search for people to see what courses they are taking!',
      targetSelector: null,
      position: 'center'
    },
    {
      actionType: 'click',
      title: 'COURSE DETAILS',
      text: 'Click on one of your registered courses below to explore its details.',
      targetSelector: '.master-row',
      position: 'bottom'
    },
    {
      actionType: 'info',
      title: 'DETAILS & LOGS',
      text: 'Here you can drop or register yourself, and activate AUTO REGISTER. "Session Logs" lets you manage attendance of every student for past sessions, and "View Enrolled Students" allows you to manage enrollments individually.',
      targetSelector: null,
      position: 'center'
    },

    // --- SCHEDULER & SETTINGS (Step 9 - 13) ---
    {
      actionType: 'click',
      title: 'SWITCH TO SCHEDULER',
      text: 'Click the SCHEDULER tab button to access Master Controls.',
      targetSelector: 'button.btn[style*="#f0f"]', // Scheduler tab
      position: 'bottom'
    },
    {
      actionType: 'info',
      title: 'MASTER CONTROLS',
      text: 'This is the master control area! Active AUTOREGISTER and AUTOSCAN jobs will be reflected here. Autoscan has two triggers:\n- L. MINUTE: Scans during the last section of class.\n- CROWD: Scans when 5+ people are present.\nIt also has two types:\n- ONE TIME: Only scans the very next session.\n- PERMANENT: Runs forever.',
      targetSelector: null,
      position: 'center'
    },
    {
      actionType: 'info',
      title: 'NOTIFICATIONS',
      text: 'The Settings panel lets you enable logic for push notifications. Make sure to "ADD TO HOME PAGE" if you haven\'t yet to utilize push notifications fully!',
      targetSelector: null,
      position: 'center'
    },
    
    // --- DIRECTORY (Step 14 ) ---
    {
      actionType: 'click',
      title: 'SWITCH TO DIRECTORY',
      text: 'Finally, click the DIRECTORY tab button to access the student database.',
      targetSelector: 'button.btn[style*="#ff6"]', // Directory tab
      position: 'bottom'
    },
    {
      actionType: 'info',
      title: 'STUDENT DIRECTORY',
      text: 'Search all students in the database.\n"UNVER" (Unverified) means the account doesn\'t have a valid password—you can try to validate it or just view their biodata. "Verified" accounts show much more information. Use the advanced sorting and filtering to find anyone!',
      targetSelector: null,
      position: 'center'
    }
  ];

  const currentStep = steps[stepIndex];

  // Element tracking
  useEffect(() => {
    if (!show || !currentStep) return;
    
    let observer;
    let fallbackInterval;

    const findAndSetTarget = () => {
      if (currentStep.targetSelector) {
        const el = document.querySelector(currentStep.targetSelector);
        if (el) {
          const rect = el.getBoundingClientRect();
          setTargetRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
          
          // If the step is waiting for a click, temporarily add a listener to advance
          if (currentStep.actionType === 'click') {
             const advance = () => {
                 el.removeEventListener('click', advance);
                 setTimeout(() => handleNext(), 300); // Wait a bit for UI to settle
             };
             el.addEventListener('click', advance);
             // Ensure we clean up if component unmounts or step changes
             return () => el.removeEventListener('click', advance);
          }
        } else {
          setTargetRect(null);
        }
      } else {
        setTargetRect(null); // Full screen
      }
    };

    findAndSetTarget();

    // Use MutationObserver to catch DOM changes if element isn't found or moves
    observer = new MutationObserver(findAndSetTarget);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    
    // Fallback interval for animations
    fallbackInterval = setInterval(findAndSetTarget, 500);

    return () => {
      if (observer) observer.disconnect();
      if (fallbackInterval) clearInterval(fallbackInterval);
    };
  }, [stepIndex, show]);

  const handleNext = () => {
    if (stepIndex < steps.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      endTutorial();
    }
  };

  if (!show || !currentStep) return null;

  // Render Spotlight Masks
  const maskBg = 'rgba(0, 0, 0, 0.85)';
  const renderMasks = () => {
    if (!targetRect) return <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: maskBg, zIndex: 9998, pointerEvents: 'none', transition: 'background 0.5s' }} />;
    
    return (
      <div style={{ pointerEvents: 'none', zIndex: 9998 }}>
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: targetRect.top, background: maskBg, transition: 'all 0.3s' }} />
        <div style={{ position: 'fixed', top: targetRect.top, left: 0, width: targetRect.left, height: targetRect.height, background: maskBg, transition: 'all 0.3s' }} />
        <div style={{ position: 'fixed', top: targetRect.top, left: targetRect.left + targetRect.width, right: 0, height: targetRect.height, background: maskBg, transition: 'all 0.3s' }} />
        <div style={{ position: 'fixed', top: targetRect.top + targetRect.height, left: 0, width: '100%', bottom: 0, background: maskBg, transition: 'all 0.3s' }} />
        
        {/* Glow around the hole */}
        <div style={{
          position: 'fixed', top: targetRect.top, left: targetRect.left, width: targetRect.width, height: targetRect.height,
          boxShadow: '0 0 20px rgba(0, 243, 255, 0.8), inset 0 0 10px rgba(0, 243, 255, 0.4)', border: '2px dashed var(--primary)', borderRadius: '4px',
          transition: 'all 0.3s', pointerEvents: 'none'
        }} />
      </div>
    );
  };

  // Determine tooltip placement logic
  const getTooltipStyle = () => {
    const base = {
      position: 'fixed', zIndex: 9999, background: 'rgba(5, 10, 15, 0.95)', border: '1px solid var(--primary)', 
      boxShadow: '0 0 20px var(--primary-dim)', padding: '20px', borderRadius: '8px', 
      width: '90%', maxWidth: '350px', color: '#fff', backdropFilter: 'blur(10px)', transition: 'all 0.3s ease'
    };
    
    if (!targetRect || currentStep.position === 'center') {
      return { ...base, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }

    if (currentStep.position === 'bottom') {
      const topPos = targetRect.top + targetRect.height + 20;
      // If it flows off screen, flip it
      if (topPos + 200 > windowSize.h) {
          return { ...base, bottom: windowSize.h - targetRect.top + 20, left: '50%', transform: 'translateX(-50%)' };
      }
      return { ...base, top: topPos, left: '50%', transform: 'translateX(-50%)' };
    }
    
    return { ...base, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  };

  return (
    <>
      {renderMasks()}

      <div className="onboarding-tooltip" style={getTooltipStyle()}>
        <h3 style={{ color: 'var(--primary)', marginTop: 0, marginBottom: '10px', fontSize: '1rem', letterSpacing: '1px' }}>
          {currentStep.title}
        </h3>
        <div style={{ marginBottom: '20px', fontSize: '0.85rem', lineHeight: '1.5', color: '#e0faff', whiteSpace: 'pre-line' }}>
          {currentStep.text}
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
            {stepIndex + 1} / {steps.length}
          </span>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn" style={{ padding: '6px 12px', fontSize: '0.7rem' }} onClick={endTutorial}>
              SKIP ALL
            </button>
            {currentStep.actionType === 'info' && (
              <button className="btn" style={{ padding: '6px 20px', fontSize: '0.75rem', borderColor: 'var(--primary)', color: 'var(--primary)', fontWeight: 'bold' }} onClick={handleNext}>
                {stepIndex === steps.length - 1 ? 'FINISH' : 'NEXT'}
              </button>
            )}
            {currentStep.actionType === 'click' && (
              <div style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 'bold', animation: 'pulse 1s infinite', alignSelf: 'center', padding: '0 10px' }}>
                CLICK TARGET...
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
