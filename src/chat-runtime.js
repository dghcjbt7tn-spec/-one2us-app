import { backendConfigured, supabase } from './lib/supabase'
import { listMatches, loadMessages, markMessagesRead } from './lib/backend'

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
  let refreshing = false
  const readGraceUntil = new Map()
  const lastAckAt = new Map()

  const getMatchName = match => match?.person?.display_name || 'Match'
  const formatListTime = value => {
    if (!value) return ''
    const d = new Date(value)
    const now = new Date()
    return d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  }
  const setText = (el, value) => { if (el && el.textContent !== value) el.textContent = value }
  const scheduleRender = (delay = 80) => {
    clearTimeout(domTimer)
    domTimer = setTimeout(() => { domTimer = null; renderEnhancements() }, delay)
  }
  const debounceRefresh = (delay = 700) => {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(refreshAll, delay)
  }

  async function acknowledgeMatch(matchId, force = false) {
    if (!matchId || !currentUser) return
    const now = Date.now()
    if (!force && now - (lastAckAt.get(matchId) || 0) < 1800) return
    lastAckAt.set(matchId, now)
    readGraceUntil.set(matchId, now + 5000)
    unreadByMatch.set(matchId, 0)
    scheduleRender(10)
    try {
      await markMessagesRead(matchId)
      readGraceUntil.set(matchId, Date.now() + 1800)
    } catch {
      readGraceUntil.delete(matchId)
    } finally {
      debounceRefresh(350)
    }
  }

  async function refreshAll() {
    if (!currentUser || refreshing) return
    refreshing = true
    try {
      const freshMatches = await listMatches()
      const entries = await Promise.all(freshMatches.map(async match => {
        try {
          const rows = await loadMessages(match.id)
          const dbCount = rows.filter(m => m.sender_id !== currentUser.id && !m.read_at).length
          const grace = (readGraceUntil.get(match.id) || 0) > Date.now()
          const chatOpen = activeMatchId === match.id && document.visibilityState === 'visible' && !!document.querySelector('.chat-head')
          return {
            id: match.id,
            count: grace || chatOpen ? 0 : dbCount,
            last: rows.at(-1) || null
          }
        } catch {
          return { id: match.id, count: unreadByMatch.get(match.id) || 0, last: lastMessageByMatch.get(match.id) || null }
        }
      }))
      matches = freshMatches
      unreadByMatch = new Map(entries.map(x => [x.id, x.count]))
      lastMessageByMatch = new Map(entries.map(x => [x.id, x.last]))
      scheduleRender(30)
    } catch {
      // Enhancements must never block the core chat.
    } finally {
      refreshing = false
    }
  }

  function renderNavBadge() {
    const chatsButton = [...document.querySelectorAll('nav.nav.five button')]
      .find(btn => btn.querySelector('span')?.textContent?.trim() === 'Chats')
    if (!chatsButton) return
    const total = [...unreadByMatch.values()].reduce((sum, n) => sum + n, 0)
    let badge = chatsButton.querySelector('.chat-nav-badge')
    if (!total) { badge?.remove(); return }
    if (!badge) { badge = document.createElement('b'); badge.className = 'chat-nav-badge'; chatsButton.appendChild(badge) }
    setText(badge, total > 99 ? '99+' : String(total))
  }

  function renderMatchRows() {
    const buttons = [...document.querySelectorAll('.match-list > button')]
    buttons.forEach((btn, index) => {
      const match = matches[index]
      if (!match) return
      btn.dataset.matchId = match.id
      if (match.person?.id) btn.dataset.personId = match.person.id

      const count = unreadByMatch.get(match.id) || 0
      const last = lastMessageByMatch.get(match.id)
      btn.classList.toggle('has-unread', count > 0)

      let badge = btn.querySelector('.match-unread-badge')
      if (!count) badge?.remove()
      else {
        if (!badge) { badge = document.createElement('b'); badge.className = 'match-unread-badge'; btn.appendChild(badge) }
        setText(badge, count > 99 ? '99+' : String(count))
      }

      const copy = btn.querySelector('span')
      const small = copy?.querySelector('small')
      if (!copy || !small) return
      const text = last ? (last.body || last.message || 'Neue Nachricht') : (match.person?.city || 'One:2:Us')
      const mine = last?.sender_id === currentUser?.id
      setText(small, last ? `${mine ? 'Du: ' : ''}${text}` : `${text} · Chat öffnen`)
      small.classList.toggle('unread-preview', count > 0)

      let time = copy.querySelector('.match-last-time')
      const timeText = formatListTime(last?.created_at)
      if (!timeText) time?.remove()
      else {
        if (!time) { time = document.createElement('em'); time.className = 'match-last-time'; copy.appendChild(time) }
        setText(time, timeText)
      }
    })
  }

  function resolveOpenMatch(head) {
    if (activeMatchId) {
      const byId = matches.find(m => m.id === activeMatchId)
      if (byId) return byId
    }
    const personId = head.dataset.personId
    if (personId) {
      const byPerson = matches.find(m => m.person?.id === personId)
      if (byPerson) return byPerson
    }
    const name = head.querySelector('h2')?.textContent?.trim()
    const found = matches.find(m => name && getMatchName(m) === name)
    return found || (matches.length === 1 ? matches[0] : null)
  }

  function renderChatPresence() {
    const head = document.querySelector('.chat-head')
    if (!head || !currentUser) return
    const status = head.querySelector('div > span')
    if (!status || status.textContent?.includes('schreibt gerade')) return
    const match = resolveOpenMatch(head)
    const otherId = match?.person?.id
    if (!otherId || otherId === currentUser.id) return
    activeMatchId = match.id
    head.dataset.matchId = match.id
    head.dataset.personId = otherId
    if (document.visibilityState === 'visible') acknowledgeMatch(match.id)
    const online = onlineUsers.has(otherId)
    const text = online ? 'online' : (lastSeen.has(otherId) ? 'zuletzt online vor kurzem' : 'offline')
    status.classList.toggle('presence-online', online)
    status.classList.toggle('presence-offline', !online)
    setText(status, text)
  }

  function renderNotificationControl() {
    if (!('Notification' in window) || Notification.permission !== 'default') return
    const title = [...document.querySelectorAll('.page-title')].find(el => el.querySelector('h1')?.textContent?.trim() === 'Deine Matches')
    if (!title || title.querySelector('.notify-enable')) return
    const button = document.createElement('button')
    button.className = 'notify-enable'
    button.type = 'button'
    button.textContent = '🔔 Nachrichten aktivieren'
    button.onclick = async () => { try { await Notification.requestPermission() } finally { button.remove() } }
    title.appendChild(button)
  }

  function renderEnhancements() {
    renderNavBadge()
    renderMatchRows()
    renderChatPresence()
    renderNotificationControl()
  }

  function showIncomingNotification(message) {
    if (!currentUser || message?.sender_id === currentUser.id) return
    if (!('Notification' in window) || Notification.permission !== 'granted' || document.visibilityState === 'visible') return
    const match = matches.find(m => m.id === message.match_id)
    try { new Notification(`One:2:Us · ${getMatchName(match)}`, { body: message.body || message.message || 'Neue Nachricht', tag: `one2us-${message.match_id}` }) } catch {}
  }

  function applyRealtimeMessage(payload) {
    const message = payload.new
    if (!message?.match_id) { debounceRefresh(); return }

    if (payload.eventType === 'INSERT') {
      lastMessageByMatch.set(message.match_id, message)
      const isIncoming = message.sender_id !== currentUser?.id
      const chatIsOpen = activeMatchId === message.match_id && !!document.querySelector('.chat-head') && document.visibilityState === 'visible'
      if (isIncoming && chatIsOpen) acknowledgeMatch(message.match_id, true)
      else if (isIncoming) unreadByMatch.set(message.match_id, (unreadByMatch.get(message.match_id) || 0) + 1)
      showIncomingNotification(message)
      scheduleRender(20)
      debounceRefresh(1200)
      return
    }

    if (payload.eventType === 'UPDATE' && activeMatchId === message.match_id && document.visibilityState === 'visible') {
      unreadByMatch.set(message.match_id, 0)
      readGraceUntil.set(message.match_id, Date.now() + 1200)
      scheduleRender(10)
    }
    debounceRefresh(500)
  }

  function syncPresenceState() {
    if (!presenceChannel) return
    onlineUsers = new Set(Object.keys(presenceChannel.presenceState() || {}))
    scheduleRender(30)
  }
  async function trackPresence() {
    if (!presenceChannel || !currentUser || document.visibilityState === 'hidden') return
    try { await presenceChannel.track({ user_id: currentUser.id, online_at: new Date().toISOString(), visible: true }) } catch {}
  }
  function setupPresence() {
    presenceChannel?.unsubscribe?.()
    clearInterval(heartbeatTimer)
    presenceChannel = supabase.channel('one2us-user-presence-v3', { config: { presence: { key: currentUser.id } } })
      .on('presence', { event: 'sync' }, syncPresenceState)
      .on('presence', { event: 'join' }, ({ key }) => { if (key) onlineUsers.add(key); scheduleRender(30) })
      .on('presence', { event: 'leave' }, ({ key }) => { if (key) { onlineUsers.delete(key); lastSeen.set(key, Date.now()) }; scheduleRender(30) })
      .subscribe(async status => { if (status === 'SUBSCRIBED') { await trackPresence(); syncPresenceState() } })
    heartbeatTimer = setInterval(trackPresence, 30000)
  }
  function setupMessageObserver() {
    messagesChannel?.unsubscribe?.()
    messagesChannel = supabase.channel(`one2us-global-messages-v3-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, applyRealtimeMessage)
      .subscribe()
  }

  const domObserver = new MutationObserver(mutations => {
    if (mutations.some(m => m.addedNodes.length || m.removedNodes.length)) scheduleRender(100)
  })
  domObserver.observe(document.getElementById('root') || document.body, { childList: true, subtree: true })

  document.addEventListener('click', event => {
    const matchButton = event.target.closest?.('.match-list > button')
    if (matchButton?.dataset?.matchId) {
      activeMatchId = matchButton.dataset.matchId
      acknowledgeMatch(activeMatchId, true)
    }
    const chatsNav = event.target.closest?.('nav.nav.five button')
    if (chatsNav?.querySelector('span')?.textContent?.trim() === 'Chats') {
      activeMatchId = null
      debounceRefresh(80)
    }
  }, true)

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      trackPresence()
      if (activeMatchId && document.querySelector('.chat-head')) acknowledgeMatch(activeMatchId, true)
      debounceRefresh(120)
      scheduleRender(40)
    }
  })
  window.addEventListener('focus', () => {
    trackPresence()
    if (activeMatchId && document.querySelector('.chat-head')) acknowledgeMatch(activeMatchId)
    debounceRefresh(120)
    scheduleRender(40)
  })

  async function start(session) {
    currentUser = session?.user || null
    if (!currentUser) return
    await refreshAll()
    setupPresence()
    setupMessageObserver()
    scheduleRender(20)
  }

  supabase.auth.getSession().then(({ data }) => start(data.session))
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user?.id === currentUser?.id) return
    currentUser = session?.user || null
    unreadByMatch = new Map(); lastMessageByMatch = new Map(); matches = []; onlineUsers = new Set(); activeMatchId = null
    readGraceUntil.clear(); lastAckAt.clear()
    presenceChannel?.unsubscribe?.(); messagesChannel?.unsubscribe?.(); clearInterval(heartbeatTimer)
    if (session) start(session); else scheduleRender()
  })
}
