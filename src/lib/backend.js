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

export async function listProfiles(limit = 12) {
  if (!backendConfigured) return []
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase.from('profiles').select('id,display_name,birthdate,city,bio,avatar_url,verified').neq('id', user.id).limit(limit)
  if (error) throw error
  return data || []
}

export async function listEvents(limit = 20) {
  if (!backendConfigured) return []
  const { data, error } = await supabase.from('events').select('*').order('starts_at').limit(limit)
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
  if (!backendConfigured) return []
  const { data, error } = await supabase.from('messages').select('*').eq('match_id', matchId).order('created_at')
  if (error) throw error
  return data || []
}

export async function sendMessage(matchId, body) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht angemeldet')
  const { data, error } = await supabase.from('messages').insert({ match_id: matchId, sender_id: user.id, body }).select().single()
  if (error) throw error
  return data
}

export async function startCheckout(kind, quantity) {
  if (!backendConfigured) throw new Error('Backend noch nicht konfiguriert')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Bitte zuerst anmelden')
  const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ kind, quantity, successUrl: window.location.href, cancelUrl: window.location.href })
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || 'Checkout konnte nicht gestartet werden')
  window.location.href = payload.url
}
