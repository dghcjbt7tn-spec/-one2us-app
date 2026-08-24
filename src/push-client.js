import { backendConfigured, supabase } from './lib/supabase'

const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY

function base64ToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

async function registration() {
  if (!('serviceWorker' in navigator)) throw new Error('Service Worker nicht unterstützt')
  return navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
}

async function saveSubscription(subscription) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht angemeldet')
  const json = subscription.toJSON()
  const payload = {
    user_id: user.id,
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
    user_agent: navigator.userAgent,
    updated_at: new Date().toISOString()
  }
  const { error } = await supabase.from('push_subscriptions').upsert(payload, { onConflict: 'endpoint' })
  if (error) throw error
}

async function enablePush(button) {
  if (!backendConfigured) return
  if (!vapidPublicKey) {
    button.textContent = 'Push noch nicht konfiguriert'
    button.disabled = true
    return
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Benachrichtigungen nicht erlaubt')
  const reg = await registration()
  let subscription = await reg.pushManager.getSubscription()
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToUint8Array(vapidPublicKey)
    })
  }
  await saveSubscription(subscription)
  button.textContent = 'Push aktiv ✓'
  button.classList.add('push-on')
}

function ensureButton() {
  const profile = document.querySelector('.profile-box')
  if (!profile || profile.querySelector('.push-enable')) return
  const button = document.createElement('button')
  button.className = 'push-enable'
  button.type = 'button'
  button.textContent = Notification.permission === 'granted' ? 'Push aktivieren' : 'Push-Benachrichtigungen aktivieren'
  button.addEventListener('click', async () => {
    button.disabled = true
    const old = button.textContent
    button.textContent = 'Wird aktiviert …'
    try { await enablePush(button) }
    catch (error) {
      console.warn(error)
      button.textContent = 'Push konnte nicht aktiviert werden'
      setTimeout(() => { button.textContent = old; button.disabled = false }, 1800)
      return
    }
    button.disabled = false
  })
  profile.appendChild(button)
}

if ('serviceWorker' in navigator) registration().catch(()=>{})
const observer = new MutationObserver(ensureButton)
observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true })
ensureButton()
