import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sanitizeText, validateEmail, isValidUuid, validatePasswordStrength } from '@/lib/security/sanitize'
import { rateLimit, getClientIp, getRateLimitHeaders } from '@/lib/security/rate-limit'
import { isAllowedOrigin, getCorsHeaders, handleCorsPreflight } from '@/lib/security/cors'

type Role = 'store' | 'admin' | 'super_admin'
const ROLES: Role[] = ['store', 'admin', 'super_admin']

/**
 * Handle OPTIONS preflight requests
 */
export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request)
}

/** Only an active super admin may manage logins. */
async function requireSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role, is_active').eq('id', user.id).single()
  return profile?.role === 'super_admin' && profile.is_active ? user : null
}

/** Create a login. Body: { email, password, full_name, role, store_access, can_edit } */
export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request)

  // CSRF Origin verification
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden: Request origin not allowed.' }, { status: 403, headers: corsHeaders })
  }

  // Rate limiting (15 requests per 60 seconds per IP)
  const clientIp = getClientIp(request.headers)
  const rl = rateLimit(`admin-users-create:${clientIp}`, { limit: 15, windowSeconds: 60 })
  const responseHeaders = { ...corsHeaders, ...getRateLimitHeaders(rl) }

  if (!rl.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment before trying again.' },
      { status: 429, headers: responseHeaders }
    )
  }

  const superAdmin = await requireSuperAdmin()
  if (!superAdmin) {
    return NextResponse.json({ error: 'Unauthorized: Only a Super Admin can create logins.' }, { status: 403, headers: responseHeaders })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400, headers: responseHeaders })
  }

  // Sanitize and validate inputs
  const emailValidation = validateEmail(body.email)
  if (!emailValidation.valid) {
    return NextResponse.json({ error: emailValidation.error || 'Invalid email address.' }, { status: 400, headers: responseHeaders })
  }
  const email = emailValidation.email

  const fullName = sanitizeText(body.full_name, 100)
  if (!fullName) {
    return NextResponse.json({ error: 'Full name is required.' }, { status: 400, headers: responseHeaders })
  }

  const passwordValidation = validatePasswordStrength(body.password)
  if (!passwordValidation.valid) {
    return NextResponse.json({ error: passwordValidation.error }, { status: 400, headers: responseHeaders })
  }
  const password = String(body.password)

  const role: Role = ROLES.includes(body.role) ? body.role : 'store'

  const rawStoreAccess = Array.isArray(body.store_access) ? body.store_access : []
  const storeAccess: string[] = []
  for (const item of rawStoreAccess) {
    const id = String(item).trim()
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid store identifier.' }, { status: 400, headers: responseHeaders })
    }
    storeAccess.push(id)
  }

  const canEdit = role === 'admin' ? Boolean(body.can_edit) : role === 'super_admin'

  if (role === 'store' && storeAccess.length !== 1) {
    return NextResponse.json({ error: 'A store login must be linked to exactly one store.' }, { status: 400, headers: responseHeaders })
  }

  let admin
  try {
    admin = createAdminClient()
  } catch (e) {
    console.error('Failed to initialize Supabase Admin client:', e)
    return NextResponse.json({ error: 'Internal server configuration error.' }, { status: 500, headers: responseHeaders })
  }

  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })

  if (authErr || !created.user) {
    const safeMsg = authErr?.message?.includes('already registered')
      ? 'A user with this email already exists.'
      : 'Could not create user account.'
    return NextResponse.json({ error: safeMsg }, { status: 400, headers: responseHeaders })
  }

  // Upsert profile with verified role and access
  const { error: profErr } = await admin.from('profiles').upsert({
    id: created.user.id,
    email,
    full_name: fullName,
    role,
    store_access: storeAccess,
    can_edit: canEdit,
    is_active: true,
  })

  if (profErr) {
    console.error('Profile creation error:', profErr)
    // Clean up created auth user to prevent orphaned state
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {})
    return NextResponse.json({ error: 'Failed to create user profile.' }, { status: 500, headers: responseHeaders })
  }

  return NextResponse.json({ id: created.user.id }, { status: 201, headers: responseHeaders })
}

/** Turn a login on/off or reset password. Body: { id, is_active } or { id, password } */
export async function PATCH(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request)

  // CSRF Origin verification
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden: Request origin not allowed.' }, { status: 403, headers: corsHeaders })
  }

  // Rate limiting (20 requests per 60 seconds per IP)
  const clientIp = getClientIp(request.headers)
  const rl = rateLimit(`admin-users-patch:${clientIp}`, { limit: 20, windowSeconds: 60 })
  const responseHeaders = { ...corsHeaders, ...getRateLimitHeaders(rl) }

  if (!rl.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment before trying again.' },
      { status: 429, headers: responseHeaders }
    )
  }

  const me = await requireSuperAdmin()
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized: Only a Super Admin can modify logins.' }, { status: 403, headers: responseHeaders })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400, headers: responseHeaders })
  }

  const id = String(body?.id || '').trim()
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid user identifier.' }, { status: 400, headers: responseHeaders })
  }

  let admin
  try {
    admin = createAdminClient()
  } catch (e) {
    console.error('Failed to initialize Supabase Admin client:', e)
    return NextResponse.json({ error: 'Internal server configuration error.' }, { status: 500, headers: responseHeaders })
  }

  // Set a new password for a login
  if (typeof body?.password === 'string') {
    const passwordValidation = validatePasswordStrength(body.password)
    if (!passwordValidation.valid) {
      return NextResponse.json({ error: passwordValidation.error }, { status: 400, headers: responseHeaders })
    }

    const { error } = await admin.auth.admin.updateUserById(id, { password: body.password })
    if (error) {
      console.error('Password update error:', error)
      return NextResponse.json({ error: 'Could not update password.' }, { status: 500, headers: responseHeaders })
    }
    return NextResponse.json({ ok: true }, { headers: responseHeaders })
  }

  // Deactivate or reactivate login
  const isActive = Boolean(body?.is_active)
  if (id === me.id && !isActive) {
    return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 400, headers: responseHeaders })
  }

  const { error: profErr } = await admin.from('profiles').update({ is_active: isActive }).eq('id', id)
  if (profErr) {
    console.error('Profile update error:', profErr)
    return NextResponse.json({ error: 'Could not update user status.' }, { status: 500, headers: responseHeaders })
  }

  // Block sign-in at auth level
  const { error: authErr } = await admin.auth.admin.updateUserById(id, { ban_duration: isActive ? 'none' : '876000h' })
  if (authErr) {
    console.error('Auth ban status error:', authErr)
    return NextResponse.json({ error: 'Could not update auth status.' }, { status: 500, headers: responseHeaders })
  }

  return NextResponse.json({ ok: true }, { headers: responseHeaders })
}
