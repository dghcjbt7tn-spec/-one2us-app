// Single-controller WhatsApp-style chat scrolling for iOS/Safari.
// No polling loop: the old 80ms bottom lock caused visible jitter.
let lastChatKey = null
let settleTimer = null
let userScrolledAway = false

function chatIsOpen() {
  return !!document.querySelector('.chat-head') && !!document.querySelector('.chat-box') && !!document.querySelector('.chat-input')
}

function chatKey() {
  const head = document.querySelector('.chat-head')
  return head?.dataset?.matchId || head?.dataset?.personId || head?.querySelector('h2')?.textContent?.trim() || 'chat'
}

function scrollingRoot() {
  return document.scrollingElement || document.documentElement
}

function scrollParents(el) {
  const result = []
  let node = el?.parentElement
  while (node && node !== document.body) {
    const style = getComputedStyle(node)
    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 2) result.push(node)
    node = node.parentElement
  }
  const doc = scrollingRoot()
  if (doc) result.push(doc)
  return [...new Set(result)]
}

const nativeScrollIntoView = Element.prototype.scrollIntoView

function forceBottom(behavior = 'auto') {
  if (!chatIsOpen()) return
  const input = document.querySelector('.chat-input')
  if (!input) return

  try { nativeScrollIntoView.call(input, { behavior, block: 'end', inline: 'nearest' }) } catch { nativeScrollIntoView.call(input, false) }
  requestAnimationFrame(() => {
    for (const scroller of scrollParents(input)) scroller.scrollTop = scroller.scrollHeight
  })
}

function scheduleBottom(delay = 140) {
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    settleTimer = null
    if (!userScrolledAway) forceBottom('auto')
  }, delay)
}

function distanceFromBottom() {
  const input = document.querySelector('.chat-input')
  if (!input) return 9999
  const vv = window.visualViewport
  const viewportBottom = (vv?.offsetTop || 0) + (vv?.height || window.innerHeight)
  return Math.max(0, input.getBoundingClientRect().bottom - viewportBottom)
}

// The enhancement runtime still calls scrollIntoView on the last bubble.
// Suppress those calls permanently so only the composer controls the bottom position.
Element.prototype.scrollIntoView = function(options) {
  if (this?.matches?.('.chat-box .bubble') && chatIsOpen()) return
  return nativeScrollIntoView.call(this, options)
}

const observer = new MutationObserver(mutations => {
  if (!chatIsOpen()) {
    lastChatKey = null
    userScrolledAway = false
    clearTimeout(settleTimer)
    return
  }

  const key = chatKey()
  if (key !== lastChatKey) {
    lastChatKey = key
    userScrolledAway = false
    scheduleBottom(180)
    return
  }

  const bubbleChanged = mutations.some(m => [...m.addedNodes].some(node =>
    node.nodeType === 1 && (node.matches?.('.bubble') || node.querySelector?.('.bubble'))
  ))
  if (bubbleChanged && !userScrolledAway) scheduleBottom(120)
})

observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true })

document.addEventListener('click', event => {
  if (event.target.closest?.('.match-list > button')) {
    lastChatKey = null
    userScrolledAway = false
    scheduleBottom(180)
  }

  const jump = event.target.closest?.('.chat-jump-latest')
  if (jump) {
    event.preventDefault()
    event.stopImmediatePropagation()
    userScrolledAway = false
    forceBottom('smooth')
  }
}, true)

window.addEventListener('scroll', () => {
  if (!chatIsOpen()) return
  userScrolledAway = distanceFromBottom() > 220
}, { passive: true })

window.visualViewport?.addEventListener('resize', () => {
  if (!chatIsOpen() || userScrolledAway) return
  scheduleBottom(120)
})
