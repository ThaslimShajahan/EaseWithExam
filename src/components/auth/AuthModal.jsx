import Modal from '../ui/Modal';
import AuthCard from './AuthCard';

/**
 * Sign-in as a modal — used by the landing page's "Sign In / Sign Up" CTAs
 * instead of navigating to a separate page, so a visitor never loses the
 * marketing context they clicked in from.
 */
export default function AuthModal({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} size="sm">
      <AuthCard />
    </Modal>
  );
}
