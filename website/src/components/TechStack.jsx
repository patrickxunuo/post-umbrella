import { useInView } from '../App'

const tech = [
  { name: 'React 18', color: '#61dafb' },
  { name: 'Vite', color: '#a78bfa' },
  { name: 'Node.js', color: '#22c55e' },
  { name: 'Express', color: '#f59e0b' },
  { name: 'MySQL', color: '#0ea5e9' },
  { name: 'WebSocket', color: '#f43f5e' },
  { name: 'Tauri', color: '#fbbf24' },
]

export default function TechStack() {
  const [ref, inView] = useInView()

  return (
    <section className="tech-section" ref={ref}>
      <div className="tech-inner">
        <p className="section-label">Built With</p>
        <h2 className="section-title">Modern, proven stack</h2>

        <div className="tech-grid">
          {tech.map((t, i) => (
            <div
              key={t.name}
              className={`tech-item ${inView ? 'visible' : ''}`}
              style={{ transitionDelay: `${i * 0.06}s`, transitionDuration: '0.5s' }}
            >
              <span className="tech-dot" style={{ background: t.color }} />
              {t.name}
            </div>
          ))}
        </div>

        <div className="tech-divider" />

        <div className="tech-cta">
          <p>One command to get started. Your data stays on your servers.</p>
          <button className="btn-primary">
            View Documentation
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </section>
  )
}
