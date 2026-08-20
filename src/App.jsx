import { useMemo, useState } from 'react'

const profiles = [
  { name: 'Lea', age: 31, city: 'Frankfurt', match: 94, tags: ['Live-Musik', 'Weekend Trips', 'Food'], quote: 'Lieber ein richtig gutes Date als 200 Chats.', emoji: '✨' },
  { name: 'Mara', age: 29, city: 'Heidelberg', match: 91, tags: ['Running', 'Wine', 'Design'], quote: 'Spontan nach Italien? Bin dabei.', emoji: '☀️' },
  { name: 'Nina', age: 33, city: 'Mainz', match: 88, tags: ['Rock', 'Dogs', 'Travel'], quote: 'Humor, Haltung und ein bisschen Chaos.', emoji: '⚡' }
]

const events = [
  { day: '28', month: 'AUG', title: 'ONE NIGHT Frankfurt', meta: 'Rooftop · 80 Singles · 25–40', price: '19 €' },
  { day: '05', month: 'SEP', title: '2:US Dinner Club', meta: 'Private Dining · 24 Singles', price: '29 €' },
  { day: '12', month: 'SEP', title: 'Sunday Walk & Coffee', meta: 'Easy Match · Frankfurt', price: '9 €' }
]

function Logo() {
  return <div className="logo"><span>ONE</span><b>:2:</b><span>US</span></div>
}

function App() {
  const [tab, setTab] = useState('discover')
  const [index, setIndex] = useState(0)
  const [credits, setCredits] = useState(12)
  const [toast, setToast] = useState('')
  const [liked, setLiked] = useState([])
  const profile = profiles[index % profiles.length]

  const title = useMemo(() => ({ discover: 'Discover', events: 'Events', wallet: 'Wallet', profile: 'You' }[tab]), [tab])

  function flash(message) {
    setToast(message)
    window.setTimeout(() => setToast(''), 1700)
  }

  function next() {
    setIndex((v) => (v + 1) % profiles.length)
  }

  function like() {
    if (credits < 1) return flash('Keine Credits mehr – Wallet öffnen.')
    setCredits((v) => v - 1)
    setLiked((v) => [...new Set([...v, profile.name])])
    flash(`${profile.name} geliked · 1 Credit`)
    next()
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <main className="phone">
        <header className="topbar">
          <Logo />
          <button className="credit-pill" onClick={() => setTab('wallet')}><span>●</span>{credits} Credits</button>
        </header>

        <section className="content">
          <div className="section-head">
            <div>
              <p className="eyebrow">ONE:2:US</p>
              <h1>{title}</h1>
            </div>
            {tab === 'discover' && <button className="icon-btn" aria-label="Filter">☷</button>}
          </div>

          {tab === 'discover' && (
            <div className="discover-view">
              <div className="promise"><span>✦</span><div><b>Weniger swipen. Besser treffen.</b><small>3 kuratierte Vorschläge pro Tag.</small></div></div>
              <article className="profile-card">
                <div className="profile-visual">
                  <div className="big-emoji">{profile.emoji}</div>
                  <div className="match-badge">{profile.match}% MATCH</div>
                  <div className="photo-copy">
                    <h2>{profile.name}, {profile.age}</h2>
                    <p>⌖ {profile.city}</p>
                  </div>
                </div>
                <div className="profile-info">
                  <p className="quote">“{profile.quote}”</p>
                  <div className="tags">{profile.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                </div>
              </article>
              <div className="actions">
                <button className="pass" onClick={next}>×</button>
                <button className="super" onClick={() => flash('Boost vorgemerkt · 2 Credits')}>✦</button>
                <button className="like" onClick={like}>♥</button>
              </div>
              <p className="microcopy">Like = 1 Credit · Match & Chat danach kostenlos</p>
            </div>
          )}

          {tab === 'events' && (
            <div className="list-view">
              <div className="hero-card event-hero"><span>REAL LIFE &gt; SMALL TALK</span><h2>Dates beginnen nicht im Chat.</h2><p>Kuratiert, lokal und bewusst klein.</p></div>
              {events.map((event) => (
                <button className="event-row" key={event.title} onClick={() => flash(`${event.title} ausgewählt`)}>
                  <div className="date-box"><b>{event.day}</b><span>{event.month}</span></div>
                  <div className="event-copy"><b>{event.title}</b><span>{event.meta}</span></div>
                  <strong>{event.price}</strong>
                </button>
              ))}
            </div>
          )}

          {tab === 'wallet' && (
            <div className="list-view">
              <div className="wallet-card"><p>Dein Guthaben</p><div><strong>{credits}</strong><span>Credits</span></div><small>Keine Abos. Kein Kleingedrucktes.</small></div>
              <div className="price-grid">
                {[['10', '9,90 €'], ['25', '19,90 €'], ['60', '39,90 €']].map(([amount, price], i) => (
                  <button key={amount} className={i === 1 ? 'price active' : 'price'} onClick={() => { setCredits((v) => v + Number(amount)); flash(`${amount} Demo-Credits hinzugefügt`) }}>
                    {i === 1 && <em>POPULAR</em>}<b>{amount}</b><span>Credits</span><strong>{price}</strong>
                  </button>
                ))}
              </div>
              <div className="costs"><h3>Was kostet was?</h3><p><span>♥ Like senden</span><b>1 Credit</b></p><p><span>✦ Profil boosten</span><b>2 Credits</b></p><p><span>💬 Chat nach Match</span><b>0 Credits</b></p></div>
            </div>
          )}

          {tab === 'profile' && (
            <div className="list-view">
              <div className="user-card"><div className="avatar">YOU</div><h2>Dein Profil</h2><p>Frankfurt · verifiziert</p><button onClick={() => flash('Profil-Editor folgt im nächsten Sprint')}>Profil bearbeiten</button></div>
              <div className="stats"><div><b>{liked.length}</b><span>Likes heute</span></div><div><b>3</b><span>Matches</span></div><div><b>1</b><span>Event</span></div></div>
              <div className="settings"><button>Dating-Präferenzen <span>›</span></button><button>Sicherheit & Verifizierung <span>›</span></button><button>Datenschutz <span>›</span></button></div>
            </div>
          )}
        </section>

        <nav className="nav">
          <button className={tab === 'discover' ? 'active' : ''} onClick={() => setTab('discover')}><span>◇</span>Discover</button>
          <button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}><span>◉</span>Events</button>
          <button className={tab === 'wallet' ? 'active' : ''} onClick={() => setTab('wallet')}><span>◫</span>Wallet</button>
          <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}><span>○</span>You</button>
        </nav>
        {toast && <div className="toast">{toast}</div>}
      </main>
    </div>
  )
}

export default App
