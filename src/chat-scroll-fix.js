// Robust iOS/Safari chat bottom positioning.
// This file is the single authority for initial chat positioning. The main
// runtime also calls scrollIntoView on the last bubble; on iOS that can pull
// the view slightly upward after we already reached the composer. During the
// opening phase we therefore suppress bubble scrollIntoView calls and keep the
// composer as the only bottom anchor.
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
  return Math.max(0, Math.min(180, window.innerHeight - vv.height - vv.offsetTop))
}

function forceBottom() {
  if (!chatIsOpen()) return
  const input = document.querySelector('.chat-input')
  const target = input || document.querySelector('.chat-box')
  if (!target) return

  // Use the native method directly so our bubble guard below cannot interfere.
  try { nativeScrollIntoView.call(target, { behavior: 'auto', block: 'end', inline: 'nearest' }) } catch { nativeScrollIntoView.call(target, false) }

  requestAnimationFrame(() => {
    const inset = browserChromeInset()
    for (const scroller of scrollParents(target)) {
      scroller.scrollTop = scroller.scrollHeight + inset
    }
    const doc = document.scrollingElement || document.documentElement
    window.scrollTo(0, doc.scrollHeight + inset)
  })
}

function settleToBottom(delay = 110) {
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    settleTimer = null
    forceBottom()
  }, delay)
}

function distanceFromBottom() {
  const input = document.querySelector('.chat-input')
  if (!input) return 9999
  const vv = window.visualViewport
  const viewportBottom = (vv?.offsetTop || 0) + (vv?.height || window.innerHeight)
  return Math.max(0, input.getBoundingClientRect().bottom - viewportBottom)
}

// Stop the older runtime from scrolling the last bubble upward just after the
// dedicated iOS bottom fix has positioned the composer correctly.
const nativeScrollIntoView = Element.prototype.scrollIntoView
Element.prototype.scrollIntoView = function(options) {
  const isChatBubble = this?.matches?.('.chat-box .bubble')
  if (isChatBubble && chatIsOpen() && opening) {
    settleToBottom(40)
    return
  }
  return nativeScrollIntoView.call(this, options)
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
    settleToBottom(120)
    setTimeout(() => {
      // Final position once Supabase/React have finished hydrating the chat.
      forceBottom()
      opening = false
    }, 900)
    return
  }

  const bubbleChanged = mutations.some(m => [...m.addedNodes].some(node =>
    node.nodeType === 1 && (node.matches?.('.bubble') || node.querySelector?.('.bubble'))
  ))
  if (!bubbleChanged) return

  if (opening || !userScrolledAway) settleToBottom(90)
})

observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true })

document.addEventListener('click', event => {
  if (event.target.closest?.('.match-list > button')) {
    lastChatKey = null
    opening = true
    userScrolledAway = false
    settleToBottom(180)
  }
}, true)

window.addEventListener('scroll', () => {
  if (!chatIsOpen() || opening) return
  userScrolledAway = distanceFromBottom() > 220
}, { passive: true })

window.visualViewport?.addEventListener('resize', () => {
  if (!chatIsOpen()) return
  if (opening || !userScrolledAway) settleToBottom(120)
})
