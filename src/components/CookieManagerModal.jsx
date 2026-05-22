import { useEffect, useMemo, useRef, useState } from 'react';
import { Cookie, Plus, Trash2, X, Search } from 'lucide-react';
import useCookieStore from '../stores/cookieStore.js';
import { usePrompt } from './PromptModal.jsx';
import { useConfirm } from './ConfirmModal.jsx';
import { filterDomains, makeCookie } from './cookieManagerUtils.js';

export default function CookieManagerModal({ isOpen, onClose }) {
  const jar = useCookieStore((s) => s.jar);
  const upsert = useCookieStore((s) => s.upsert);
  const removeCookie = useCookieStore((s) => s.removeCookie);
  const removeDomain = useCookieStore((s) => s.removeDomain);

  const prompt = usePrompt();
  const confirm = useConfirm();

  const [search, setSearch] = useState('');
  // Domains the user created that don't yet have any cookies (store only
  // persists domains that contain cookies, so we keep these locally).
  const [pendingDomains, setPendingDomains] = useState([]);
  // Which cookie is currently being edited: { domain, name, path }
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState('');

  const editorRef = useRef(null);

  // Reset transient state whenever the dialog is closed.
  useEffect(() => {
    if (!isOpen) {
      setSearch('');
      setPendingDomains([]);
      setEditing(null);
      setEditValue('');
    }
  }, [isOpen]);

  // Escape closes the dialog (mirrors PromptModal behaviour).
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // Focus the value editor textarea when it opens.
  useEffect(() => {
    if (editing && editorRef.current) {
      editorRef.current.focus();
      editorRef.current.select();
    }
  }, [editing]);

  // Merge jar domains with pending (empty) domains, de-duped, then filter.
  const visibleDomains = useMemo(() => {
    const jarDomains = Object.keys(jar);
    const merged = [...jarDomains];
    for (const d of pendingDomains) {
      if (!merged.includes(d)) merged.push(d);
    }
    return filterDomains(merged, search);
  }, [jar, pendingDomains, search]);

  const totalDomains = useMemo(() => {
    const set = new Set(Object.keys(jar));
    pendingDomains.forEach((d) => set.add(d));
    return set.size;
  }, [jar, pendingDomains]);

  if (!isOpen) return null;

  const handleAddDomain = async () => {
    const raw = await prompt({
      title: 'Add Domain',
      message: 'Enter a domain to store cookies under (e.g. example.com).',
      placeholder: 'example.com',
      confirmText: 'Add',
    });
    if (!raw) return;
    const domain = raw.trim().toLowerCase();
    if (!domain) return;
    setSearch('');
    setPendingDomains((prev) => (prev.includes(domain) ? prev : [...prev, domain]));
  };

  const handleAddCookie = async (domain) => {
    const name = await prompt({
      title: 'Add Cookie',
      message: `New cookie name for ${domain}`,
      placeholder: 'cookie_name',
      confirmText: 'Next',
    });
    if (!name || !name.trim()) return;

    const value = await prompt({
      title: 'Add Cookie',
      message: `Value for "${name.trim()}"`,
      placeholder: 'cookie value',
      confirmText: 'Add',
    });
    // prompt returns null on cancel (it blocks empty/whitespace submits itself).
    if (value === null || value === undefined) return;

    upsert(domain, makeCookie(name.trim(), value));
  };

  const handleRemoveCookie = (domain, name) => {
    if (editing && editing.domain === domain && editing.name === name) {
      setEditing(null);
    }
    removeCookie(domain, name);
  };

  const handleRemoveDomain = async (domain) => {
    const ok = await confirm({
      title: 'Remove Domain',
      message: `Remove all cookies stored under "${domain}"? This cannot be undone.`,
      confirmText: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    if (editing && editing.domain === domain) setEditing(null);
    removeDomain(domain);
    setPendingDomains((prev) => prev.filter((d) => d !== domain));
  };

  const openEditor = (domain, cookie) => {
    setEditing({ domain, name: cookie.name, path: cookie.path });
    setEditValue(cookie.value ?? '');
  };

  const saveEditor = () => {
    if (!editing) return;
    const cookies = jar[editing.domain] || [];
    const target = cookies.find(
      (c) => c.name === editing.name && c.path === editing.path,
    );
    if (target) {
      upsert(editing.domain, { ...target, value: editValue });
    }
    setEditing(null);
  };

  const cancelEditor = () => {
    setEditing(null);
  };

  const isEditing = (domain, cookie) =>
    editing &&
    editing.domain === domain &&
    editing.name === cookie.name &&
    editing.path === cookie.path;

  const hasNoDomains = totalDomains === 0;
  const hasNoMatches = !hasNoDomains && visibleDomains.length === 0;

  return (
    <div
      className="cookie-manager-overlay"
      data-testid="cookie-manager-overlay"
      onClick={onClose}
    >
      <div
        className="cookie-manager-modal"
        data-testid="cookie-manager-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cookie-manager-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cookie-manager-header">
          <div className="cookie-manager-icon">
            <Cookie size={20} />
          </div>
          <h3 id="cookie-manager-title" className="cookie-manager-title">
            Cookie Manager
          </h3>
          <button
            className="cookie-manager-close"
            data-testid="cookie-manager-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="cookie-manager-toolbar">
          <div className="cookie-search-wrap">
            <Search size={14} className="cookie-search-icon" />
            <input
              type="text"
              className="cookie-search-input"
              data-testid="cookie-search"
              placeholder="Search domains"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            className="btn-primary compact cookie-add-domain"
            data-testid="cookie-add-domain"
            onClick={handleAddDomain}
          >
            <Plus size={14} />
            Add domain
          </button>
        </div>

        <div className="cookie-manager-body">
          {hasNoDomains && (
            <div className="cookie-empty" data-testid="cookie-empty">
              <Cookie size={28} className="cookie-empty-icon" />
              <p className="cookie-empty-title">No cookies yet</p>
              <p className="cookie-empty-hint">
                Add a domain to start storing cookies, or send a request that
                returns a Set-Cookie header.
              </p>
            </div>
          )}

          {hasNoMatches && (
            <div className="cookie-empty" data-testid="cookie-empty">
              <Search size={28} className="cookie-empty-icon" />
              <p className="cookie-empty-title">No matching domains</p>
              <p className="cookie-empty-hint">
                Nothing matches "{search.trim()}".
              </p>
            </div>
          )}

          {!hasNoDomains &&
            visibleDomains.map((domain) => {
              const cookies = jar[domain] || [];
              return (
                <div
                  className="cookie-domain-item"
                  data-testid="cookie-domain-item"
                  key={domain}
                >
                  <div className="cookie-domain-head">
                    <span
                      className="cookie-domain-name"
                      data-testid="cookie-domain-name"
                      title={domain}
                    >
                      {domain}
                    </span>
                    <div className="cookie-domain-actions">
                      <button
                        className="btn-secondary compact cookie-add-cookie"
                        data-testid="cookie-add-cookie"
                        onClick={() => handleAddCookie(domain)}
                      >
                        <Plus size={13} />
                        Cookie
                      </button>
                      <button
                        className="cookie-icon-btn cookie-icon-btn-danger"
                        data-testid="cookie-remove-domain"
                        onClick={() => handleRemoveDomain(domain)}
                        aria-label={`Remove domain ${domain}`}
                        title="Remove domain"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {cookies.length === 0 ? (
                    <p className="cookie-domain-empty">
                      No cookies in this domain yet.
                    </p>
                  ) : (
                    <div className="cookie-domain-cookies">
                      <div className="cookie-tag-list">
                        {cookies.map((cookie) => (
                          <div
                            className={`cookie-tag${
                              isEditing(domain, cookie) ? ' cookie-tag-active' : ''
                            }`}
                            data-testid="cookie-tag"
                            key={`${cookie.name}::${cookie.path}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => openEditor(domain, cookie)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                openEditor(domain, cookie);
                              }
                            }}
                            title={`${cookie.name}=${cookie.value}`}
                          >
                            <span className="cookie-tag-name">{cookie.name}</span>
                            <button
                              className="cookie-tag-remove"
                              data-testid="cookie-remove-cookie"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveCookie(domain, cookie.name);
                              }}
                              aria-label={`Remove cookie ${cookie.name}`}
                              title="Remove cookie"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>

                      {editing && editing.domain === domain && (
                        <div className="cookie-value-edit">
                          <textarea
                            ref={editorRef}
                            className="cookie-value-textarea"
                            data-testid="cookie-value-editor"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            rows={3}
                            spellCheck={false}
                          />
                          <div className="cookie-value-actions">
                            <button
                              className="btn-secondary compact cookie-value-btn"
                              data-testid="cookie-value-cancel"
                              onClick={cancelEditor}
                            >
                              Cancel
                            </button>
                            <button
                              className="btn-primary compact cookie-value-btn"
                              data-testid="cookie-value-save"
                              onClick={saveEditor}
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
