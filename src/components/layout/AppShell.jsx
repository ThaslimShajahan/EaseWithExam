import { useIsDesktop } from '../../hooks/useMediaQuery';
import Sidebar from './Sidebar';
import TopHeader from './TopHeader';
import BottomNav from './BottomNav';
import NotificationToast from '../ui/NotificationToast';
import { NotificationsProvider } from '../../context/NotificationsContext';

function AppShellLayout({ children }) {
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

  // `h-dvh` (not `min-h-screen`) + `overflow-hidden` is deliberate — it's what
  // makes `<main>` an actually-bounded scroll container instead of an inert
  // `overflow-y-auto` that never triggers because its `min-h-screen` ancestor
  // just grows to fit content (confirmed live: main.scrollHeight ===
  // main.clientHeight on mobile before this fix, meaning the WINDOW was
  // scrolling instead). That's what let content get cut off/overlap sticky
  // per-page headers below TopHeader — those stick relative to whatever
  // ancestor actually scrolls, which was silently the window, not `<main>`.
  // `dvh` over `vh` additionally avoids the classic mobile-Safari bug where
  // `100vh` is sized to the browser chrome's collapsed state, taller than
  // the viewport actually visible on load.
  return (
    <div className="flex flex-col h-dvh bg-slate-50 overflow-hidden">
      <TopHeader mobile />
      <main className="flex-1 overflow-y-auto" style={{ paddingBottom: 'calc(65px + env(safe-area-inset-bottom))' }}>
        {children}
      </main>
      <BottomNav />
      <NotificationToast />
    </div>
  );
}

export default function AppShell({ children }) {
  // Desktop mounts Sidebar and TopHeader together, both of which render a
  // NotificationBell — a single shared subscription here, provided once above
  // both, is what keeps that from becoming two competing realtime channels.
  return (
    <NotificationsProvider>
      <AppShellLayout>{children}</AppShellLayout>
    </NotificationsProvider>
  );
}
