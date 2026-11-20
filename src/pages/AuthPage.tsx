import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TerminalSquare, AlertCircle, CheckCircle2, ArrowLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Input } from '../components/ui/FormFields';
import { Button } from '../components/ui/Button';
import {
  loginWithEmail,
  loginWithGoogle,
  mapAuthError,
  resetPassword,
  signUpWithEmail,
} from '../services/authService';
import { validateDisplayName, validateEmail } from '../utils/validation';

export type AuthMode = 'login' | 'signup' | 'reset';

export function AuthPage({ mode }: { mode: AuthMode }) {
  const { user, authReady } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    if (authReady && user) {
      navigate('/dashboard', { replace: true });
    }
  }, [authReady, user, navigate]);

  useEffect(() => {
    setFieldErrors({});
    setFormError(null);
    setResetSent(false);
  }, [mode]);

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    if (mode === 'signup') {
      const nameErr = validateDisplayName(displayName);
      if (nameErr) errors.displayName = nameErr;
    }

    const emailErr = validateEmail(email);
    if (emailErr) errors.email = emailErr;

    if (mode !== 'reset') {
      if (!password) {
        errors.password = 'Password is required.';
      } else if (mode === 'signup' && password.length < 6) {
        errors.password = 'Password must be at least 6 characters.';
      }
    }

    if (mode === 'signup' && password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      if (mode === 'signup') {
        await signUpWithEmail(displayName, email, password);
        showToast('Welcome to BuildLog! Your workspace is ready.', 'success');
        navigate('/dashboard', { replace: true });
      } else if (mode === 'login') {
        await loginWithEmail(email, password);
        showToast('Signed in to BuildLog.', 'success');
        navigate('/dashboard', { replace: true });
      } else {
        await resetPassword(email);
        setResetSent(true);
        showToast('Password reset email sent.', 'success');
      }
    } catch (err) {
      setFormError(mapAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setFormError(null);
    setGoogleLoading(true);
    try {
      await loginWithGoogle();
      showToast('Signed in with Google.', 'success');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setFormError(mapAuthError(err));
    } finally {
      setGoogleLoading(false);
    }
  };

  const heading =
    mode === 'signup'
      ? 'Create your BuildLog workspace'
      : mode === 'login'
      ? 'Sign in to BuildLog'
      : 'Reset your password';

  const subheading =
    mode === 'signup'
      ? 'Connect your GitHub projects and BuildLog will keep track of the work for you.'
      : mode === 'login'
      ? 'Review automated GitHub activity clusters and resume project memory.'
      : 'Enter your account email and we will send a password reset link.';

  return (
    <div className="relative min-h-screen bg-[#080908] text-[#F3F5EF] flex flex-col justify-center px-4 py-12 overflow-hidden">
      <div
        className="pointer-events-none absolute -top-28 left-1/2 -translate-x-1/2 h-80 w-[520px] rounded-full bg-[#B8F34A]/[0.07] blur-[120px]"
        aria-hidden="true"
      />

      <div className="relative max-w-md w-full mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-base font-display font-bold text-[#FCFFEC]"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[#B8F34A] text-[#090B09]">
              <TerminalSquare className="w-4 h-4" aria-hidden="true" />
            </span>
            <span>BuildLog</span>
          </Link>

          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs text-[#929B90] hover:text-[#FCFFEC] transition-colors whitespace-nowrap"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Back home</span>
          </Link>
        </div>

        <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-6 sm:p-8 shadow-[0_24px_64px_rgba(0,0,0,0.55)]">
          <h1 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#FCFFEC]">
            {heading}
          </h1>
          <p className="mt-1.5 text-sm text-[#929B90]">{subheading}</p>

          {formError && (
            <div
              role="alert"
              className="mt-5 rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-xs text-red-200 flex items-start gap-2.5 leading-relaxed"
            >
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{formError}</span>
            </div>
          )}

          {resetSent && mode === 'reset' && (
            <div
              role="status"
              className="mt-5 rounded-xl border border-[#B8F34A]/40 bg-[#181B18] px-4 py-3 text-xs text-[#F3F5EF] flex items-start gap-2.5 leading-relaxed"
            >
              <CheckCircle2 className="w-4 h-4 text-[#B8F34A] shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                If an account exists for <strong>{email}</strong>, a password reset link has been sent to your inbox.
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
            {mode === 'signup' && (
              <Input
                label="Display Name"
                required
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g., Alex Rivera"
                error={fieldErrors.displayName}
              />
            )}

            <Input
              label="Email Address"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@domain.com"
              error={fieldErrors.email}
            />

            {mode !== 'reset' && (
              <Input
                label="Password"
                type="password"
                required
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'At least 6 characters' : 'Enter your password'}
                error={fieldErrors.password}
              />
            )}

            {mode === 'signup' && (
              <Input
                label="Confirm Password"
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                error={fieldErrors.confirmPassword}
              />
            )}

            {mode === 'login' && (
              <div className="flex justify-end">
                <Link
                  to="/reset-password"
                  className="text-xs text-[#929B90] hover:text-[#B8F34A] transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={submitting}
              className="w-full"
            >
              {mode === 'signup'
                ? 'Create Account'
                : mode === 'login'
                ? 'Sign In'
                : 'Send Reset Link'}
            </Button>
          </form>

          {mode !== 'reset' && (
            <>
              <div className="my-5 flex items-center gap-3 text-xs text-[#929B90]">
                <div className="h-px flex-1 bg-[#252D24]" />
                <span>or</span>
                <div className="h-px flex-1 bg-[#252D24]" />
              </div>

              <Button
                type="button"
                variant="secondary"
                size="lg"
                loading={googleLoading}
                onClick={handleGoogleSignIn}
                className="w-full"
              >
                Continue with Google
              </Button>
            </>
          )}

          <div className="mt-6 pt-5 border-t border-[#252D24] text-center text-xs text-[#929B90]">
            {mode === 'login' ? (
              <span>
                New to BuildLog?{' '}
                <Link to="/signup" className="text-[#B8F34A] font-medium hover:underline">
                  Create an account
                </Link>
              </span>
            ) : mode === 'signup' ? (
              <span>
                Already have an account?{' '}
                <Link to="/login" className="text-[#B8F34A] font-medium hover:underline">
                  Sign in
                </Link>
              </span>
            ) : (
              <span>
                Remembered your password?{' '}
                <Link to="/login" className="text-[#B8F34A] font-medium hover:underline">
                  Back to sign in
                </Link>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
