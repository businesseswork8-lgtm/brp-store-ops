import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

type Role = 'store' | 'admin' | 'super_admin'
const ROLES: Role[] = ['store', 'admin', 'super_admin']

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
  if (!(await requireSuperAdmin())) {
    return NextResponse.json({ error: 'Only a Super Admin can create logins.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const email = String(body?.email || '').trim().toLowerCase()
  const password = String(body?.password || '')
  const fullName = String(body?.full_name || '').trim()
  const role: Role = ROLES.includes(body?.role) ? body.role : 'store'
  const storeAccess: string[] = Array.isArray(body?.store_access) ? body.store_access.map(String) : []
  const canEdit = role === 'admin' ? Boolean(body?.can_edit) : role === 'super_admin'

  if (!email || !fullName || password.length < 8) {
    return NextResponse.json({ error: 'Name, email and a password of at least 8 characters are required.' }, { status: 400 })
  }
  if (role === 'store' && storeAccess.length !== 1) {
    return NextResponse.json({ error: 'A store login must be linked to exactly one store.' }, { status: 400 })
  }

  let admin
  try { admin = createAdminClient() } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }

  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (authErr || !created.user) {
    return NextResponse.json({ error: authErr?.message || 'Could not create login.' }, { status: 400 })
  }

  // The signup trigger creates a basic profile; set role and access here
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
    await admin.auth.admin.deleteUser(created.user.id)
    return NextResponse.json({ error: 'Login created but profile failed: ' + profErr.message }, { status: 500 })
  }

  return NextResponse.json({ id: created.user.id })
}

/** Turn a login on/off. Body: { id, is_active } */
export async function PATCH(request: NextRequest) {
  const me = await requireSuperAdmin()
  if (!me) return NextResponse.json({ error: 'Only a Super Admin can change logins.' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const id = String(body?.id || '')
  if (!id) return NextResponse.json({ error: 'Missing user id.' }, { status: 400 })
  const admin = createAdminClient()

  // Set a new password for a login (no email needed)
  if (typeof body?.password === 'string') {
    const password = body.password
    if (password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
    const { error } = await admin.auth.admin.updateUserById(id, { password })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const isActive = Boolean(body?.is_active)
  if (id === me.id && !isActive) {
    return NextResponse.json({ error: "You can't deactivate your own login." }, { status: 400 })
  }

  const { error: profErr } = await admin.from('profiles').update({ is_active: isActive }).eq('id', id)
  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 })

  // Block sign-in at the auth level too
  const { error: authErr } = await admin.auth.admin.updateUserById(id, { ban_duration: isActive ? 'none' : '876000h' })
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
