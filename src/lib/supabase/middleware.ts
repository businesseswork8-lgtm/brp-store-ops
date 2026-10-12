import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getClientEnv } from '@/lib/env'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const { supabaseUrl, supabaseAnonKey } = getClientEnv()

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname

  const isAuthPage = path.startsWith('/login')
  const isResetPassword = path.startsWith('/reset-password')
  const isApiAdmin = path.startsWith('/api/admin')
  const isProtectedRoute = path.startsWith('/store') || path.startsWith('/analytics') || path.startsWith('/super-admin')

  // Apply baseline security headers to all responses
  const applySecurityHeaders = (res: NextResponse) => {
    res.headers.set('X-Content-Type-Options', 'nosniff')
    res.headers.set('X-Frame-Options', 'DENY')
    res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    return res
  }

  // Preflight OPTIONS for API routes
  if (request.method === 'OPTIONS' && path.startsWith('/api')) {
    return applySecurityHeaders(new NextResponse(null, { status: 204 }))
  }

  // Handle unauthenticated requests
  if (!user) {
    if (isApiAdmin) {
      return applySecurityHeaders(
        NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      )
    }
    if (isProtectedRoute) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.search = ''
      return applySecurityHeaders(NextResponse.redirect(url))
    }
    return applySecurityHeaders(supabaseResponse)
  }

  // Allow reset password page for authenticated users (e.g. following a recovery link)
  if (isResetPassword) return applySecurityHeaders(supabaseResponse)

  // Fetch user profile to enforce role-based access control (RBAC)
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active, can_edit')
    .eq('id', user.id)
    .single()

  // Deactivated or missing profile: terminate session and deny access
  if (!profile || profile.is_active === false) {
    await supabase.auth.signOut()
    if (isApiAdmin) {
      return applySecurityHeaders(
        NextResponse.json({ error: 'Account is deactivated' }, { status: 403 })
      )
    }
    if (isAuthPage) return applySecurityHeaders(supabaseResponse)

    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return applySecurityHeaders(NextResponse.redirect(url))
  }

  // Guard API admin routes: strictly super_admin only
  if (isApiAdmin) {
    if (profile.role !== 'super_admin') {
      return applySecurityHeaders(
        NextResponse.json({ error: 'Forbidden: Super Admin privileges required' }, { status: 403 })
      )
    }
    return applySecurityHeaders(supabaseResponse)
  }

  const home = profile.role === 'store' ? '/store' : '/super-admin'

  // If already logged in, redirect away from login page to role home
  if (isAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = home
    url.search = ''
    return applySecurityHeaders(NextResponse.redirect(url))
  }

  // Role-based access control for dashboard routes
  const isSuperAdmin = profile.role === 'super_admin'
  const isAdmin = profile.role === 'admin'
  const isStore = profile.role === 'store'

  const allowed =
    isSuperAdmin ||
    (isAdmin && (
      path.startsWith('/analytics') ||
      (path.startsWith('/store') && (profile.can_edit || path === '/store/eod-report')) ||
      path === '/super-admin' ||
      path === '/super-admin/stock-report' ||
      (path === '/super-admin/items' && profile.can_edit) ||
      path === '/super-admin/flavours'
    )) ||
    (isStore && path.startsWith('/store'))

  if (!allowed) {
    const url = request.nextUrl.clone()
    url.pathname = home
    url.search = ''
    return applySecurityHeaders(NextResponse.redirect(url))
  }

  return applySecurityHeaders(supabaseResponse)
}
