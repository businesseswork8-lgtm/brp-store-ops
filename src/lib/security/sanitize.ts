/**
 * Security and sanitization utilities for input validation,
 * XSS prevention, and password strength verification.
 */

// Regex for RFC 5322 compliant email verification
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// Standard UUID regex (v4 or general format)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Strip dangerous HTML tags, control characters, and excess whitespace.
 */
export function sanitizeText(input: unknown, maxLength = 255): string {
  if (typeof input !== 'string') return '';
  
  // Remove ASCII control characters (0x00-0x1F, 0x7F) except normal space
  let clean = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Strip potential HTML/script tags to prevent stored XSS
  clean = clean.replace(/<[^>]*>?/gm, '');

  // Trim and limit length
  clean = clean.trim();
  if (clean.length > maxLength) {
    clean = clean.slice(0, maxLength);
  }

  return clean;
}

/**
 * Validate and normalize email address.
 */
export function validateEmail(email: unknown): { valid: boolean; email: string; error?: string } {
  if (typeof email !== 'string') {
    return { valid: false, email: '', error: 'Email must be a string' };
  }

  const normalized = email.trim().toLowerCase();

  if (normalized.length === 0) {
    return { valid: false, email: '', error: 'Email is required' };
  }

  if (normalized.length > 254) {
    return { valid: false, email: normalized, error: 'Email exceeds maximum length of 254 characters' };
  }

  if (!EMAIL_REGEX.test(normalized)) {
    return { valid: false, email: normalized, error: 'Invalid email address format' };
  }

  return { valid: true, email: normalized };
}

/**
 * Validate whether a string is a valid UUID.
 */
export function isValidUuid(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  return UUID_REGEX.test(id.trim());
}

/**
 * Common trivial passwords to reject immediately.
 */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', '12345678', '123456789', 'qwerty123',
  'admin123', 'welcome1', 'superadmin', 'store123', 'letmein1'
]);

/**
 * Strong password verification:
 * - Minimum 8 characters, maximum 128 characters
 * - Requires at least one letter and one number
 * - Disallows known trivial passwords
 */
export function validatePasswordStrength(password: unknown): { valid: boolean; error?: string } {
  if (typeof password !== 'string') {
    return { valid: false, error: 'Password must be a string' };
  }

  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }

  if (password.length > 128) {
    return { valid: false, error: 'Password cannot exceed 128 characters' };
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { valid: false, error: 'This password is too common and easily guessed' };
  }

  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);

  if (!hasLetter || !hasNumber) {
    return { valid: false, error: 'Password must contain at least one letter and one number' };
  }

  return { valid: true };
}
