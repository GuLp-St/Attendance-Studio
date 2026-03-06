// --- START OF FILE App.jsx ---

import { useEffect } from 'react'; // <--- This was the missing import!
import Search from './pages/Search';
import Dashboard from './pages/Dashboard';
import { DashboardSkeleton } from './components/Skeleton';
import { useAuth } from './contexts/AuthContext';
import { getDirectory } from './services/api';

function App() {
  const { user, loading } = useAuth();

  // Fire background download immediately when site opens
  useEffect(() => {
    getDirectory().catch(()=>{});
  }, []);

  return (
    <div className="container">
      {loading ? (
        <DashboardSkeleton />
      ) : (
        !user ? <Search /> : <Dashboard />
      )}
    </div>
  );
}

export default App;