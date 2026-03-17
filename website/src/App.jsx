import { useRef, useState, useEffect, useCallback } from 'react'
import Hero from './components/Hero'
import AppMockup from './components/AppMockup'
import Features from './components/Features'
import TechStack from './components/TechStack'
import Footer from './components/Footer'

export function useInView(options = {}) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15, ...options }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, inView]
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('pu-landing-theme')
    return saved || 'dark'
  })

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('pu-landing-theme', theme)
  }, [theme])

  const isLight = theme === 'light'

  return (
    <div className="landing">
      <div className="site-theme-toggle" onClick={toggleTheme}>
        <span className={`site-theme-btn ${isLight ? 'active' : ''}`}>☀</span>
        <span className={`site-theme-btn ${!isLight ? 'active' : ''}`}>☾</span>
      </div>
      <Hero />
      <AppMockup theme={theme} onToggleTheme={toggleTheme} />
      <Features />
      <TechStack />
      <Footer />
    </div>
  )
}
