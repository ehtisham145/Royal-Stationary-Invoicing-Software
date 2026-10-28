// Edge Function: admin-only user management (create, update, password, delete).
// Deploy:  supabase functions deploy admin-users
// Needs the default SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY secrets (set automatically).
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Keep in sync with frontend/src/shared/lib/permissions.js and the profiles.role check in setup.sql
const ROLES = ['admin', 'manager', 'cashier', 'storekeeper']
const parseRole = (role: unknown) => {
  if (!ROLES.includes(role as string)) throw new Error('Choose a valid role.')
  return role as string
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    // Who is calling, and are they an active admin?
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: auth } = await admin.auth.getUser(jwt)
    if (!auth?.user) return json({ error: 'Not signed in' }, 401)
    const meId = auth.user.id
    const { data: me } = await admin.from('profiles').select('role, active').eq('id', meId).single()
    if (me?.role !== 'admin' || !me.active) return json({ error: 'Only an administrator can do this.' }, 403)

    const body = await req.json()
    const activeAdminCount = async () => {
      const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('active', true)
      return count ?? 0
    }
    const getTarget = async (id: string) => {
      const { data } = await admin.from('profiles').select('*').eq('id', id).single()
      if (!data) throw new Error('User not found.')
      return data
    }
    const checkPassword = (pw: string) => {
      if (!pw || pw.length < 8) throw new Error('Password must be at least 8 characters.')
    }

    switch (body.action) {
      case 'create': {
        const email = String(body.email ?? '').trim().toLowerCase()
        const name = String(body.name ?? '').trim()
        const role = parseRole(body.role ?? 'cashier')
        if (!name) throw new Error('Name is required.')
        checkPassword(body.password)
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password: body.password,
          email_confirm: true,
          user_metadata: { name },
          app_metadata: { role },
        })
        if (error) throw error
        // The on_auth_user_created trigger made the profile; make sure name/role are set
        await admin.from('profiles').update({ name, role }).eq('id', data.user.id)
        return json(await getTarget(data.user.id))
      }

      case 'update': {
        const target = await getTarget(body.id)
        const next = {
          name: body.name !== undefined ? String(body.name).trim() : target.name,
          role: body.role !== undefined ? parseRole(body.role) : target.role,
          active: body.active !== undefined ? Boolean(body.active) : target.active,
        }
        if (!next.name) throw new Error('Name is required.')
        if (body.id === meId && (next.role !== 'admin' || !next.active)) {
          throw new Error('You cannot remove your own admin access or deactivate yourself.')
        }
        if (target.role === 'admin' && target.active && (next.role !== 'admin' || !next.active) && (await activeAdminCount()) <= 1) {
          throw new Error('At least one active administrator is required.')
        }
        if (next.active !== target.active) {
          // Banning also blocks sign-in and token refresh for deactivated users
          const { error } = await admin.auth.admin.updateUserById(body.id, { ban_duration: next.active ? 'none' : '876000h' })
          if (error) throw error
        }
        const { error } = await admin.from('profiles').update(next).eq('id', body.id)
        if (error) throw error
        return json(await getTarget(body.id))
      }

      case 'password': {
        checkPassword(body.password)
        const { error } = await admin.auth.admin.updateUserById(body.id, { password: body.password })
        if (error) throw error
        return json({ ok: true })
      }

      case 'delete': {
        const target = await getTarget(body.id)
        if (body.id === meId) throw new Error('You cannot delete your own account.')
        if (target.role === 'admin' && target.active && (await activeAdminCount()) <= 1) {
          throw new Error('At least one active administrator is required.')
        }
        const { error } = await admin.auth.admin.deleteUser(body.id) // profile cascades
        if (error) throw error
        return json({ ok: true })
      }

      default:
        return json({ error: 'Unknown action' }, 400)
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400)
  }
})
