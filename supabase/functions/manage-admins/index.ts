import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Não autorizado.')

    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const adminClient = createClient(url, serviceKey)

    const { data: { user }, error: userError } = await callerClient.auth.getUser()
    if (userError || !user) throw new Error('Sessão inválida.')
    const { data: founder } = await adminClient.from('profiles').select('role,active,display_name').eq('id', user.id).single()
    if (!founder?.active || founder.role !== 'founder') throw new Error('Somente o Fundador pode realizar esta ação.')

    const body = await req.json()
    const action = body.action

    if (action === 'list') {
      const { data: profiles, error } = await adminClient.from('profiles').select('*').order('created_at')
      if (error) throw error
      const { data: authData, error: authError } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 })
      if (authError) throw authError
      const signIns = new Map(authData.users.map(u => [u.id, u.last_sign_in_at]))
      return json({ admins: profiles.map(p => ({ ...p, last_sign_in_at: signIns.get(p.id) || null })) })
    }

    if (action === 'create') {
      const username = String(body.username || '').trim().toLowerCase()
      const displayName = String(body.displayName || '').trim()
      const password = String(body.password || '')
      if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new Error('Usuário inválido.')
      if (!displayName || password.length < 8) throw new Error('Nome e senha válida são obrigatórios.')
      const email = `${username}@staff.brasilstyle.local`
      const { data, error } = await adminClient.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { username, display_name: displayName, role: 'admin' }
      })
      if (error) throw error
      await adminClient.from('profiles').upsert({ id: data.user.id, username, display_name: displayName, role: 'admin', active: true })
      await log(adminClient, user.id, founder.display_name, 'admin_created', data.user.id, { username })
      return json({ ok: true })
    }

    const userId = String(body.userId || '')
    const { data: target } = await adminClient.from('profiles').select('*').eq('id', userId).single()
    if (!target) throw new Error('Conta não encontrada.')
    if (target.role === 'founder') throw new Error('A conta do Fundador não pode ser alterada por aqui.')

    if (action === 'toggle') {
      const active = Boolean(body.active)
      const { error } = await adminClient.from('profiles').update({ active }).eq('id', userId)
      if (error) throw error
      if (!active) await adminClient.auth.admin.signOut(userId, 'global')
      await log(adminClient, user.id, founder.display_name, active ? 'admin_enabled' : 'admin_blocked', userId, {})
      return json({ ok: true })
    }

    if (action === 'reset_password') {
      const password = String(body.password || '')
      if (password.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.')
      const { error } = await adminClient.auth.admin.updateUserById(userId, { password })
      if (error) throw error
      await log(adminClient, user.id, founder.display_name, 'admin_password_reset', userId, {})
      return json({ ok: true })
    }

    if (action === 'delete') {
      const { error } = await adminClient.auth.admin.deleteUser(userId)
      if (error) throw error
      await log(adminClient, user.id, founder.display_name, 'admin_deleted', userId, { username: target.username })
      return json({ ok: true })
    }

    throw new Error('Ação inválida.')
  } catch (error) {
    return json({ error: error.message || 'Erro interno.' }, 400)
  }
})

async function log(client:any, actorId:string, actorName:string, action:string, targetId:string, details:any) {
  await client.from('audit_logs').insert({ actor_id: actorId, actor_name: actorName, action, target_id: targetId, details })
}
function json(data:any, status=200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
