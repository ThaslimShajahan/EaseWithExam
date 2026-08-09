/**
 * Curated icon set for onboarding options (student-facing OnboardingPage.jsx
 * and the admin CRUD page that edits onboarding_category_display).
 *
 * Deliberately NOT `import * as LucideIcons from 'lucide-react'` — a
 * wildcard barrel import prevents Vite/Rollup from tree-shaking unused
 * icons, since it can no longer tell which of Lucide's ~1500 icons are
 * actually referenced. Measured effect: the vendor-icons chunk grew from
 * ~63KB to ~738KB (gzip ~12KB → ~129KB) when this was tried. Named imports
 * of a curated set — the same pattern every other icon usage in this app
 * already follows — keeps the bundle to only the icons actually needed,
 * while still letting the icon be *data* (a string name in the DB) rather
 * than code, which is what makes it admin-editable.
 *
 * Extend this list (and the picker in the admin page) as new icons are
 * genuinely needed — it's a deliberate, curated palette, not a limitation
 * to work around.
 */
import {
  Dna, Atom, FlaskConical, Rocket, BookOpen, GraduationCap,
  BookMarked, Sprout, Landmark, ClipboardList, School, Trophy,
  BookOpenCheck, TreePalm, Building2, MinusCircle, RotateCcw,
  Brain, Calculator, Globe, Target, Star, Award, Users, Sparkles,
  Microscope, Compass, Book, HelpCircle,
} from 'lucide-react';

export const ONBOARDING_ICONS = {
  Dna, Atom, FlaskConical, Rocket, BookOpen, GraduationCap,
  BookMarked, Sprout, Landmark, ClipboardList, School, Trophy,
  BookOpenCheck, TreePalm, Building2, MinusCircle, RotateCcw,
  Brain, Calculator, Globe, Target, Star, Award, Users, Sparkles,
  Microscope, Compass, Book, HelpCircle,
};

export function resolveOnboardingIcon(name) {
  return ONBOARDING_ICONS[name] || HelpCircle;
}
