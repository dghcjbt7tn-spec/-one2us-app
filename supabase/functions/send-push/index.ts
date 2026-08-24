import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')!
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')!
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:hello@one2us.app'
    if (!vapidPublic || !vapidPrivate) throw new Error('VAPID secrets fehlen')

    const admin = createClient(supabaseUrl, serviceKey)
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '')
    const { data: authData } = await admin.auth.getUser(token)
    const caller = authData.user
    if (!caller) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const { messageId } = await req.json()
    const { data: message, error: messageError } = await admin.from('messages').select('id,match_id,sender_id,body').eq('id', messageId).single()
    if (messageError || !message) throw messageError || new Error('Nachricht fehlt')
    if (message.sender_id !== caller.id) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const { data: match, error: matchError } = await admin.from('matches').select('user_a,user_b').eq('id', message.match_id).single()
    if (matchError || !match) throw matchError || new Error('Match fehlt')
    const recipientId = match.user_a === caller.id ? match.user_b : match.user_a
    if (![match.user_a, match.user_b].includes(caller.id)) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const [{ data: sender }, { data: subscriptions }] = await Promise.all([
      admin.from('profiles').select('display_name').eq('id', caller.id).maybeSingle(),
      admin.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', recipientId)
    ])

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)
    const isPhoto = String(message.body || '').startsWith('[[image:')
    const payload = JSON.stringify({
      title: sender?.display_name || 'Neue Nachricht',
      body: isPhoto ? '📷 Foto' : String(message.body || 'Neue Nachricht').slice(0, 120),
      tag: `match-${message.match_id}`,
      url: '/-one2us-app/'
    })

    let delivered = 0
    for (const sub of subscriptions || []) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
        delivered++
      } catch (error) {
        const status = Number(error?.statusCode || 0)
        if (status === 404 || status === 410) await admin.from('push_subscriptions').delete().eq('id', sub.id)
        else console.error('push failed', error)
      }
    }

    return new Response(JSON.stringify({ ok: true, delivered }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    console.error(error)
    return new Response(JSON.stringify({ error: error?.message || 'push failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
