// iOS/Safari chat viewport fix.
// On first opening a chat, React/Supabase can render the header before the
// messages arrive. Scrolling immediately therefore lands too high. We keep a
// short "opening" phase and perform ONE debounced bottom jump after the latest
// batch of bubbles has rendered. After that we no longer fight manual scrolling.
let lastChatKey = null
let openingUntil = 0
let bottomTimer = null

function clearBottomTimer() {
  if (bottomTimer) clearTimeout(bottomTimer)
  bottomTimer = null
}

function chatIsOpen() {
  return !!document.querySelector('.chat-head') && !!document.querySelector('.chat-box') && !!document.querySelector('.chat-input')
}

function chatKey() {
  const head = document.querySelector('.chat-head')
  return head?.dataset?.matchId || head?.dataset?.personId || head?.querySelector('h2')?.textContent?.trim() || 'chat'
}

function bottomTarget() {
  // The composer is the real bottom of the WhatsApp-style chat. Scrolling only
  // to the last bubble can leave the input/nav below Safari's visual viewport.
  return document.querySelector('.chat-input') || document.querySelector('.chat-box .bubble:last-of-type')
}

function goToBottom() {
  if (!chatIsOpen()) return
  const target = bottomTarget()
  if (!target) return
  try {
    target.scrollIntoView({ behavior: 'auto', block: 'end', inline: 'nearest' })
  } catch {
    target.scrollIntoView(false)
  }
  // A second direct assignment in the same frame helps iOS when the browser
  // toolbar changes the visual viewport while scrollIntoView is resolving.
  requestAnimationFrame(() => {
    const doc = document.scrollingElement || document.documentElement
    doc.scrollTop = doc.scrollHeight
  })
}

function scheduleBottom(delay = 90) {
  clearBottomTimer()
  bottomTimer = setTimeout(() => {
    bottomTimer = null
    goToBottom()
  }, delay)
}

const observer = new MutationObserver(mutations => {
  if (!chatIsOpen()) {
    lastChatKey = null
    openingUntil = 0
    clearBottomTimer()
    return
  }

  const key = chatKey()
  if (key !== lastChatKey) {
    lastChatKey = key
    openingUntil = Date.now() + 2200
    // Immediate attempt for already-cached chats. Further message hydration is
    // handled by the debounced mutation branch below.
    scheduleBottom(40)
    return
  }

  const addedBubble = mutations.some(m => [...m.addedNodes].some(node =>
    node.nodeType === 1 && (node.matches?.('.bubble') || node.querySelector?.('.bubble'))
  ))
  if (!addedBubble) return

  // During initial hydration always follow the newest rendered batch. Because
  // this is debounced, many bubble inserts result in one final jump, not jitter.
  if (Date.now() < openingUntil) {
    scheduleBottom(120)
    return
  }

  // Once the chat is established, follow new messages only when the user is
  // already close to the bottom or when the new message is their own.
  const doc = document.scrollingElement || document.documentElement
  const viewportHeight = window.visualViewport?.height || window.innerHeight
  const distance = doc.scrollHeight - (doc.scrollTop + viewportHeight)
  const bubbles = document.querySelectorAll('.chat-box .bubble:not(.typing-bubble)')
  const last = bubbles[bubbles.length - 1]
  if (distance < 260 || last?.classList.contains('me')) scheduleBottom(50)
})

observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true })

document.addEventListener('click', event => {
  if (event.target.closest?.('.match-list > button')) {
    lastChatKey = null
    openingUntil = Date.now() + 2200
    scheduleBottom(160)
  }
}, true)

// If the iPhone keyboard opens while the user is already at the bottom, keep
// the composer visible. This is deliberately a single debounced correction.
window.visualViewport?.addEventListener('resize', () => {
  if (!chatIsOpen()) return
  const doc = document.scrollingElement || document.documentElement
  const viewportHeight = window.visualViewport?.height || window.innerHeight
  const distance = doc.scrollHeight - (doc.scrollTop + viewportHeight)
  if (Date.now() < openingUntil || distance < 300) scheduleBottom(100)
})
