import Search from './pages/Search';
import Dashboard from './pages/Dashboard';
import { DashboardSkeleton } from './components/Skeleton'; // Import Skeleton
import { useAuth } from './contexts/AuthContext';

function App() {
  const { user, loading } = useAuth();

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