import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import { loadCategories } from './lib/categories';
import App from './App';
import './styles/index.css';

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
Promise.race([loadCategories().catch(() => {}), timeout]).then(renderApp);
