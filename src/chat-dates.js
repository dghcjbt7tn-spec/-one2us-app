import { loadMessages } from './lib/backend'

let renderTimer = null
let renderToken = 0

function dayKey(value) {
  if (!value) return ''
  const d = new Date(value)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabel(value) {
  const d = new Date(value)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  if (dayKey(d) === dayKey(today)) return 'Heute'
  if (dayKey(d) === dayKey(yesterday)) return 'Gestern'
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function scheduleRender(delay = 40) {
  clearTimeout(renderTimer)
  renderTimer = setTimeout(renderDates, delay)
}

async function renderDates() {
  const box = document.querySelector('.chat-box')
  const head = document.querySelector('.chat-head')
  const matchId = head?.dataset?.matchId
  if (!box || !head || !matchId) return

  const token = ++renderToken
  let rows
  try {
    rows = await loadMessages(matchId)
  } catch {
    return
  }
  if (token !== renderToken || !document.body.contains(box)) return

  box.querySelectorAll('.chat-date-divider').forEach(el => el.remove())
  const bubbles = [...box.querySelectorAll('.bubble:not(.typing-bubble)')]
  if (!bubbles.length || !rows?.length) return

  // React and Supabase keep the same chronological order. If one side is still
  // settling, align from the end so the newest messages always get the correct date.
  const offset = Math.max(0, rows.length - bubbles.length)
  let previousDay = null

  bubbles.forEach((bubble, index) => {
    const message = rows[index + offset]
    if (!message?.created_at) return
    const key = dayKey(message.created_at)
    if (key === previousDay) return

    const divider = document.createElement('div')
    divider.className = 'chat-date-divider'
    divider.textContent = dayLabel(message.created_at)
    divider.setAttribute('aria-label', `Nachrichten vom ${divider.textContent}`)
    bubble.before(divider)
    previousDay = key
  })
}

const observer = new MutationObserver(mutations => {
  if (!document.querySelector('.chat-head') || !document.querySelector('.chat-box')) return
  const relevant = mutations.some(m => [...m.addedNodes, ...m.removedNodes].some(node =>
    node.nodeType === 1 && (node.matches?.('.bubble,.chat-head') || node.querySelector?.('.bubble,.chat-head'))
  ))
  if (relevant) scheduleRender(60)
})

observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true })

document.addEventListener('click', event => {
  if (event.target.closest?.('.match-list > button')) scheduleRender(120)
}, true)
