import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Dashboard from '../components/dashboard/Dashboard';

const PENDING_KEY       = 'edu_pending_invite';
const PENDING_STAFF_KEY = 'edu_pending_staff_invite';

export default function DashboardPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const code = localStorage.getItem(PENDING_KEY);
    if (code) {
      localStorage.removeItem(PENDING_KEY);
      navigate(`/join/${code}`, { replace: true });
      return;
    }
    const staffCode = localStorage.getItem(PENDING_STAFF_KEY);
    if (staffCode) {
      localStorage.removeItem(PENDING_STAFF_KEY);
      navigate(`/coaching-invite/${staffCode}`, { replace: true });
    }
  }, [navigate]);

  return <Dashboard />;
}
