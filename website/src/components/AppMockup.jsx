import { useState, useCallback } from 'react'
import { useInView } from '../App'

function JsonLine({ num, children }) {
  return (
    <div>
      <span className="json-line-num">{num}</span>
      {children}
    </div>
  )
}

function K({ children }) { return <span className="json-key">"{children}"</span> }
function S({ children }) { return <span className="json-string">"{children}"</span> }
function P({ children }) { return <span className="json-punct">{children}</span> }

function FolderIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 1.5h5A1.5 1.5 0 0114 6v6.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-8z" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.5 }}>
      <path d="M5 6l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// ── Request data for each endpoint ──

const REQUESTS = {
  'post-create-user': {
    id: 'post-create-user',
    method: 'POST',
    methodClass: 'post',
    name: 'Create User',
    collection: 'Users API',
    color: 'var(--method-post)',
    protocol: 'https://',
    host: 'api.example.com',
    path: '/v1/users',
    detailTabs: ['Params', 'Headers', 'Body', 'Auth'],
    activeDetailTab: 'Body',
    headerCount: 3,
    hasBody: true,
    requestBody: (
      <>
        <JsonLine num={1}><P>{'{'}</P></JsonLine>
        <JsonLine num={2}>  <K>name</K><P>: </P><S>Jane Cooper</S><P>,</P></JsonLine>
        <JsonLine num={3}>  <K>email</K><P>: </P><S>jane@example.com</S><P>,</P></JsonLine>
        <JsonLine num={4}>  <K>role</K><P>: </P><S>developer</S></JsonLine>
        <JsonLine num={5}><P>{'}'}</P></JsonLine>
      </>
    ),
    responseStatus: '201 Created',
    responseStatusClass: 'success',
    responseTime: '245 ms',
    responseSize: '184 B',
    responseHeaderCount: 7,
    responseBody: (
      <>
        <JsonLine num={1}><P>{'{'}</P></JsonLine>
        <JsonLine num={2}>  <K>id</K><P>: </P><S>usr_a1b2c3d4</S><P>,</P></JsonLine>
        <JsonLine num={3}>  <K>name</K><P>: </P><S>Jane Cooper</S><P>,</P></JsonLine>
        <JsonLine num={4}>  <K>email</K><P>: </P><S>jane@example.com</S><P>,</P></JsonLine>
        <JsonLine num={5}>  <K>role</K><P>: </P><S>developer</S><P>,</P></JsonLine>
        <JsonLine num={6}>  <K>created_at</K><P>: </P><S>2025-03-15T10:30:00Z</S></JsonLine>
        <JsonLine num={7}><P>{'}'}</P></JsonLine>
      </>
    ),
  },
  'get-list-users': {
    id: 'get-list-users',
    method: 'GET',
    methodClass: 'get',
    name: 'List Users',
    collection: 'Users API',
    color: 'var(--method-get)',
    protocol: 'https://',
    host: 'api.example.com',
    path: '/v1/users',
    detailTabs: ['Params', 'Headers', 'Body', 'Auth'],
    activeDetailTab: 'Params',
    headerCount: 2,
    hasBody: false,
    requestBody: (
      <>
        <JsonLine num={1}><span className="json-punct" style={{ opacity: 0.35, fontStyle: 'italic' }}>No body</span></JsonLine>
      </>
    ),
    responseStatus: '200 OK',
    responseStatusClass: 'success',
    responseTime: '132 ms',
    responseSize: '1.2 KB',
    responseHeaderCount: 5,
    responseBody: (
      <>
        <JsonLine num={1}><P>[</P></JsonLine>
        <JsonLine num={2}>  <P>{'{'}</P></JsonLine>
        <JsonLine num={3}>    <K>id</K><P>: </P><S>usr_a1b2c3d4</S><P>,</P></JsonLine>
        <JsonLine num={4}>    <K>name</K><P>: </P><S>Jane Cooper</S><P>,</P></JsonLine>
        <JsonLine num={5}>    <K>email</K><P>: </P><S>jane@example.com</S></JsonLine>
        <JsonLine num={6}>  <P>{'}'}</P><P>,</P></JsonLine>
        <JsonLine num={7}>  <P>{'{'}</P></JsonLine>
        <JsonLine num={8}>    <K>id</K><P>: </P><S>usr_e5f6g7h8</S><P>,</P></JsonLine>
        <JsonLine num={9}>    <K>name</K><P>: </P><S>Alex Liu</S><P>,</P></JsonLine>
        <JsonLine num={10}>    <K>email</K><P>: </P><S>alex@example.com</S></JsonLine>
        <JsonLine num={11}>  <P>{'}'}</P></JsonLine>
        <JsonLine num={12}><P>]</P></JsonLine>
      </>
    ),
  },
  'post-login': {
    id: 'post-login',
    method: 'POST',
    methodClass: 'post',
    name: 'Login',
    collection: 'Authentication',
    color: 'var(--method-post)',
    protocol: 'https://',
    host: 'api.example.com',
    path: '/v1/auth/login',
    detailTabs: ['Params', 'Headers', 'Body', 'Auth'],
    activeDetailTab: 'Body',
    headerCount: 1,
    hasBody: true,
    requestBody: (
      <>
        <JsonLine num={1}><P>{'{'}</P></JsonLine>
        <JsonLine num={2}>  <K>email</K><P>: </P><S>jane@example.com</S><P>,</P></JsonLine>
        <JsonLine num={3}>  <K>password</K><P>: </P><S>{'••••••••'}</S></JsonLine>
        <JsonLine num={4}><P>{'}'}</P></JsonLine>
      </>
    ),
    responseStatus: '200 OK',
    responseStatusClass: 'success',
    responseTime: '89 ms',
    responseSize: '256 B',
    responseHeaderCount: 4,
    responseBody: (
      <>
        <JsonLine num={1}><P>{'{'}</P></JsonLine>
        <JsonLine num={2}>  <K>token</K><P>: </P><S>eyJhbGciOiJIUzI1NiIs...</S><P>,</P></JsonLine>
        <JsonLine num={3}>  <K>expires_in</K><P>: </P><span className="json-number">3600</span><P>,</P></JsonLine>
        <JsonLine num={4}>  <K>user</K><P>: </P><P>{'{'}</P></JsonLine>
        <JsonLine num={5}>    <K>id</K><P>: </P><S>usr_a1b2c3d4</S><P>,</P></JsonLine>
        <JsonLine num={6}>    <K>name</K><P>: </P><S>Jane Cooper</S></JsonLine>
        <JsonLine num={7}>  <P>{'}'}</P></JsonLine>
        <JsonLine num={8}><P>{'}'}</P></JsonLine>
      </>
    ),
  },
}

