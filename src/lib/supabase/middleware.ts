import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
  const isProtectedRoute = path.startsWith('/store') || path.startsWith('/analytics') || path.startsWith('/super-admin')

  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    url.search = ''
    return NextResponse.redirect(url)
  }

  if (!user) {
    return isProtectedRoute ? redirectTo('/login') : supabaseResponse
  }

  if (!isAuthPage && !isProtectedRoute) return supabaseResponse

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active, can_edit')
    .eq('id', user.id)
    .single()

  // Deactivated or missing profile: send back to login
  if (!profile || profile.is_active === false) {
    await supabase.auth.signOut()
    return isAuthPage ? supabaseResponse : redirectTo('/login')
  }

  const home = profile.role === 'super_admin' ? '/super-admin/variance'
    : profile.role === 'admin' ? '/analytics/sales'
    : '/store'

  if (isAuthPage) return redirectTo(home)

  // Role-based access (the database enforces this too)
  const allowed =
    profile.role === 'super_admin' ||
    (profile.role === 'admin' && (
      path.startsWith('/analytics') ||
      // View-only admins may only read the Day Summary in the store area
      (path.startsWith('/store') && (profile.can_edit || path === '/store/eod-report')) ||
      path === '/super-admin' ||
      path === '/super-admin/variance' ||
      path === '/super-admin/flavours'
    )) ||
    (profile.role === 'store' && path.startsWith('/store'))

  if (!allowed) return redirectTo(home)

  return supabaseResponse
}
