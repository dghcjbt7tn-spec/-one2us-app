import { backendConfigured, supabase } from './supabase'

export async function signUp(email, password, displayName) {
  if (!backendConfigured) throw new Error('Backend noch nicht konfiguriert')
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName } } })
  if (error) throw error
  return data
}

export async function signIn(email, password) {
  if (!backendConfigured) throw new Error('Backend noch nicht konfiguriert')
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  if (!backendConfigured) return
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getSession() {
  if (!backendConfigured) return null
  const { data } = await supabase.auth.getSession()
  return data.session
}

export function onAuthChange(callback) {
  if (!backendConfigured) return { unsubscribe() {} }
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session))
  return data.subscription
}

export async function getMyProfile() {
  if (!backendConfigured) return null
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (error && error.code !== 'PGRST116') throw error
  return data
}

export async function saveProfile(profile) {
  if (!backendConfigured) throw new Error('Backend noch nicht konfiguriert')
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht angemeldet')
  const { data, error } = await supabase.from('profiles').upsert({ id: user.id, ...profile, updated_at: new Date().toISOString() }).select().single()
  if (error) throw error
  return data
}

export async function listProfiles(limit = 24) {
  if (!backendConfigured) return []
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase.from('profiles').select('id,username,display_name,birth_date,gender,interested_in,bio,city,latitude,longitude,avatar_url,verified').neq('id', user.id).limit(limit)
  if (error) throw error
  return data || []
}

export async function sendLike(targetUserId) {
  if (!backendConfigured) throw new Error('Backend noch nicht konfiguriert')
  const { data, error } = await supabase.rpc('send_like', { target_user: targetUserId })
  if (error) throw error
  return data?.[0] || { matched: false, match_id: null }
}

export async function listMatches() {
  if (!backendConfigured) return []
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase.from('matches').select('id,user_a,user_b,status,created_at').eq('status','active').order('created_at',{ascending:false})
  if (error) throw error
  if (!data?.length) return []
  const otherIds = data.map(m => m.user_a === user.id ? m.user_b : m.user_a)
  const { data: profiles, error: profileError } = await supabase.from('profiles').select('id,display_name,city,bio,avatar_url,verified').in('id', otherIds)
  if (profileError) throw profileError
  const byId = Object.fromEntries((profiles || []).map(p => [p.id,p]))
  return data.map(m => ({ ...m, person: byId[m.user_a === user.id ? m.user_b : m.user_a] })).filter(m=>m.person)
}

export function subscribeMatches(callback) {
  if (!backendConfigured) return { unsubscribe() {} }
  const channel = supabase.channel('matches-live').on('postgres_changes',{event:'*',schema:'public',table:'matches'},callback).subscribe()
  return { unsubscribe:()=>supabase.removeChannel(channel) }
}

export async function listEvents(limit = 30) {
  if (!backendConfigured) return []
  const { data, error } = await supabase.from('events').select('*').gte('starts_at',new Date().toISOString()).order('starts_at').limit(limit)
  if (error) throw error
  return data || []
}

export async function listMyBookings() {
  if (!backendConfigured) return []
  const { data, error } = await supabase.from('event_bookings').select('*,events(*)').order('created_at',{ascending:false})
  if (error) throw error
  return data || []
}

export async function shareLiveLocation({ latitude, longitude, accuracy, visibility = 'matches', precise = false, minutes = 30 }) {
  if (!backendConfigured) return null
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht angemeldet')
  const expiresAt = new Date(Date.now() + minutes * 60000).toISOString()
  const payload = { user_id: user.id, latitude, longitude, accuracy_m: Math.round(accuracy || 0), visibility, precise, expires_at: expiresAt, updated_at: new Date().toISOString() }
  const { data, error } = await supabase.from('live_locations').upsert(payload).select().single()
  if (error) throw error
  return data
}

export async function stopLiveLocation() {
  if (!backendConfigured) return
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const { error } = await supabase.from('live_locations').delete().eq('user_id', user.id)
  if (error) throw error
}

export async function listVisibleLiveLocations() {
  if (!backendConfigured) return []
  const { data, error } = await supabase.from('live_locations').select('user_id,latitude,longitude,accuracy_m,visibility,precise,expires_at,updated_at,profiles(display_name,avatar_url)').gt('expires_at', new Date().toISOString())
  if (error) throw error
  return data || []
}

export async function loadMessages(matchId) {
  if (!backendConfigured || !matchId) return []
  const { data, error } = await supabase.from('messages').select('*').eq('match_id', matchId).order('created_at')
  if (error) throw error
  return data || []
}

export function subscribeMessages(matchId, callback) {
  if (!backendConfigured || !matchId) return { unsubscribe() {} }
  const channel = supabase.channel(`messages-${matchId}`).on('postgres_changes',{event:'*',schema:'public',table:'messages',filter:`match_id=eq.${matchId}`},payload=>{if(payload.new?.id)callback(payload.new)}).subscribe()
  return { unsubscribe:()=>supabase.removeChannel(channel) }
}

export async function sendMessage(matchId, body) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht angemeldet')
  const { data, error } = await supabase.from('messages').insert({ match_id: matchId, sender_id: user.id, body }).select().single()
  if (error) throw error
  return data
}

export async function markMessagesRead(matchId) {
  if (!backendConfigured || !matchId) return
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const { error } = await supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('match_id', matchId).neq('sender_id', user.id).is('read_at', null)
  if (error) throw error
}

export function createTypingChannel(matchId, userId, onTyping) {
  if (!backendConfigured || !matchId || !userId) return { sendTyping() {}, unsubscribe() {} }
  const channel = supabase.channel(`typing-${matchId}`, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload?.user_id && payload.user_id !== userId) onTyping?.(!!payload.typing)
    })
    .subscribe()
  return {
    sendTyping(typing) { channel.send({ type: 'broadcast', event: 'typing', payload: { user_id: userId, typing: !!typing } }) },
    unsubscribe() { supabase.removeChannel(channel) }
  }
}

export async function startCheckout(kind, quantity) {
  if (!backendConfigured) throw new Error('Backend noch nicht konfiguriert')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Bitte zuerst anmelden')

  const returnUrl = new URL(window.location.href)
  returnUrl.searchParams.delete('payment')
  returnUrl.searchParams.delete('session_id')

  const { data, error } = await supabase.functions.invoke('create-checkout-session', {
    body: {
      kind,
      quantity,
      successUrl: returnUrl.toString(),
      cancelUrl: returnUrl.toString()
    }
  })

  if (error) throw new Error(error.message || 'Checkout konnte nicht gestartet werden')
  if (!data?.url) throw new Error(data?.error || 'Stripe Checkout URL fehlt')
  window.location.assign(data.url)
}