const COLLECTIONS = [
  {
    name: 'Users API',
    requests: ['get-list-users', 'post-create-user', 'get-user'],
  },
  {
    name: 'Authentication',
    requests: ['post-login', 'post-register'],
  },
  {
    name: 'Payments',
    requests: [],
  },
]

// Static entries that aren't fully interactive
const STATIC_REQUESTS = {
  'get-user': { method: 'GET', name: 'Get User', color: 'var(--method-get)' },
  'post-register': { method: 'POST', name: 'Register', color: 'var(--method-post)' },
}

export default function AppMockup({ theme, onToggleTheme }) {
  const [ref, inView] = useInView({ threshold: 0.05 })

  const isLight = theme === 'light'

  // Active request shown in main panel
  const [activeRequestId, setActiveRequestId] = useState('post-create-user')
  // Open tabs
  const [tabs, setTabs] = useState([
    { id: 'post-create-user' },
    { id: 'get-list-users' },
  ])
  // Which collections are expanded
  const [openCollections, setOpenCollections] = useState({ 'Users API': true, 'Authentication': true, 'Payments': false })
  // Active detail tab per request (overrides default)
  const [detailTabs, setDetailTabs] = useState({})
  // Response detail tab (Body or Headers)
  const [responseDetailTab, setResponseDetailTab] = useState('Body')
  // Send animation
  const [sending, setSending] = useState(false)
  const [showResponse, setShowResponse] = useState(true)

  const activeRequest = REQUESTS[activeRequestId]
  const currentDetailTab = detailTabs[activeRequestId] || activeRequest?.activeDetailTab || 'Body'

  const selectRequest = useCallback((reqId) => {
    if (!REQUESTS[reqId]) return
    setActiveRequestId(reqId)
    setShowResponse(true)
    setSending(false)
    setResponseDetailTab('Body')
    // Add tab if not open
    setTabs(prev => {
      if (prev.some(t => t.id === reqId)) return prev
      return [...prev, { id: reqId }]
    })
  }, [])

  const closeTab = useCallback((e, tabId) => {
    e.stopPropagation()
    setTabs(prev => {
      const next = prev.filter(t => t.id !== tabId)
      if (next.length === 0) return prev // don't close last tab
      if (tabId === activeRequestId) {
        setActiveRequestId(next[next.length - 1].id)
      }
      return next
    })
  }, [activeRequestId])

  const toggleCollection = useCallback((name) => {
    setOpenCollections(prev => ({ ...prev, [name]: !prev[name] }))
  }, [])

  const handleSend = useCallback(() => {
    if (sending) return
    setSending(true)
    setShowResponse(false)
    setTimeout(() => {
      setSending(false)
      setShowResponse(true)
    }, 900)
  }, [sending])

  if (!activeRequest) return null

  return (
    <section className="mockup-section" ref={ref}>
      <div className={`mockup-container ${inView ? 'visible' : ''}`}>
        <div className="mockup-glow" />
        <div className="mockup-window">

          {/* ── App Header ── */}
          <div className="mockup-header">
            <div className="mockup-dots">
              <span /><span /><span />
            </div>
            <div className="mh-left">
              <img src="/umbrella.svg" alt="" className="mh-logo" />
              <span className="mh-title">Post Umbrella</span>
              <div className="mh-workspace">
                <span>My Workspace</span>
                <ChevronIcon />
              </div>
            </div>
            <div className="mh-right">
              <div
                className="mh-theme-toggle clickable"
                onClick={onToggleTheme}
              >
                <span className={`mh-theme-btn ${isLight ? 'active' : ''}`}>☀</span>
                <span className={`mh-theme-btn ${!isLight ? 'active' : ''}`}>☾</span>
              </div>
              <div className="mh-env-pill">
                Production
                <ChevronIcon />
              </div>
              <div className="mh-avatar-group">
                <div className="mh-avatar" style={{ background: '#3b82f6' }}>JC</div>
                <div className="mh-avatar" style={{ background: '#8b5cf6' }}>AL</div>
              </div>
              <div className="mh-user">
                <span>jane@example.com</span>
                <ChevronIcon />
              </div>
            </div>
          </div>

          {/* ── Tab bar ── */}
          <div className="mockup-tabbar">
            {tabs.map(tab => {
              const req = REQUESTS[tab.id]
              if (!req) return null
              return (
                <div
                  className={`m-tab clickable ${tab.id === activeRequestId ? 'active' : ''}`}
                  key={tab.id}
                  onClick={() => selectRequest(tab.id)}
                >
                  <span className="method" style={{ color: req.color }}>{req.method}</span>
                  <span>{req.name}</span>
                  <span className="m-tab-close" onClick={(e) => closeTab(e, tab.id)}>&times;</span>
                </div>
              )
            })}
          </div>

          {/* ── Body ── */}
          <div className="mockup-body">

            {/* Sidebar */}
            <div className="mockup-sidebar">
              <div className="ms-header">
                <span className="ms-label">Collections</span>
                <div className="ms-toolbar">
                  <span className="ms-toolbar-btn">+</span>
                </div>
              </div>
              <div className="ms-search">
                <SearchIcon />
                <span className="ms-search-text">Search requests...</span>
              </div>
              <div className="ms-tree">
                {COLLECTIONS.map((col) => (
                  <div className="ms-collection" key={col.name}>
                    <div
                      className="ms-collection-header clickable"
                      onClick={() => toggleCollection(col.name)}
                    >
                      <span className="ms-arrow">{openCollections[col.name] ? '▾' : '▸'}</span>
                      <FolderIcon />
                      <span className="ms-col-name">{col.name}</span>
                    </div>
                    {openCollections[col.name] && col.requests.map((reqId) => {
                      const req = REQUESTS[reqId] || STATIC_REQUESTS[reqId]
                      if (!req) return null
                      const isInteractive = !!REQUESTS[reqId]
                      return (
                        <div
                          className={`ms-request ${reqId === activeRequestId ? 'selected' : ''} ${isInteractive ? 'clickable' : ''}`}
                          key={reqId}
                          onClick={() => isInteractive && selectRequest(reqId)}
                        >
                          <span className="method-sm" style={{ color: req.color }}>
                            {req.method}
                          </span>
                          <span className="ms-req-name">{req.name}</span>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Main panel */}
            <div className="mockup-main">
              {/* Request */}
              <div className="mockup-request">
                <div className="m-request-bar">
                  <div className="m-method-selector">
                    <span className={`method-badge ${activeRequest.methodClass}`}>{activeRequest.method}</span>
                    <ChevronIcon />
                  </div>
                  <div className="m-url">
                    <span className="protocol">{activeRequest.protocol}</span>
                    <span className="host">{activeRequest.host}</span>
                    <span className="path">{activeRequest.path}</span>
                  </div>
                  <span
                    className={`m-send-btn clickable ${sending ? 'sending' : ''}`}
                    onClick={handleSend}
                  >
                    {sending ? 'Sending...' : 'Send'}
                  </span>
                </div>
                <div className="m-detail-tabs">
                  {activeRequest.detailTabs.map(tab => (
                    <span
                      className={`m-detail-tab clickable ${currentDetailTab === tab ? 'active' : ''}`}
                      key={tab}
                      onClick={() => setDetailTabs(prev => ({ ...prev, [activeRequestId]: tab }))}
                    >
                      {tab}
                      {tab === 'Headers' && <span className="count">{activeRequest.headerCount}</span>}
                      {tab === 'Body' && activeRequest.hasBody && <span className="dot" />}
                    </span>
                  ))}
                </div>
                <div className="m-code">
                  {currentDetailTab === 'Body' ? activeRequest.requestBody : (
                    currentDetailTab === 'Headers' ? (
                      <>
                        <JsonLine num={1}><K>Content-Type</K><P>: </P><S>application/json</S></JsonLine>
                        <JsonLine num={2}><K>Accept</K><P>: </P><S>application/json</S></JsonLine>
                        {activeRequest.headerCount >= 3 && (
                          <JsonLine num={3}><K>Authorization</K><P>: </P><S>Bearer {'{{token}}'}</S></JsonLine>
                        )}
                      </>
                    ) : currentDetailTab === 'Auth' ? (
                      <>
                        <JsonLine num={1}><span className="json-punct" style={{ opacity: 0.4 }}>Bearer Token</span></JsonLine>
                        <JsonLine num={2}><K>token</K><P>: </P><S>{'{{auth_token}}'}</S></JsonLine>
                      </>
                    ) : (
                      <>
                        <JsonLine num={1}><span className="json-punct" style={{ opacity: 0.4 }}>Query parameters</span></JsonLine>
                        {activeRequest.methodClass === 'get' && (
                          <>
                            <JsonLine num={2}><K>page</K><P>: </P><span className="json-number">1</span></JsonLine>
                            <JsonLine num={3}><K>limit</K><P>: </P><span className="json-number">20</span></JsonLine>
                          </>
                        )}
                      </>
                    )
                  )}
                </div>
              </div>

              {/* Response */}
              <div className="mockup-response">
                <div className="m-response-toolbar">
                  <div className="m-response-tabs">
                    <span
                      className={`m-detail-tab clickable ${responseDetailTab === 'Body' ? 'active' : ''}`}
                      onClick={() => setResponseDetailTab('Body')}
                    >Body</span>
                    <span
                      className={`m-detail-tab clickable ${responseDetailTab === 'Headers' ? 'active' : ''}`}
                      onClick={() => setResponseDetailTab('Headers')}
                    >Headers <span className="count">{activeRequest.responseHeaderCount}</span></span>
                  </div>
                  <div className="m-response-meta">
                    {showResponse ? (
                      <>
                        <span className={`status-pill ${activeRequest.responseStatusClass}`}>{activeRequest.responseStatus}</span>
                        <span className="response-stat">{activeRequest.responseTime}</span>
                        <span className="response-stat">{activeRequest.responseSize}</span>
                      </>
                    ) : (
                      <span className="response-stat" style={{ opacity: 0.4 }}>Waiting...</span>
                    )}
                  </div>
                </div>
                <div className="m-code">
                  {sending ? (
                    <div className="m-loading">
                      <div className="m-spinner" />
                      <span>Sending request...</span>
                    </div>
                  ) : showResponse ? (
                    responseDetailTab === 'Body' ? activeRequest.responseBody : (
                      <>
                        <JsonLine num={1}><K>content-type</K><P>: </P><S>application/json; charset=utf-8</S></JsonLine>
                        <JsonLine num={2}><K>x-request-id</K><P>: </P><S>req_7f8g9h0i</S></JsonLine>
                        <JsonLine num={3}><K>cache-control</K><P>: </P><S>no-cache</S></JsonLine>
                      </>
                    )
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
