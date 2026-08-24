// Lightweight WhatsApp-style chat polish without touching React/Supabase state.
// Groups consecutive messages visually and adds emoji/attachment affordances.
let polishTimer = null

function schedulePolish(delay = 30) {
  clearTimeout(polishTimer)
  polishTimer = setTimeout(polishChat, delay)
}

function polishChat() {
  const box = document.querySelector('.chat-box')
  const input = document.querySelector('.chat-input')
  if (!box || !input) return

  const bubbles = [...box.querySelectorAll('.bubble:not(.typing-bubble)')]
  bubbles.forEach((bubble, i) => {
    bubble.classList.remove('group-start','group-middle','group-end','group-single')
    const side = bubble.classList.contains('me') ? 'me' : 'them'
    const prev = bubbles[i - 1]
    const next = bubbles[i + 1]
    const prevSide = prev ? (prev.classList.contains('me') ? 'me' : 'them') : null
    const nextSide = next ? (next.classList.contains('me') ? 'me' : 'them') : null
    const dividerBefore = bubble.previousElementSibling?.classList.contains('chat-date-divider')
    const nextDivider = next?.previousElementSibling?.classList.contains('chat-date-divider')
    const joinsPrev = !dividerBefore && prevSide === side
    const joinsNext = !nextDivider && nextSide === side
    bubble.classList.add(!joinsPrev && !joinsNext ? 'group-single' : !joinsPrev ? 'group-start' : !joinsNext ? 'group-end' : 'group-middle')
  })

  if (!input.querySelector('.chat-emoji-btn')) {
    const field = input.querySelector('input')
    if (field) {
      const emoji = document.createElement('button')
      emoji.type = 'button'
      emoji.className = 'chat-emoji-btn'
      emoji.setAttribute('aria-label','Emoji einfügen')
      emoji.textContent = '☺'
      emoji.addEventListener('click', () => {
        field.focus()
        const start = field.selectionStart ?? field.value.length
        const end = field.selectionEnd ?? field.value.length
        const value = field.value.slice(0,start) + '😊' + field.value.slice(end)
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set
        setter?.call(field,value)
        field.dispatchEvent(new Event('input',{bubbles:true}))
        requestAnimationFrame(()=>field.setSelectionRange(start+2,start+2))
      })
      input.prepend(emoji)
    }
  }

  if (!input.querySelector('.chat-attach-btn')) {
    const send = input.querySelector('button:not(.chat-emoji-btn)')
    if (send) {
      const attach = document.createElement('button')
      attach.type = 'button'
      attach.className = 'chat-attach-btn'
      attach.setAttribute('aria-label','Anhang')
      attach.textContent = '+'
      attach.addEventListener('click', () => {
        let note = document.querySelector('.chat-feature-note')
        if (!note) {
          note = document.createElement('div')
          note.className = 'chat-feature-note'
          note.textContent = 'Fotos & Anhänge kommen als nächster Schritt.'
          document.querySelector('.chat-head')?.after(note)
        }
        clearTimeout(note._timer)
        note._timer = setTimeout(()=>note.remove(),1800)
      })
      send.before(attach)
    }
  }
}

const observer = new MutationObserver(mutations => {
  if (!document.querySelector('.chat-box')) return
  if (mutations.some(m => m.addedNodes.length || m.removedNodes.length)) schedulePolish()
})
observer.observe(document.getElementById('root') || document.body,{childList:true,subtree:true})
document.addEventListener('click',e=>{if(e.target.closest?.('.match-list > button'))schedulePolish(100)},true)
schedulePolish(100)
