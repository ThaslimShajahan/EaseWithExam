/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* ── Primary brand (emerald green) ── ONE action color family. */
        primary: {
          50:  '#EFFFFA',
          100: '#D0F1E6',
          200: '#ADE2CF',
          300: '#84CFB5',
          400: '#55BA96',
          500: '#36AC82',
          600: '#21A375',   /* THE action color */
          700: '#1B8660',   /* hover */
          800: '#156A4C',
          900: '#104E38',
        },

        /* ── Semantic status aliases ─────────────────────────── */
        success: {
          DEFAULT: '#10B981',
          light:   '#ECFDF5',
          dark:    '#059669',
          text:    '#065F46',
        },
        warning: {
          DEFAULT: '#F59E0B',
          light:   '#FFFBEB',
          dark:    '#D97706',
          text:    '#78350F',
        },
        danger: {
          DEFAULT: '#EF4444',
          light:   '#FEF2F2',
          dark:    '#DC2626',
          text:    '#7F1D1D',
        },

        /* ── Review state (exam palette only) ─────────────────── */
        review: {
          DEFAULT: '#8B5CF6',
          done:    '#7C3AED',
        },

        /* ── Exam palette states (MockTestEngine) ─────────────── */
        exam: {
          answered:   '#10B981',
          unanswered: '#EF4444',
          review:     '#8B5CF6',
          reviewDone: '#7C3AED',
          notVisited: '#94A3B8',
        },
      },

      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },

      fontSize: {
        /* Token-aligned type scale */
        'display': ['1.875rem', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '800' }],
        'h1':      ['1.5rem',   { lineHeight: '1.25', letterSpacing: '-0.01em', fontWeight: '700' }],
        'h2':      ['1.25rem',  { lineHeight: '1.3',  fontWeight: '700' }],
        'h3':      ['1rem',     { lineHeight: '1.4',  fontWeight: '600' }],
        'body':    ['0.875rem', { lineHeight: '1.6',  fontWeight: '400' }],
        'caption': ['0.75rem',  { lineHeight: '1.4',  fontWeight: '500' }],
        'micro':   ['0.6875rem',{ lineHeight: '1.2',  fontWeight: '600', letterSpacing: '0.02em' }],
      },

      borderRadius: {
        /* Two radii only. */
        'card':    '1rem',     /* rounded-card    — surfaces, panels, modals */
        'control': '0.75rem',  /* rounded-control — buttons, inputs, chips   */
      },

      boxShadow: {
        /* Two elevations only. */
        'card':  '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.06)',
        'float': '0 8px 32px rgba(79,70,229,0.20)',
        /* Legacy aliases kept for backward compat during migration */
        'sidebar': '2px 0 12px rgba(0,0,0,0.08)',
        'header':  '0 1px 0 rgba(0,0,0,0.06)',
      },

      screens: {
        xs: '375px',
      },

      animation: {
        'slide-up':   'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'fade-in':    'fadeIn 0.25s ease-out',
        'sheet-up':   'sheetUp 0.35s cubic-bezier(0.32,0.72,0,1)',
        'xp-fill':    'xpFill 0.6s cubic-bezier(0.34,1.56,0.64,1)',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },

      keyframes: {
        slideUp:    { '0%': { transform: 'translateY(16px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        slideDown:  { '0%': { transform: 'translateY(-16px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        fadeIn:     { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        sheetUp:    { '0%': { transform: 'translateY(100%)' }, '100%': { transform: 'translateY(0)' } },
        xpFill:     { '0%': { transform: 'scaleX(0)', opacity: '0' }, '100%': { transform: 'scaleX(1)', opacity: '1' } },
        pulseSoft:  { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.6' } },
      },
    },
  },
  plugins: [],
};
