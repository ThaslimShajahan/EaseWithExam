import eweLogo from '../../assets/ewe-logo.svg';
import { usePlatformSettings } from '../../hooks/usePlatformSettings';

/**
 * EWE brand logo.
 * variant="light"  → white version for dark backgrounds (sidebar, dark panels)
 * variant="color"  → original teal/dark version for light backgrounds (auth, pricing)
 *
 * If an admin has uploaded a custom logo (Admin > Platform Settings), it's shown
 * as-is — the light/dark recolor filter only applies to our own default SVG asset,
 * since we can't safely force-invert an arbitrary uploaded image's colors.
 */
export default function EweLogo({ variant = 'color', className = '', style = {} }) {
  const { platform_logo_url, platform_name } = usePlatformSettings();
  const customLogo = !!platform_logo_url;

  const filter =
    !customLogo && variant === 'light'
      ? 'brightness(0) invert(1)'
      : 'none';

  return (
    <img
      src={platform_logo_url || eweLogo}
      alt={platform_name}
      className={className}
      style={{ filter, ...style }}
    />
  );
}
