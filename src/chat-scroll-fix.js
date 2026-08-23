// iOS/Safari chat viewport fix: keep the newest message and composer visible
// without repeatedly fighting the user's own scrolling.
let lastChatKey = null
let settleTimers = []

function clearSettleTimers() {
  settleTimers.forEach(clearTimeout)
  settleTimers = []
}

function chatIsOpen() {
  return !!document.querySelector('.chat-head') && !!document.querySelector('.chat-box') && !!document.querySelector('.chat-input')
}

function chatKey() {
  const head = document.querySelector('.chat-head')
  return head?.dataset?.matchId || head?.dataset?.personId || head?.querySelector('h2')?.textContent?.trim() || 'chat'
}

function goToBottom() {
  if (!chatIsOpen()) return
  const doc = document.scrollingElement || document.documentElement
  // Use an immediate document scroll. scrollIntoView on the last bubble can leave
  // the composer below the iOS Safari viewport and smooth scrolling can visibly jitter.
  doc.scrollTop = doc.scrollHeight
  window.scrollTo(0, doc.scrollHeight)
}

function settleAtBottom() {
  clearSettleTimers()
  ;[0, 60, 160, 320].forEach(delay => {
    settleTimers.push(setTimeout(goToBottom, delay))
  })
}

const observer = new MutationObserver(mutations => {
  if (!chatIsOpen()) {
    lastChatKey = null
    clearSettleTimers()
    return
  }

  const key = chatKey()
  if (key !== lastChatKey) {
    lastChatKey = key
    settleAtBottom()
    return
  }

  // When a new bubble is appended, follow it only if the user was already near
  // the bottom (or it is our own outgoing bubble).
  const addedBubble = mutations.some(m => [...m.addedNodes].some(node =>
    node.nodeType === 1 && (node.matches?.('.bubble') || node.querySelector?.('.bubble'))
  ))
  if (!addedBubble) return

  const doc = document.scrollingElement || document.documentElement
  const distance = doc.scrollHeight - (doc.scrollTop + window.innerHeight)
  const bubbles = document.querySelectorAll('.chat-box .bubble:not(.typing-bubble)')
  const last = bubbles[bubbles.length - 1]
  if (distance < 320 || last?.classList.contains('me')) settleAtBottom()
})

observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true })

document.addEventListener('click', event => {
  if (event.target.closest?.('.match-list > button')) {
    lastChatKey = null
    settleTimers.push(setTimeout(settleAtBottom, 40))
  }
}, true)

// Keyboard/visual viewport changes on iPhone can otherwise leave the composer
// just below the visible area.
window.visualViewport?.addEventListener('resize', () => {
  if (!chatIsOpen()) return
  settleTimers.push(setTimeout(goToBottom, 80))
})
