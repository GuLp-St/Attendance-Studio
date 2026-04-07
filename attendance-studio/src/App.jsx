// --- START OF FILE App.jsx ---

import { useEffect, useState } from 'react';
import Search from './pages/Search';
import Dashboard from './pages/Dashboard';
import { DashboardSkeleton } from './components/Skeleton';
import SplashScreen from './components/SplashScreen';
import { useAuth } from './contexts/AuthContext';
import { getDirectory } from './services/api';

function App() {
  const { user, loading } = useAuth();
  const [showSplash, setShowSplash] = useState(true);

  // Fire background download immediately when site opens
  useEffect(() => {
    getDirectory().catch(()=>{});
  }, []);

  return (
    <>
      {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
      <div className="container" style={{ display: showSplash ? 'none' : 'flex' }}>
        {loading ? (
          <DashboardSkeleton />
        ) : (
          !user ? <Search /> : <Dashboard />
        )}
      </div>
    </>
  );
}

export default App;