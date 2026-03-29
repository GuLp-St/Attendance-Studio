import React from 'react';

// Single Skeleton Element
export default function Skeleton({ type = "block" }) {
  
  if (type === "session-row") {
    return (
      <div className="session-row">
        <div className="session-left" style={{width:'100%'}}>
          <div className="sk-row" style={{height:'20px', width:'60%', marginBottom:'5px', border:'none'}}>
             <div className="sk-shimmer"></div>
          </div>
          <div className="sk-row" style={{height:'15px', width:'40%', border:'none'}}>
             <div className="sk-shimmer"></div>
          </div>
        </div>
        <div className="session-right">
           <div className="sk-btn" style={{width:'60px', height:'30px', borderRadius:'4px', marginBottom:0}}><div className="sk-shimmer"></div></div>
        </div>
      </div>
    );
  }

  if (type === "course-card") {
    return (
      <div className="time-slot" style={{ 
          border: '1px solid var(--grid-line)', 
          background: 'rgba(255, 255, 255, 0.02)', 
          borderLeft: '2px solid var(--grid-line)',
          padding: '8px 10px', borderRadius: '4px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px',
          pointerEvents: 'none', position: 'relative', overflow: 'hidden'
      }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center', width: '40px' }}>
                  <div className="sk-line" style={{ width: '100%', height: '10px', margin: 0 }}></div>
                  <div className="sk-line" style={{ width: '80%', height: '10px', margin: 0 }}></div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                  <div className="sk-line" style={{ width: '60%', height: '14px', margin: 0 }}></div>
                  <div className="sk-line" style={{ width: '40%', height: '10px', margin: 0 }}></div>
              </div>
          </div>
          <div className="sk-line" style={{ width: '40px', height: '20px', borderRadius: '4px', margin: 0 }}></div>
          <div className="sk-shimmer"></div>
      </div>
    );
  }

  if (type === "profile") {
      return (
          <div style={{padding:'10px'}}>
              <div style={{display:'flex', flexDirection:'column', alignItems:'center', marginBottom:'20px'}}>
                  <div className="sk-circle" style={{width:'100px', height:'100px', marginBottom:'10px', borderRadius:'50%'}}>
                      <div className="sk-shimmer"></div>
                  </div>
                  <div className="sk-line sk-w50" style={{height:'20px', marginBottom:'5px'}}></div>
                  <div className="sk-line sk-w30"></div>
              </div>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'15px'}}>
                  <div className="sk-row" style={{height:'50px', gridColumn:'span 2'}}><div className="sk-shimmer"></div></div>
                  <div className="sk-row" style={{height:'50px', gridColumn:'span 2'}}><div className="sk-shimmer"></div></div>
                  <div className="sk-row" style={{height:'50px'}}><div className="sk-shimmer"></div></div>
                  <div className="sk-row" style={{height:'50px'}}><div className="sk-shimmer"></div></div>
              </div>
          </div>
      );
  }

  // Default block
  return (
    <div className="sk-btn">
      <div className="sk-shimmer"></div>
    </div>
  );
}

// --- NEW: Full Page Dashboard Skeleton ---
export function DashboardSkeleton() {
    return (
        <div style={{ display: 'block' }}>
            {/* Header */}
            <div className="nav-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <div className="sk-circle" style={{width:'50px', height:'50px'}}>
                        <div className="sk-shimmer"></div>
                    </div>
                    <div>
                        <div className="sk-line" style={{width:'120px', height:'18px', marginBottom:'5px'}}>
                            <div className="sk-shimmer"></div>
                        </div>
                        <div className="sk-line" style={{width:'60px', height:'12px'}}>
                            <div className="sk-shimmer"></div>
                        </div>
                    </div>
                </div>
                <div className="header-actions">
                    <div className="sk-btn" style={{width:'80px', height:'30px', marginBottom:0}}>
                        <div className="sk-shimmer"></div>
                    </div>
                </div>
            </div>

            {/* Tabs - Now 5 tabs in a row */}
            <div style={{ display: 'flex', gap: '4px', marginTop: '20px', marginBottom: '15px' }}>
                {[1,2,3,4,5].map(i => (
                    <div key={i} className="sk-btn" style={{flex:1, height:'34px', marginBottom:0, borderRadius: '4px'}}>
                        <div className="sk-shimmer"></div>
                    </div>
                ))}
            </div>

            {/* Day Header */}
            <div className="sk-line sk-w20" style={{height:'15px', marginBottom:'15px', marginTop: '10px'}}></div>

            {/* Grid */}
            <div className="timetable-grid" style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(4px, 1vh, 10px)', marginTop: '5px', padding: '0 10px 40px 45px' }}>
                {[1,2,3,4].map(i => (
                    <Skeleton key={i} type="course-card" />
                ))}
            </div>
        </div>
    );
}