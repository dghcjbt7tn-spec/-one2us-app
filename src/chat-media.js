import { supabase } from './lib/supabase'
import { sendMessage } from './lib/backend'

const IMAGE_PREFIX = '[[image:'
const signedCache = new Map()
let picker = null
let busy = false

function activeMatchId() {
  return document.querySelector('.chat-head')?.dataset?.matchId || null
}

function ensurePicker() {
  if (picker) return picker
  picker = document.createElement('input')
  picker.type = 'file'
  picker.accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif'
  picker.hidden = true
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0]
    picker.value = ''
    if (!file) return
    await uploadImage(file)
  })
  document.body.appendChild(picker)
  return picker
}

function toast(text, error = false) {
  let el = document.querySelector('.chat-media-toast')
  if (!el) {
    el = document.createElement('div')
    el.className = 'chat-media-toast'
    document.body.appendChild(el)
  }
  el.classList.toggle('error', error)
  el.textContent = text
  clearTimeout(el._timer)
  el._timer = setTimeout(() => el.remove(), 2200)
}

async function uploadImage(file) {
  const matchId = activeMatchId()
  if (!matchId || busy) return
  if (!file.type.startsWith('image/')) return toast('Bitte ein Foto auswählen.', true)
  if (file.size > 8 * 1024 * 1024) return toast('Foto ist zu groß · maximal 8 MB.', true)

  busy = true
  document.querySelector('.chat-attach-btn')?.classList.add('is-uploading')
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Nicht angemeldet')
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${matchId}/${user.id}/${crypto.randomUUID()}.${ext}`
    const { error: uploadError } = await supabase.storage.from('chat-media').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type
    })
    if (uploadError) throw uploadError
    try {
      await sendMessage(matchId, `${IMAGE_PREFIX}${path}]]`)
      toast('Foto gesendet ✓')
    } catch (error) {
      await supabase.storage.from('chat-media').remove([path]).catch(() => {})
      throw error
    }
  } catch (error) {
    console.warn(error)
    toast('Foto konnte nicht gesendet werden.', true)
  } finally {
    busy = false
    document.querySelector('.chat-attach-btn')?.classList.remove('is-uploading')
  }
}

function imagePath(text) {
  if (!text?.startsWith(IMAGE_PREFIX) || !text.endsWith(']]')) return null
  return text.slice(IMAGE_PREFIX.length, -2)
}

async function signedUrl(path) {
  const cached = signedCache.get(path)
  if (cached && cached.expires > Date.now()) return cached.url
  const { data, error } = await supabase.storage.from('chat-media').createSignedUrl(path, 3600)
  if (error) throw error
  signedCache.set(path, { url: data.signedUrl, expires: Date.now() + 50 * 60 * 1000 })
  return data.signedUrl
}

function renderMedia() {
  document.querySelectorAll('.bubble-text').forEach(async textEl => {
    const path = imagePath(textEl.textContent?.trim())
    if (!path || textEl.dataset.mediaPath === path) return
    textEl.dataset.mediaPath = path
    textEl.textContent = ''
    const frame = document.createElement('div')
    frame.className = 'chat-image-frame loading'
    frame.textContent = 'Foto wird geladen …'
    textEl.appendChild(frame)
    try {
      const url = await signedUrl(path)
      if (textEl.dataset.mediaPath !== path) return
      const img = document.createElement('img')
      img.className = 'chat-image'
      img.alt = 'Gesendetes Foto'
      img.loading = 'lazy'
      img.src = url
      img.addEventListener('load', () => frame.replaceWith(img), { once: true })
      img.addEventListener('error', () => { frame.classList.remove('loading'); frame.textContent = 'Foto nicht verfügbar' }, { once: true })
    } catch {
      frame.classList.remove('loading')
      frame.textContent = 'Foto nicht verfügbar'
    }
  })

  document.querySelectorAll('.match-list small').forEach(el => {
    if (el.textContent?.includes(IMAGE_PREFIX)) {
      el.textContent = el.textContent.trim().startsWith('Du:') ? 'Du: 📷 Foto' : '📷 Foto'
    }
  })
}

document.addEventListener('click', event => {
  const button = event.target.closest?.('.chat-attach-btn')
  if (!button) return
  event.preventDefault()
  event.stopImmediatePropagation()
  ensurePicker().click()
}, true)

const observer = new MutationObserver(() => renderMedia())
observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true })
renderMedia()
