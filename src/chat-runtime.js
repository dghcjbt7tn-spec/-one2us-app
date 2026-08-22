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

  const debounceRefresh = () => {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(refreshUnread, 180)
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
      renderEnhancements()
    } catch {
      // UI remains functional even if the badge refresh fails temporarily.
    }
  }

  function renderNavBadge() {
    const chatsButton = [...document.querySelectorAll('nav.nav.five button')]
      .find(btn => btn.querySelector('span')?.textContent?.trim() === 'Chats')
    if (!chatsButton) return

    let badge = chatsButton.querySelector('.chat-nav-badge')
    const total = [...unreadByMatch.values()].reduce((sum, n) => sum + n, 0)
    if (!total) {
      badge?.remove()
      return
    }
    if (!badge) {
      badge = document.createElement('b')
      badge.className = 'chat-nav-badge'
      chatsButton.appendChild(badge)
    }
    badge.textContent = total > 99 ? '99+' : String(total)
  }

  function renderMatchBadges() {
    const buttons = [...document.querySelectorAll('.match-list > button')]
    buttons.forEach((btn, index) => {
      const match = matches[index]
      if (!match) return
      const count = unreadByMatch.get(match.id) || 0
      let badge = btn.querySelector('.match-unread-badge')
      if (!count) {
        badge?.remove()
        return
      }
      if (!badge) {
        badge = document.createElement('b')
        badge.className = 'match-unread-badge'
        btn.appendChild(badge)
      }
      badge.textContent = count > 99 ? '99+' : String(count)
    })
  }

  function resolveOpenMatch(head) {
    const name = head.querySelector('h2')?.textContent?.trim()
    const avatar = head.querySelector('img')?.currentSrc || head.querySelector('img')?.src || ''

    let match = matches.find(m => {
      const person = m?.person
      if (!person) return false
      if (person.id && head.dataset.personId === person.id) return true
      if (person.avatar_url && avatar && avatar.includes(person.avatar_url)) return true
      return name && getMatchName(m) === name
    })

    // In the current 1:1 prototype there is often only one real match.
    // This fallback avoids losing presence just because display names/avatars changed.
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

    head.dataset.personId = otherId
    status.classList.remove('presence-online', 'presence-offline')
    if (onlineUsers.has(otherId)) {
      status.textContent = 'online'
      status.classList.add('presence-online')
    } else {
      status.textContent = lastSeen.has(otherId) ? 'zuletzt online vor kurzem' : 'offline'
      status.classList.add('presence-offline')
    }
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
        renderEnhancements()
      })
      .on('presence', { event: 'join' }, ({ key }) => {
        if (key) onlineUsers.add(key)
        renderEnhancements()
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (key) {
          onlineUsers.delete(key)
          lastSeen.set(key, Date.now())
        }
        renderEnhancements()
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({ user_id: currentUser.id, online_at: new Date().toISOString() })
          const state = presenceChannel.presenceState()
          onlineUsers = new Set(Object.keys(state))
          renderEnhancements()
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

  const domObserver = new MutationObserver(() => renderEnhancements())
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
    renderEnhancements()
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
    else renderEnhancements()
  })
}
