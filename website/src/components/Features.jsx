import { useInView } from '../App'

const features = [
  {
    icon: 'collab',
    svg: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="7" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="13" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M1 17c0-2.76 2.69-5 6-5 1.2 0 2.32.3 3.27.82" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M19 17c0-2.76-2.69-5-6-5-1.2 0-2.32.3-3.27.82" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    title: 'Real-time Collaboration',
    desc: 'See your team\'s changes instantly. WebSocket-powered sync keeps every workspace up to date with live presence indicators.',
  },
  {
    icon: 'collections',
    svg: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="7" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M5 7V5a2 2 0 012-2h6a2 2 0 012 2v2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M8 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    title: 'Collections & Environments',
    desc: 'Organize requests into nested collections. Define environment variables and switch between dev, staging, and production instantly.',
  },
  {
    icon: 'import',
    svg: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M10 3v9M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M3 14v2a2 2 0 002 2h10a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    title: 'Import & Export',
    desc: 'Drop in your Postman collections and start working. Export in standard formats. Paste a cURL command and go.',
  },
  {
    icon: 'selfhost',
    svg: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M10 2l7 4v5.5c0 3.5-2.8 6.2-7 7.5-4.2-1.3-7-4-7-7.5V6l7-4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M7.5 10l2 2 3.5-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    title: 'Self-Hosted & Private',
    desc: 'Your API keys, auth tokens, and data never leave your network. Deploy on your own servers with full control.',
  },
]

export default function Features() {
  const [ref, inView] = useInView()

  return (
    <section className="features-section" ref={ref}>
      <div className="features-header">
        <p className="section-label">Features</p>
        <h2 className="section-title">Everything your team needs</h2>
      </div>

      <div className="features-grid">
        {features.map((f, i) => (
          <div
            key={f.title}
            className={`feature-card ${inView ? 'visible' : ''}`}
            style={{ transitionDelay: `${i * 0.1}s` }}
          >
            <div className={`feature-icon ${f.icon}`}>{f.svg}</div>
            <h3 className="feature-title">{f.title}</h3>
            <p className="feature-desc">{f.desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
