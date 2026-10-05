'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import styles from './reset-password.module.css';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [mode, setMode] = useState<'checking' | 'request' | 'update'>('checking');
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Work out whether we arrived from a reset email, whatever link format Supabase used
  useEffect(() => {
    const run = async () => {
      const q = new URLSearchParams(window.location.search);
      const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const linkError = q.get('error_description') || h.get('error_description');
      const code = q.get('code');
      const tokenHash = q.get('token_hash');
      const fromLink = Boolean(code || tokenHash || h.get('access_token'));
      // Remove the one-time code from the address bar
      if (fromLink || linkError) window.history.replaceState(null, '', window.location.pathname);

      if (linkError) {
        setError('This reset link has expired or was already used. Ask for a new one below.');
        setMode('request');
        return;
      }

      // 1. Link with token_hash (works on any phone or computer)
      if (tokenHash) {
        const { error: e } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
        if (e) { setError('This reset link has expired or was already used. Ask for a new one below.'); setMode('request'); }
        else setMode('update');
        return;
      }

      // 2. Other formats: Supabase signs in from the link while loading, so check for a session
      const { data: { session } } = await supabase.auth.getSession();
      if (fromLink && session) { setMode('update'); return; }

      if (code) {
        const { error: e } = await supabase.auth.exchangeCodeForSession(code);
        if (!e) { setMode('update'); return; }
        setError('This link only works in the same browser where you asked for it, and only once. Ask for a new link here, or ask the Super Admin to set a new password for you.');
      }
      setMode('request');
    };
    run();
  }, [supabase]);

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (resetError) {
      setError(/rate limit/i.test(resetError.message)
        ? 'Too many reset emails were sent. Wait an hour, or ask the Super Admin to set a new password for you.'
        : resetError.message);
      return;
    }
    // Same message whether or not the email exists (doesn't reveal who has an account)
    setSuccess('If this email has a login, a reset link is on its way. Check spam too. No email? Ask the Super Admin to set a new password from Staff & Logins.');
    setEmail('');
  };

  const handleUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (newPassword.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) {
      setLoading(false);
      setError(/session/i.test(updateError.message)
        ? 'Your reset link has expired. Ask for a new one.'
        : updateError.message);
      if (/session/i.test(updateError.message)) setMode('request');
      return;
    }
    await supabase.auth.signOut();
    setSuccess('Password changed. Taking you to login…');
    setTimeout(() => router.push('/login'), 1500);
  };

  return (
    <div className={styles.authContainer}>
      <div className={styles.authCard}>
        <div className={styles.header}>
          <h1 className={styles.logo}>BRP</h1>
          <p className={styles.subtitle}>
            {mode === 'update' ? 'Set New Password' : 'Reset Password'}
          </p>
        </div>

        {error && <div className={styles.error}>{error}</div>}
        {success && <div className={styles.success}>{success}</div>}

        {mode === 'checking' ? (
          <p className={styles.subtitle} style={{ textAlign: 'center' }}>Checking your link…</p>
        ) : mode === 'request' ? (
          <form onSubmit={handleRequestSubmit} className={styles.form}>
            <div className={styles.formGroup}>
              <label htmlFor="email" className={styles.label}>Email</label>
              <input
                id="email"
                type="email"
                required
                className={styles.input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                disabled={loading}
              />
            </div>

            <button 
              type="submit" 
              className={styles.submitBtn}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className={styles.spinner}></span>
                  Sending...
                </>
              ) : (
                'Send Reset Link'
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleUpdateSubmit} className={styles.form}>
            <div className={styles.formGroup}>
              <label htmlFor="newPassword" className={styles.label}>New Password</label>
              <input
                id="newPassword"
                type="password"
                required
                className={styles.input}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                disabled={loading}
                minLength={6}
              />
            </div>
            
            <div className={styles.formGroup}>
              <label htmlFor="confirmPassword" className={styles.label}>Confirm Password</label>
              <input
                id="confirmPassword"
                type="password"
                required
                className={styles.input}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                disabled={loading}
                minLength={6}
              />
            </div>

            <button 
              type="submit" 
              className={styles.submitBtn}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className={styles.spinner}></span>
                  Updating...
                </>
              ) : (
                'Update Password'
              )}
            </button>
          </form>
        )}

        <Link href="/login" className={styles.backLink}>
          Back to Login
        </Link>
      </div>
    </div>
  );
}
