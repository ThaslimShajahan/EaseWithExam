import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import { loadCategories } from './lib/categories';
import { loadOnboardingOptions } from './lib/onboardingOptions';
import { loadPaperTemplateOverrides } from './lib/examPattern';
import { captureReferralFromUrl } from './lib/referral';
import App from './App';
import './styles/index.css';

// A referral link (`/?ref=EWEXXXXXX`) lands before the account exists, so the
// code is parked now and redeemed once onboarding creates the user. Runs before
// render so the param is stripped from the URL the student actually sees.
captureReferralFromUrl();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:            2 * 60 * 1000, // 2 min — data fresh for 2 min without refetch
      gcTime:               5 * 60 * 1000, // 5 min — keep in cache after unmount
      retry:                1,
      refetchOnWindowFocus: false,
    },
  },
});

function renderApp() {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

// Warm the admin-editable board/class/subject catalog before first render so
// every page sees live data immediately, not just after a second load — but
// cap it so a slow/failed fetch never blocks the app beyond ~1.5s (falls back
// to the hardcoded defaults already baked into categories.js).
const timeout = new Promise((resolve) => setTimeout(resolve, 1500));
Promise.race([
  Promise.all([loadCategories(), loadOnboardingOptions(), loadPaperTemplateOverrides()]).catch(() => {}),
  timeout,
]).then(renderApp);
