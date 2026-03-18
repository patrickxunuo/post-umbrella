import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

const SECTIONS = [
  { id: 'local-dev', label: 'Local Development' },
  { id: 'deploy-supabase', label: 'Deploy Supabase' },
  { id: 'deploy-frontend', label: 'Deploy Frontend' },
  { id: 'deploy-mcp', label: 'Deploy MCP Server' },
  { id: 'desktop-app', label: 'Desktop App' },
  { id: 'env-reference', label: 'Environment Variables' },
]

function useScrollSpy(ids) {
  const [activeId, setActiveId] = useState(ids[0])

  useEffect(() => {
    const elements = ids.map(id => document.getElementById(id)).filter(Boolean)
    if (!elements.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)

        if (visible.length > 0) {
          setActiveId(visible[0].target.id)
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    )

    elements.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [ids])

  return activeId
}

function Code({ children }) {
  return <code className="gs-inline-code">{children}</code>
}

function CodeBlock({ children, title }) {
  return (
    <div className="gs-code-block">
      {title && <div className="gs-code-title">{title}</div>}
      <pre><code>{children}</code></pre>
    </div>
  )
}

function Note({ children }) {
  return <div className="gs-note">{children}</div>
}

function Step({ number, title, children }) {
  return (
    <div className="gs-step">
      <div className="gs-step-header">
        <span className="gs-step-num">{number}</span>
        <h3>{title}</h3>
      </div>
      <div className="gs-step-content">{children}</div>
    </div>
  )
}

export default function GetStarted() {
  const activeId = useScrollSpy(SECTIONS.map(s => s.id))

  return (
    <div className="gs-page">
      <div className="gs-layout">

        {/* ── Sidebar nav ── */}
        <nav className="gs-sidebar">
          <Link to="/" className="gs-back">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M10 4l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Home
          </Link>
          <div className="gs-nav-title">On this page</div>
          <ul className="gs-nav-list">
            {SECTIONS.map(s => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className={activeId === s.id ? 'active' : ''}
                  onClick={(e) => {
                    e.preventDefault()
                    document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' })
                  }}
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* ── Main content ── */}
        <div className="gs-content">
          <header className="gs-header">
            <h1>Get Started</h1>
            <p>Deploy Post Umbrella on your own infrastructure in a few steps.</p>
          </header>

          {/* Mobile TOC */}
          <nav className="gs-toc-mobile">
            {SECTIONS.map(s => (
              <a key={s.id} href={`#${s.id}`}>{s.label}</a>
            ))}
          </nav>

          {/* ── Section 1: Local Development ── */}
          <section className="gs-section" id="local-dev">
            <h2>Local Development</h2>
            <p>Run everything locally to explore or contribute before deploying.</p>

            <Step number="1" title="Prerequisites">
              <ul>
                <li><a href="https://nodejs.org" target="_blank" rel="noopener noreferrer">Node.js</a> 18+</li>
                <li><a href="https://supabase.com/docs/guides/cli" target="_blank" rel="noopener noreferrer">Supabase CLI</a></li>
                <li><a href="https://docker.com" target="_blank" rel="noopener noreferrer">Docker</a> (for local Supabase)</li>
              </ul>
            </Step>

            <Step number="2" title="Clone and install">
              <CodeBlock>{`git clone https://github.com/patrickxunuo/post-umbrella.git
cd post-umbrella
npm install`}</CodeBlock>
            </Step>

            <Step number="3" title="Start local Supabase">
              <CodeBlock>{`supabase start`}</CodeBlock>
              <p>This spins up a local Supabase instance with Docker. It will output your local credentials:</p>
              <CodeBlock>{`API URL: http://127.0.0.1:54321
anon key: eyJ...
service_role key: eyJ...`}</CodeBlock>
            </Step>

            <Step number="4" title="Configure environment">
              <p>Create a <Code>.env.local</Code> file in the project root:</p>
              <CodeBlock title=".env.local">{`VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=your-anon-key-from-supabase-start
VITE_EMAIL_DOMAIN=              # Optional: restrict signups to a domain`}</CodeBlock>
            </Step>

            <Step number="5" title="Push database migrations">
              <CodeBlock>{`supabase db push`}</CodeBlock>
            </Step>

            <Step number="6" title="Start development">
              <CodeBlock>{`# Start the frontend
npm run dev

# In another terminal, start Edge Functions
supabase functions serve`}</CodeBlock>
              <p>The app will be available at <Code>http://localhost:5173</Code></p>
            </Step>
          </section>

          {/* ── Section 2: Deploy Supabase ── */}
          <section className="gs-section" id="deploy-supabase">
            <h2>Deploy Supabase</h2>
            <p>Supabase handles the database, authentication, realtime subscriptions, and Edge Functions.</p>

            <Step number="1" title="Create a Supabase project">
              <p>Go to <a href="https://supabase.com" target="_blank" rel="noopener noreferrer">supabase.com</a> and create a new project. Note your project URL and anon key from the project settings.</p>
            </Step>

            <Step number="2" title="Link your local project">
              <CodeBlock>{`supabase link --project-ref your-project-ref`}</CodeBlock>
            </Step>

            <Step number="3" title="Push migrations">
              <CodeBlock>{`supabase db push`}</CodeBlock>
              <p>This creates all tables, RLS policies, and functions in your production database.</p>
            </Step>

            <Step number="4" title="Deploy Edge Functions">
              <CodeBlock>{`supabase functions deploy`}</CodeBlock>
              <p>This deploys the HTTP proxy function used to bypass CORS when sending requests.</p>
            </Step>

            <Step number="5" title="Configure Auth redirect URLs">
              <p>In your Supabase dashboard, go to <strong>Authentication &rarr; URL Configuration</strong> and add:</p>
              <CodeBlock>{`# Your frontend URL
https://your-domain.com/*

# If using MCP server
https://your-domain.com/mcp-complete*`}</CodeBlock>
            </Step>
          </section>

          {/* ── Section 3: Deploy Frontend ── */}
          <section className="gs-section" id="deploy-frontend">
            <h2>Deploy Frontend</h2>
            <p>
              The frontend is a standard Vite + React build that outputs static files.
              We recommend <strong>Vercel</strong> for zero-config deployments, but any
              static hosting works — Netlify, Cloudflare Pages, AWS Amplify, or your own server.
            </p>

            <h3>Vercel (recommended)</h3>

            <Step number="1" title="Import your repository">
              <p>Go to <a href="https://vercel.com/new" target="_blank" rel="noopener noreferrer">vercel.com/new</a>, import your GitHub repository, and select the root directory.</p>
            </Step>

            <Step number="2" title="Set environment variables">
              <p>Add these in the Vercel project settings:</p>
              <CodeBlock>{`VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_EMAIL_DOMAIN=@yourcompany.com    # Optional`}</CodeBlock>
            </Step>

            <Step number="3" title="Deploy">
              <p>Vercel will automatically build and deploy on push. The build command is <Code>npm run build</Code> and the output directory is <Code>dist</Code>.</p>
            </Step>

            <Note>
              <strong>Other hosting options:</strong> Any platform that serves static files will work.
              Run <Code>npm run build</Code> and deploy the <Code>dist/</Code> folder.
              Make sure to configure SPA fallback (redirect all routes to <Code>index.html</Code>).
            </Note>
          </section>

          {/* ── Section 4: Deploy MCP Server ── */}
          <section className="gs-section" id="deploy-mcp">
            <h2>Deploy MCP Server</h2>
            <p>
              The MCP server lets AI agents (Claude Code, Codex) interact with your Post Umbrella workspace
              via OAuth-authenticated tool calls. It's a standard Node.js HTTP server.
              We use <strong>Render</strong> as an example, but Fly.io, Railway, a VPS, or any Node.js host works.
            </p>

            <Step number="1" title="Install and build">
              <CodeBlock>{`cd mcp-server
npm install
npm run build`}</CodeBlock>
            </Step>

            <Step number="2" title="Set environment variables">
              <CodeBlock title="Environment variables">{`SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
MCP_BASE_URL=https://your-mcp-domain.com
WEBAPP_URL=https://your-frontend-domain.com
PORT=3100`}</CodeBlock>
            </Step>

            <Step number="3" title="Deploy">
              <p>On Render, create a new <strong>Web Service</strong>, point it to the <Code>mcp-server</Code> directory, and set:</p>
              <ul>
                <li><strong>Build command:</strong> <Code>npm install && npm run build</Code></li>
                <li><strong>Start command:</strong> <Code>node dist/index.js</Code></li>
              </ul>
              <Note>
                The MCP server keeps OAuth session state in memory. Run a <strong>single instance</strong> and avoid scale-to-zero for reliable behavior.
              </Note>
            </Step>

            <Step number="4" title="Connect AI agents">
              <p>Once deployed, connect from your AI tools:</p>
              <CodeBlock title="Claude Code">{`claude mcp add --transport http post-umbrella https://your-mcp-domain.com/mcp`}</CodeBlock>
              <CodeBlock title="Codex">{`codex mcp add postUmbrella --url https://your-mcp-domain.com/mcp`}</CodeBlock>
              <p>The agent will open the browser for OAuth authentication. If you're already signed in, it's a one-click authorize.</p>
            </Step>
          </section>

          {/* ── Section 5: Desktop App ── */}
          <section className="gs-section" id="desktop-app">
            <h2>Desktop App (Tauri)</h2>
            <p>Post Umbrella includes a Tauri-based desktop app for Windows and macOS.</p>

            <h3>Prerequisites</h3>
            <ul>
              <li><a href="https://www.rust-lang.org/tools/install" target="_blank" rel="noopener noreferrer">Rust</a> (latest stable)</li>
              <li>Platform-specific dependencies — see the <a href="https://v2.tauri.app/start/prerequisites/" target="_blank" rel="noopener noreferrer">Tauri v2 prerequisites</a></li>
            </ul>

            <h3>Windows</h3>
            <Step number="1" title="Build the installer">
              <CodeBlock>{`npm run tauri build`}</CodeBlock>
              <p>This produces an <Code>.msi</Code> installer and an <Code>.exe</Code> in <Code>src-tauri/target/release/bundle/</Code>.</p>
            </Step>

            <h3>macOS</h3>
            <Step number="1" title="Build the app bundle">
              <CodeBlock>{`npm run tauri build`}</CodeBlock>
              <p>This produces a <Code>.dmg</Code> and <Code>.app</Code> bundle in <Code>src-tauri/target/release/bundle/</Code>.</p>
            </Step>

            <Note>
              Cross-compilation is not supported — build Windows installers on Windows and macOS bundles on macOS.
              For CI/CD, use GitHub Actions with platform-specific runners.
            </Note>
          </section>

          {/* ── Section 6: Environment Variables Reference ── */}
          <section className="gs-section" id="env-reference">
            <h2>Environment Variables</h2>

            <h3>Frontend</h3>
            <div className="gs-table-wrap">
              <table className="gs-table">
                <thead>
                  <tr>
                    <th>Variable</th>
                    <th>Description</th>
                    <th>Required</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><Code>VITE_SUPABASE_URL</Code></td>
                    <td>Supabase project URL</td>
                    <td>Yes</td>
                  </tr>
                  <tr>
                    <td><Code>VITE_SUPABASE_ANON_KEY</Code></td>
                    <td>Supabase anonymous key</td>
                    <td>Yes</td>
                  </tr>
                  <tr>
                    <td><Code>VITE_EMAIL_DOMAIN</Code></td>
                    <td>Restrict signups to an email domain (e.g. <Code>@company.com</Code>)</td>
                    <td>No</td>
                  </tr>
                  <tr>
                    <td><Code>VITE_SUPABASE_PROXY_URL</Code></td>
                    <td>Custom proxy function URL</td>
                    <td>No</td>
                  </tr>
                  <tr>
                    <td><Code>VITE_APP_URL</Code></td>
                    <td>Canonical web URL for shareable links (required for desktop app)</td>
                    <td>No</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3>MCP Server</h3>
            <div className="gs-table-wrap">
              <table className="gs-table">
                <thead>
                  <tr>
                    <th>Variable</th>
                    <th>Description</th>
                    <th>Required</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><Code>SUPABASE_URL</Code></td>
                    <td>Supabase project URL</td>
                    <td>Yes</td>
                  </tr>
                  <tr>
                    <td><Code>SUPABASE_ANON_KEY</Code></td>
                    <td>Supabase anonymous key</td>
                    <td>Yes</td>
                  </tr>
                  <tr>
                    <td><Code>MCP_BASE_URL</Code></td>
                    <td>Public URL of the MCP server</td>
                    <td>Yes</td>
                  </tr>
                  <tr>
                    <td><Code>WEBAPP_URL</Code></td>
                    <td>Public URL of the frontend</td>
                    <td>Yes</td>
                  </tr>
                  <tr>
                    <td><Code>PORT</Code></td>
                    <td>Server port (default: 3100)</td>
                    <td>No</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <footer className="gs-footer">
            <p>
              Need help? <a href="https://github.com/patrickxunuo/post-umbrella/issues" target="_blank" rel="noopener noreferrer">Open an issue</a> on GitHub.
            </p>
          </footer>
        </div>
      </div>
    </div>
  )
}
