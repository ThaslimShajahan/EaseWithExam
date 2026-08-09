/* EWE's avatar wherever it "speaks" — chat bubbles, the Doubt Studio intro
   card, and the chat header chip. Was a custom-drawn mascot character; now
   the actual brand logo, per the same asset EweLogo/EweSpinner use, so the
   AI persona and the app's own identity are visually the same thing. */
import EweLogo from './EweLogo';
import { usePlatformSettings } from '../../hooks/usePlatformSettings';

/**
 * Admin-overridable via Platform > Settings ("EWE avatar"). When
 * `ewe_avatar_url` is set it replaces the brand logo everywhere EWE speaks —
 * chat bubbles, the Doubt Studio intro card and the header chip — so the
 * persona can be given a face without a code change. Falls back to the logo
 * whenever unset or the image fails to load.
 */
function VedaBadge({ size = 32 }) {
  // usePlatformSettings returns the settings FLAT (`{ ...settings, loaded }`),
  // not wrapped in a `settings` key. Destructuring `{ settings }` here yielded
  // undefined on every render, so an admin-uploaded avatar was silently ignored
  // and this always fell back to the logo. Every other consumer (EweLogo,
  // AuthCard, PlatformChrome) already reads it flat.
  const { ewe_avatar_url: url } = usePlatformSettings();

  return (
    <div
      className="rounded-full bg-gradient-to-br from-primary-50 to-violet-50 border border-primary-100 flex items-center justify-center shrink-0 overflow-hidden"
      style={{ width: size, height: size }}
    >
      {url ? (
        <img
          src={url}
          alt="EWE"
          className="h-full w-full object-cover"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      ) : (
        <EweLogo variant="color" style={{ width: size * 0.62, height: size * 0.62 }} />
      )}
    </div>
  );
}

export function VedaAvatarSm() {
  return <VedaBadge size={32} />;
}

export function VedaAvatarLg() {
  return <VedaBadge size={72} />;
}

/* Inline chip shown in headers: "EWE · Your study companion" */
export function VedaChip() {
  return (
    <div className="flex items-center gap-2">
      <VedaBadge size={28} />
      <div>
        <p className="text-sm font-semibold text-slate-900 leading-none">EWE</p>
        <p className="text-[10px] text-slate-400 leading-none mt-0.5">Your study companion</p>
      </div>
    </div>
  );
}

export default VedaBadge;
