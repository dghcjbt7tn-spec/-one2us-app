import { backendConfigured, supabase } from './lib/supabase'
import { listMatches, loadMessages } from './lib/backend'

if (backendConfigured && supabase) {
  let currentUser = null
  let matches = []
  let unreadByMatch = new Map()
  let onlineUsers = new Set()
  let lastSeen = new Map()
  let presenceChannel = null
  let messagesChannel = null
  let refreshTimer = null
  let domTimer = null

  const debounceRefresh = () => {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(refreshUnread, 250)
  }

  const scheduleRender = () => {
    if (domTimer) return
    domTimer = setTimeout(() => {
      domTimer = null
      renderEnhancements()
    }, 120)
  }

  const setText = (el, value) => {
    if (el && el.textContent !== value) el.textContent = value
  }

  const getMatchName = match => match?.person?.display_name || 'Match'

  async function refreshUnread() {
    if (!currentUser) return
    try {
      matches = await listMatches()
      const entries = await Promise.all(matches.map(async match => {
        try {
          const rows = await loadMessages(match.id)
          const count = rows.filter(m => m.sender_id !== currentUser.id && !m.read_at).length
          return [match.id, count]
        } catch {
          return [match.id, 0]
        }
      }))
      unreadByMatch = new Map(entries)
      scheduleRender()
    } catch {
      // UI remains functional even if unread refresh fails temporarily.
    }
  }

  function renderNavBadge() {
    const chatsButton = [...document.querySelectorAll('nav.nav.five button')]
      .find(btn => btn.querySelector('span')?.textContent?.trim() === 'Chats')
    if (!chatsButton) return

    let badge = chatsButton.querySelector('.chat-nav-badge')
    const total = [...unreadByMatch.values()].reduce((sum, n) => sum + n, 0)
    if (!total) {
      if (badge) badge.remove()
      return
    }
    if (!badge) {
      badge = document.createElement('b')
      badge.className = 'chat-nav-badge'
      chatsButton.appendChild(badge)
    }
    setText(badge, total > 99 ? '99+' : String(total))
  }

  function renderMatchBadges() {
    const buttons = [...document.querySelectorAll('.match-list > button')]
    buttons.forEach((btn, index) => {
      const match = matches[index]
      if (!match) return
      const count = unreadByMatch.get(match.id) || 0
      let badge = btn.querySelector('.match-unread-badge')
      if (!count) {
        if (badge) badge.remove()
        return
      }
      if (!badge) {
        badge = document.createElement('b')
        badge.className = 'match-unread-badge'
        btn.appendChild(badge)
      }
      setText(badge, count > 99 ? '99+' : String(count))
    })
  }

  function resolveOpenMatch(head) {
    const name = head.querySelector('h2')?.textContent?.trim()
    const avatarEl = head.querySelector('img')
    const avatar = avatarEl?.currentSrc || avatarEl?.src || ''

    let match = matches.find(m => {
      const person = m?.person
      if (!person) return false
      if (person.id && head.dataset.personId === person.id) return true
      if (person.avatar_url && avatar && avatar.includes(person.avatar_url)) return true
      return name && getMatchName(m) === name
    })

    if (!match && matches.length === 1) match = matches[0]
    return match || null
  }

  function renderChatPresence() {
    const head = document.querySelector('.chat-head')
    if (!head) return
    const status = head.querySelector('div > span')
    if (!status) return

    const match = resolveOpenMatch(head)
    const otherId = match?.person?.id
    if (!otherId || otherId === currentUser?.id) return

    if (head.dataset.personId !== otherId) head.dataset.personId = otherId

    const online = onlineUsers.has(otherId)
    const nextText = online ? 'online' : (lastSeen.has(otherId) ? 'zuletzt online vor kurzem' : 'offline')
    const nextClass = online ? 'presence-online' : 'presence-offline'

    if (!status.classList.contains(nextClass) || status.classList.length > 1) {
      status.classList.remove('presence-online', 'presence-offline')
      status.classList.add(nextClass)
    }
    setText(status, nextText)
  }

  function renderNotificationControl() {
    if (!('Notification' in window) || Notification.permission !== 'default') return
    const title = [...document.querySelectorAll('.page-title')]
      .find(el => el.querySelector('h1')?.textContent?.trim() === 'Deine Matches')
    if (!title || title.querySelector('.notify-enable')) return

    const button = document.createElement('button')
    button.className = 'notify-enable'
    button.type = 'button'
    button.textContent = '🔔 Nachrichten aktivieren'
    button.addEventListener('click', async () => {
      try {
        await Notification.requestPermission()
      } finally {
        button.remove()
      }
    })
    title.appendChild(button)
  }

  function renderEnhancements() {
    renderNavBadge()
    renderMatchBadges()
    renderChatPresence()
    renderNotificationControl()
  }

  function showIncomingNotification(message) {
    if (!currentUser || message?.sender_id === currentUser.id) return
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    if (document.visibilityState === 'visible') return

    const match = matches.find(m => m.id === message.match_id)
    const sender = getMatchName(match)
    const body = message.body || message.message || 'Du hast eine neue Nachricht.'
    try {
      new Notification(`One:2:Us · ${sender}`, { body, tag: `one2us-${message.match_id}` })
    } catch {
      // Some iOS/browser contexts do not permit page-created notifications.
    }
  }

  function setupPresence() {
    presenceChannel?.unsubscribe?.()
    presenceChannel = supabase.channel('one2us-user-presence', {
      config: { presence: { key: currentUser.id } }
    })
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState()
        onlineUsers = new Set(Object.keys(state))
        scheduleRender()
      })
      .on('presence', { event: 'join' }, ({ key }) => {
        if (key) onlineUsers.add(key)
        scheduleRender()
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (key) {
          onlineUsers.delete(key)
          lastSeen.set(key, Date.now())
        }
        scheduleRender()
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({ user_id: currentUser.id, online_at: new Date().toISOString() })
          const state = presenceChannel.presenceState()
          onlineUsers = new Set(Object.keys(state))
          scheduleRender()
        }
      })
  }

  function setupMessageObserver() {
    messagesChannel?.unsubscribe?.()
    messagesChannel = supabase.channel(`one2us-global-messages-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, payload => {
        if (payload.eventType === 'INSERT') showIncomingNotification(payload.new)
        debounceRefresh()
      })
      .subscribe()
  }

  // React changes the screen DOM. Observe those changes, but debounce heavily and
  // only write to DOM when values actually changed. This prevents render loops on iOS Safari.
  const domObserver = new MutationObserver(() => scheduleRender())
  domObserver.observe(document.documentElement, { childList: true, subtree: true })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') debounceRefresh()
  })
  window.addEventListener('focus', debounceRefresh)

  async function start(session) {
    currentUser = session?.user || null
    if (!currentUser) return
    await refreshUnread()
    setupPresence()
    setupMessageObserver()
    scheduleRender()
  }

  supabase.auth.getSession().then(({ data }) => start(data.session))
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user?.id === currentUser?.id) return
    currentUser = session?.user || null
    unreadByMatch = new Map()
    matches = []
    onlineUsers = new Set()
    presenceChannel?.unsubscribe?.()
    messagesChannel?.unsubscribe?.()
    if (session) start(session)
    else scheduleRender()
  })
}
