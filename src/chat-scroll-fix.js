// iOS/Safari chat bottom lock.
// React, Supabase and the enhancement runtime can still change layout for a
// short time after a chat opens. During that opening window we pin the real
// scroll container to the composer so a delayed render cannot pull the view
// back up. After the window ends, manual scrolling is untouched.
let lastChatKey = null
let lockTimer = null
let lockInterval = null
let lockUntil = 0
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

function forceBottom() {
  if (!chatIsOpen()) return
  const input = document.querySelector('.chat-input')
  if (!input) return

  try { nativeScrollIntoView.call(input, { behavior: 'auto', block: 'end', inline: 'nearest' }) } catch { nativeScrollIntoView.call(input, false) }

  requestAnimationFrame(() => {
    for (const scroller of scrollParents(input)) scroller.scrollTop = scroller.scrollHeight
    const doc = scrollingRoot()
    if (doc) window.scrollTo(0, doc.scrollHeight)
  })
}

function stopBottomLock() {
  clearTimeout(lockTimer)
  clearInterval(lockInterval)
  lockTimer = null
  lockInterval = null
  lockUntil = 0
}

function startBottomLock(duration = 3400) {
  stopBottomLock()
  lockUntil = Date.now() + duration
  userScrolledAway = false
  forceBottom()

  // Presence/read-state/Supabase updates can arrive 1–2 seconds after opening.
  // Keep the composer pinned through that settling period so there is no late
  // jump upward. This is intentionally short-lived.
  lockInterval = setInterval(() => {
    if (!chatIsOpen() || Date.now() >= lockUntil) {
      stopBottomLock()
      return
    }
    forceBottom()
  }, 80)

  lockTimer = setTimeout(stopBottomLock, duration + 100)
}

function distanceFromBottom() {
  const input = document.querySelector('.chat-input')
  if (!input) return 9999
  const vv = window.visualViewport
  const viewportBottom = (vv?.offsetTop || 0) + (vv?.height || window.innerHeight)
  return Math.max(0, input.getBoundingClientRect().bottom - viewportBottom)
}

// While the chat is settling, redirect any legacy bubble scroll to the real
// bottom anchor instead of allowing it to move the viewport upward.
Element.prototype.scrollIntoView = function(options) {
  const isChatBubble = this?.matches?.('.chat-box .bubble')
  if (isChatBubble && chatIsOpen() && Date.now() < lockUntil) {
    requestAnimationFrame(forceBottom)
    return
  }
  return nativeScrollIntoView.call(this, options)
}

const observer = new MutationObserver(mutations => {
  if (!chatIsOpen()) {
    lastChatKey = null
    userScrolledAway = false
    stopBottomLock()
    return
  }

  const key = chatKey()
  if (key !== lastChatKey) {
    lastChatKey = key
    startBottomLock()
    return
  }

  const bubbleChanged = mutations.some(m => [...m.addedNodes].some(node =>
    node.nodeType === 1 && (node.matches?.('.bubble') || node.querySelector?.('.bubble'))
  ))
  if (bubbleChanged && Date.now() < lockUntil) requestAnimationFrame(forceBottom)
})

observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true })

document.addEventListener('click', event => {
  if (event.target.closest?.('.match-list > button')) {
    lastChatKey = null
    setTimeout(() => { if (chatIsOpen()) startBottomLock() }, 90)
  }
}, true)

window.addEventListener('scroll', () => {
  if (!chatIsOpen()) return
  if (Date.now() < lockUntil) {
    requestAnimationFrame(forceBottom)
    return
  }
  userScrolledAway = distanceFromBottom() > 220
}, { passive: true })

window.visualViewport?.addEventListener('resize', () => {
  if (!chatIsOpen()) return
  if (Date.now() < lockUntil || !userScrolledAway) requestAnimationFrame(forceBottom)
})
