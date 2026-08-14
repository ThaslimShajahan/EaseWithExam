import { useRef, useState } from 'react';
import { Phone, ArrowRight, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { mapAuthError } from '../../lib/authErrors';
import Button from '../ui/Button';

const COUNTRY_CODES = [
  { code: '+91', label: '🇮🇳 +91', country: 'India' },
  { code: '+1',  label: '🇺🇸 +1',  country: 'USA'   },
  { code: '+44', label: '🇬🇧 +44', country: 'UK'    },
];

export default function PhoneOTP({ onError, onStepChange, onSuccess }) {
  const { sendOTP, verifyOTP } = useAuth();
  const [step,        setStep]        = useState('phone');  // 'phone' | 'otp'
  const [countryCode, setCountryCode] = useState('+91');
  const [phone,       setPhone]       = useState('');
  const [otp,         setOtp]         = useState(['', '', '', '', '', '']);
  const [loading,     setLoading]     = useState(false);
  const [countdown,   setCountdown]   = useState(0);
  const otpRefs = useRef([]);

  const startCountdown = () => {
    setCountdown(30);
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(interval); return 0; }
        return c - 1;
      });
    }, 1000);
  };

  const handleSendOTP = async () => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length < 10) {
      onError?.('Enter a valid 10-digit mobile number.');
      return;
    }
    setLoading(true);
    try {
      await sendOTP(`${countryCode}${cleaned}`);
      setStep('otp');
      onStepChange?.(true);
      startCountdown();
    } catch (err) {
      const msg = mapAuthError(err);
      if (msg) onError?.(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (value, idx) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...otp];
    next[idx] = value.slice(-1);
    setOtp(next);
    if (value && idx < 5) otpRefs.current[idx + 1]?.focus();
  };

  const handleOtpKey = (e, idx) => {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) {
      otpRefs.current[idx - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    const code = otp.join('');
    if (code.length < 6) { onError?.('Enter the 6-digit OTP.'); return; }
    setLoading(true);
    try {
      await verifyOTP(code);
      onSuccess?.();
    } catch (err) {
      const msg = mapAuthError(err);
      if (msg) onError?.(msg);
      setOtp(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  if (step === 'otp') {
    return (
      <div className="space-y-5 animate-slide-up">
        <div className="text-center">
          <CheckCircle2 size={36} className="mx-auto text-primary-600 mb-2" />
          <p className="text-sm text-slate-600">
            OTP sent to <span className="font-semibold text-slate-800">{countryCode} {phone}</span>
          </p>
        </div>

        {/* 6-digit OTP input */}
        <div className="flex justify-center gap-2">
          {otp.map((digit, i) => (
            <input
              key={i}
              ref={(el) => (otpRefs.current[i] = el)}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleOtpChange(e.target.value, i)}
              onKeyDown={(e) => handleOtpKey(e, i)}
              className="w-11 h-13 text-center text-xl font-bold border-2 border-slate-200
                         rounded-xl focus:border-primary-500 focus:ring-2 focus:ring-primary-100
                         outline-none transition-all"
            />
          ))}
        </div>

        <Button variant="primary" size="lg" full loading={loading} onClick={handleVerify}>
          Verify OTP
        </Button>

        <div className="text-center">
          {countdown > 0 ? (
            <p className="text-sm text-slate-400">Resend in {countdown}s</p>
          ) : (
            <button
              onClick={() => { setOtp(['', '', '', '', '', '']); setStep('phone'); onStepChange?.(false); }}
              className="text-sm text-primary-600 font-medium flex items-center gap-1 mx-auto hover:underline"
            >
              <RefreshCw size={13} /> Change number
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-slide-up">
      <div className="flex gap-2">
        {/* Country code picker */}
        <select
          value={countryCode}
          onChange={(e) => setCountryCode(e.target.value)}
          className="h-12 px-2 rounded-xl border-2 border-slate-200 bg-white text-sm
                     font-medium focus:border-primary-500 focus:ring-2 focus:ring-primary-100
                     outline-none transition-all cursor-pointer"
        >
          {COUNTRY_CODES.map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>

        {/* Phone number input */}
        <div className="relative flex-1">
          <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="tel"
            inputMode="numeric"
            placeholder="Mobile number"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
            onKeyDown={(e) => e.key === 'Enter' && handleSendOTP()}
            className="w-full h-12 pl-9 pr-4 rounded-xl border-2 border-slate-200
                       focus:border-primary-500 focus:ring-2 focus:ring-primary-100
                       outline-none transition-all text-sm"
          />
        </div>
      </div>

      <Button
        variant="primary"
        size="lg"
        full
        loading={loading}
        onClick={handleSendOTP}
        iconRight={<ArrowRight size={16} />}
      >
        Send OTP
      </Button>

      <p className="text-xs text-center text-slate-400">
        By continuing, you agree to our{' '}
        <a href="/privacy/" className="text-primary-600 hover:underline font-medium">Terms &amp; Privacy Policy</a>.
      </p>

      {/* Invisible reCAPTCHA anchor required by Firebase's signInWithPhoneNumber */}
      <div id="recaptcha-container" />
    </div>
  );
}
