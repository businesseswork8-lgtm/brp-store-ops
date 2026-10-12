'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import styles from './login.module.css';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        throw authError;
      }

      if (authData.user) {
        // Fetch user profile to get role
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('role, is_active')
          .eq('id', authData.user.id)
          .single();

        if (profileError && profileError.code !== 'PGRST116') {
          console.error('Error fetching profile:', profileError);
          // Fallback to store if error
          router.push('/store');
          return;
        }

        if (profileData && profileData.is_active === false) {
          await supabase.auth.signOut();
          throw new Error('banned');
        }

        const role = profileData?.role;

        switch (role) {
          case 'super_admin':
            router.push('/super-admin');
            break;
          case 'admin':
            router.push('/super-admin');
            break;
          case 'store':
          default:
            router.push('/store');
            break;
        }
      }
    } catch (err: any) {
      const msg = String(err?.message || '');
      setError(
        /banned/i.test(msg) ? 'Your login has been turned off. Please contact your manager.'
        : /invalid login credentials/i.test(msg) ? 'Wrong email or password.'
        : msg || 'Could not sign in. Please try again.'
      );
      setLoading(false);
    }
  };

  return (
    <div className={styles.authContainer}>
      <div className={styles.authCard}>
        <div className={styles.header}>
          <h1 className={styles.logo}>BRP</h1>
          <p className={styles.subtitle}>Store Operations</p>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit} className={styles.form}>
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

          <div className={styles.formGroup}>
            <label htmlFor="password" className={styles.label}>Password</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                className={styles.input}
                style={{ width: '100%', paddingRight: '2.5rem' }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '0.75rem',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '1.1rem',
                  lineHeight: 1,
                  padding: '0.2rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? '👁️' : '🙈'}
              </button>
            </div>
          </div>

          <Link href="/reset-password" className={styles.forgotPassword}>
            Forgot password?
          </Link>

          <button 
            type="submit" 
            className={styles.submitBtn}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className={styles.spinner}></span>
                Signing in...
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
