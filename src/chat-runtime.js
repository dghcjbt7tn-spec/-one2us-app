import { backendConfigured, supabase } from './lib/supabase'
import { listMatches, loadMessages } from './lib/backend'

if (backendConfigured && supabase) {
  let currentUser = null
  let matches = []
  let unreadByMatch = new Map()
  let lastMessageByMatch = new Map()
  let onlineUsers = new Set()
  let lastSeen = new Map()
  let activeMatchId = null
  let presenceChannel = null
  let messagesChannel = null
  let refreshTimer = null
  let domTimer = null
  let heartbeatTimer = null

  const getMatchName = match => match?.person?.display_name || 'Match'
  const formatListTime = value => {
    if (!value) return ''
    const d = new Date(value)
    const now = new Date()
    const sameDay = d.toDateString() === now.toDateString()
    if (sameDay) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  }

  const debounceRefresh = () => {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(refreshUnread, 300)
  }

  const scheduleRender = (delay = 100) => {
    if (domTimer) clearTimeout(domTimer)
    domTimer = setTimeout(() => {
      domTimer = null
      renderEnhancements()
    }, delay)
  }

  const setText = (el, value) => {
    if (el && el.textContent !== value) el.textContent = value
  }

  async function refreshUnread() {
    if (!currentUser) return
    try {
      matches = await listMatches()
      const entries = await Promise.all(matches.map(async match => {
        try {
          const rows = await loadMessages(match.id)
          const count = rows.filter(m => m.sender_id !== currentUser.id && !m.read_at).length
          const last = rows.length ? rows[rows.length - 1] : null
          return [match.id, count, last]
        } catch {
          return [match.id, 0, null]
        }
      }))
      unreadByMatch = new Map(entries.map(([id, count]) => [id, count]))
      lastMessageByMatch = new Map(entries.map(([id, _count, last]) => [id, last]))
      scheduleRender()
    } catch {
      // Chat itself must remain usable even if badge refresh fails.
    }
  }

  function renderNavBadge() {
    const chatsButton = [...document.querySelectorAll('nav.nav.five button')]
      .find(btn => btn.querySelector('span')?.textContent?.trim() === 'Chats')
    if (!chatsButton) return
    let badge = chatsButton.querySelector('.chat-nav-badge')
    const total = [...unreadByMatch.values()].reduce((sum, n) => sum + n, 0)
    if (!total) { badge?.remove(); return }
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
      btn.dataset.matchId = match.id
      if (match.person?.id) btn.dataset.personId = match.person.id
      const count = unreadByMatch.get(match.id) || 0
      btn.classList.toggle('has-unread', count > 0)
      let badge = btn.querySelector('.match-unread-badge')
      if (!count) { badge?.remove(); return }
      if (!badge) {
        badge = document.createElement('b')
        badge.className = 'match-unread-badge'
        btn.appendChild(badge)
      }
      setText(badge, count > 99 ? '99+' : String(count))
    })
  }

  function renderMatchPreviews() {
    const buttons = [...document.querySelectorAll('.match-list > button')]
    buttons.forEach((btn, index) => {
      const match = matches[index]
      if (!match) return
      const last = lastMessageByMatch.get(match.id)
      const copy = btn.querySelector('span')
      const small = copy?.querySelector('small')
      if (!copy || !small) return

      const text = last ? (last.body || last.message || 'Neue Nachricht') : (match.person?.city || 'One:2:Us')
      const mine = last?.sender_id === currentUser?.id
      const preview = last ? `${mine ? 'Du: ' : ''}${text}` : `${text} · Chat öffnen`
      setText(small, preview)
      small.classList.toggle('unread-preview', (unreadByMatch.get(match.id) || 0) > 0)

      let time = copy.querySelector('.match-last-time')
      const timeText = formatListTime(last?.created_at)
      if (!timeText) { time?.remove(); return }
      if (!time) {
        time = document.createElement('em')
        time.className = 'match-last-time'
        copy.appendChild(time)
      }
      setText(time, timeText)
    })
  }

  function resolveOpenMatch(head) {
    if (activeMatchId) {
      const byId = matches.find(m => m.id === activeMatchId)
      if (byId) return byId
    }
    const savedPersonId = head.dataset.personId
    if (savedPersonId) {
      const byPerson = matches.find(m => m.person?.id === savedPersonId)
      if (byPerson) return byPerson
    }
    const name = head.querySelector('h2')?.textContent?.trim()
    const avatarEl = head.querySelector('img')
    const avatar = avatarEl?.currentSrc || avatarEl?.src || ''
    const resolved = matches.find(m => {
      const person = m?.person
      if (!person) return false
      if (person.avatar_url && avatar && avatar.includes(person.avatar_url)) return true
      return name && getMatchName(m) === name
    })
    if (resolved) return resolved
    return matches.length === 1 ? matches[0] : null
  }

  function renderChatPresence() {
    const head = document.querySelector('.chat-head')
    if (!head || !currentUser) return
    const status = head.querySelector('div > span')
    if (!status) return
    if (status.textContent?.includes('schreibt gerade')) return
    const match = resolveOpenMatch(head)
    const otherId = match?.person?.id
    if (!otherId || otherId === currentUser.id) return
    activeMatchId = match.id
    head.dataset.matchId = match.id
    head.dataset.personId = otherId
    const online = onlineUsers.has(otherId)
    const nextText = online ? 'online' : (lastSeen.has(otherId) ? 'zuletzt online vor kurzem' : 'offline')
    const nextClass = online ? 'presence-online' : 'presence-offline'
    if (!status.classList.contains(nextClass)) {
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
      try { await Notification.requestPermission() } finally { button.remove() }
    })
    title.appendChild(button)
  }

  function renderEnhancements() {
    renderNavBadge()
    renderMatchBadges()
    renderMatchPreviews()
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
    try { new Notification(`One:2:Us · ${sender}`, { body, tag: `one2us-${message.match_id}` }) } catch {}
  }

  function syncPresenceState() {
    if (!presenceChannel) return
    const state = presenceChannel.presenceState()
    onlineUsers = new Set(Object.keys(state || {}))
    scheduleRender(50)
  }

  async function trackPresence() {
    if (!presenceChannel || !currentUser || document.visibilityState === 'hidden') return
    try {
      await presenceChannel.track({ user_id: currentUser.id, online_at: new Date().toISOString(), visible: true })
    } catch {}
  }

  function setupPresence() {
    presenceChannel?.unsubscribe?.()
    clearInterval(heartbeatTimer)
    presenceChannel = supabase.channel('one2us-user-presence-v2', { config: { presence: { key: currentUser.id } } })
      .on('presence', { event: 'sync' }, syncPresenceState)
      .on('presence', { event: 'join' }, ({ key }) => { if (key) onlineUsers.add(key); scheduleRender(50) })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (key) { onlineUsers.delete(key); lastSeen.set(key, Date.now()) }
        scheduleRender(50)
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') { await trackPresence(); syncPresenceState() }
      })
    heartbeatTimer = setInterval(trackPresence, 20000)
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

  const domObserver = new MutationObserver(mutations => {
    if (mutations.some(m => m.addedNodes.length || m.removedNodes.length)) scheduleRender(140)
  })
  domObserver.observe(document.getElementById('root') || document.body, { childList: true, subtree: true })

  document.addEventListener('click', event => {
    const matchButton = event.target.closest?.('.match-list > button')
    if (matchButton?.dataset?.matchId) activeMatchId = matchButton.dataset.matchId
    const chatsNav = event.target.closest?.('nav.nav.five button')
    if (chatsNav?.querySelector('span')?.textContent?.trim() === 'Chats') activeMatchId = null
    scheduleRender(120)
  }, true)

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { trackPresence(); debounceRefresh(); scheduleRender(80) }
  })
  window.addEventListener('focus', () => { trackPresence(); debounceRefresh(); scheduleRender(80) })

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
    lastMessageByMatch = new Map()
    matches = []
    onlineUsers = new Set()
    activeMatchId = null
    presenceChannel?.unsubscribe?.()
    messagesChannel?.unsubscribe?.()
    clearInterval(heartbeatTimer)
    if (session) start(session)
    else scheduleRender()
  })
}
