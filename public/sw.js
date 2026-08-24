const APP_PATH = '/-one2us-app/'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data?.json() || {} } catch { data = { body: event.data?.text() || 'Neue Nachricht' } }
  const title = data.title || 'One:2:Us'
  const options = {
    body: data.body || 'Du hast eine neue Nachricht.',
    tag: data.tag || 'one2us-message',
    renotify: true,
    data: { url: data.url || APP_PATH },
    badge: data.badge || undefined,
    icon: data.icon || undefined
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = event.notification.data?.url || APP_PATH
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus()
        client.postMessage({ type: 'ONE2US_OPEN_CHAT' })
        return
      }
    }
    if (clients.openWindow) await clients.openWindow(target)
  })())
})
