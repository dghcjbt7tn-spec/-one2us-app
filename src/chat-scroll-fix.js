// Robust iOS/Safari chat bottom positioning.
// The app can scroll in more than one container on mobile, while Safari's
// visual viewport is smaller than the layout viewport. We therefore scroll
// every real scroll parent and reserve visible space for the browser chrome.
let lastChatKey = null
let settleTimer = null
let opening = false
let userScrolledAway = false

function chatIsOpen() {
  return !!document.querySelector('.chat-head') && !!document.querySelector('.chat-box') && !!document.querySelector('.chat-input')
}

function chatKey() {
  const head = document.querySelector('.chat-head')
  return head?.dataset?.matchId || head?.dataset?.personId || head?.querySelector('h2')?.textContent?.trim() || 'chat'
}

function scrollParents(el) {
  const result = []
  let node = el?.parentElement
  while (node && node !== document.body) {
    const style = getComputedStyle(node)
    const y = style.overflowY
    if ((y === 'auto' || y === 'scroll') && node.scrollHeight > node.clientHeight + 2) result.push(node)
    node = node.parentElement
  }
  const doc = document.scrollingElement || document.documentElement
  if (doc) result.push(doc)
  return [...new Set(result)]
}

function browserChromeInset() {
  const vv = window.visualViewport
  if (!vv) return 0
  // Difference between layout and visual viewport is mostly Safari chrome /
  // keyboard. Clamp it so we do not create giant jumps when keyboard opens.
  return Math.max(0, Math.min(180, window.innerHeight - vv.height - vv.offsetTop))
}

function forceBottom() {
  if (!chatIsOpen()) return
  const input = document.querySelector('.chat-input')
  const box = document.querySelector('.chat-box')
  const target = input || box
  if (!target) return

  // First make the actual composer the anchor, not just the last bubble.
  try { target.scrollIntoView({ behavior: 'auto', block: 'end', inline: 'nearest' }) } catch { target.scrollIntoView(false) }

  requestAnimationFrame(() => {
    const inset = browserChromeInset()
    for (const scroller of scrollParents(target)) {
      scroller.scrollTop = scroller.scrollHeight + inset
    }
    window.scrollTo(0, (document.scrollingElement || document.documentElement).scrollHeight + inset)
  })
}

function settleToBottom() {
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    settleTimer = null
    forceBottom()
    // One final correction after Safari has finished collapsing/expanding its bars.
    setTimeout(forceBottom, 180)
  }, 100)
}

function distanceFromBottom() {
  const input = document.querySelector('.chat-input')
  if (!input) return 9999
  const vv = window.visualViewport
  const viewportBottom = (vv?.offsetTop || 0) + (vv?.height || window.innerHeight)
  return Math.max(0, input.getBoundingClientRect().bottom - viewportBottom)
}

const observer = new MutationObserver(mutations => {
  if (!chatIsOpen()) {
    lastChatKey = null
    opening = false
    userScrolledAway = false
    clearTimeout(settleTimer)
    return
  }

  const key = chatKey()
  if (key !== lastChatKey) {
    lastChatKey = key
    opening = true
    userScrolledAway = false
    settleToBottom()
    setTimeout(() => { opening = false }, 1600)
    return
  }

  const bubbleChanged = mutations.some(m => [...m.addedNodes].some(node =>
    node.nodeType === 1 && (node.matches?.('.bubble') || node.querySelector?.('.bubble'))
  ))
  if (!bubbleChanged) return

  if (opening || !userScrolledAway) settleToBottom()
})

observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true })

document.addEventListener('click', event => {
  if (event.target.closest?.('.match-list > button')) {
    lastChatKey = null
    opening = true
    userScrolledAway = false
    setTimeout(settleToBottom, 120)
  }
}, true)

window.addEventListener('scroll', () => {
  if (!chatIsOpen() || opening) return
  userScrolledAway = distanceFromBottom() > 220
}, { passive: true })

window.visualViewport?.addEventListener('resize', () => {
  if (!chatIsOpen()) return
  if (opening || !userScrolledAway) settleToBottom()
})
