import EweLogo from './EweLogo';

const SIZES = {
  sm: 'h-6 w-6',
  md: 'h-10 w-10',
  lg: 'h-14 w-14',
};

/**
 * Brand loading indicator — the EWE logo with a gentle breathing pulse,
 * replacing the generic spinning-ring/pulsing-box treatments used across the
 * app. A full rotation was deliberately avoided (the logo isn't a symmetric
 * mark, so spinning it fast reads as broken rather than "loading") in favour
 * of a slow scale+opacity pulse, which is legible at both inline and
 * full-page sizes.
 */
export default function EweSpinner({ size = 'md', className = '' }) {
  return (
    <EweLogo
      variant="color"
      className={`${SIZES[size] ?? SIZES.md} ewe-spinner-pulse ${className}`}
    />
  );
}
