import { useIsDesktop } from '../../hooks/useMediaQuery';
import Sidebar from './Sidebar';
import TopHeader from './TopHeader';
import BottomNav from './BottomNav';
import NotificationToast from '../ui/NotificationToast';

export default function AppShell({ children }) {
  const isDesktop = useIsDesktop();

  if (isDesktop) {
    return (
      <div className="flex h-screen bg-slate-50 overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <TopHeader />
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-[1200px] mx-auto px-6 py-6">
              {children}
            </div>
          </main>
        </div>
        <NotificationToast />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <TopHeader mobile />
      <main className="flex-1 overflow-y-auto" style={{ paddingBottom: 'calc(65px + env(safe-area-inset-bottom))' }}>
        {children}
      </main>
      <BottomNav />
      <NotificationToast />
    </div>
  );
}
