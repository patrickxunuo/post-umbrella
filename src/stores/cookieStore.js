import { create } from 'zustand';
import {
  parseSetCookie,
  cookiesForUrl,
  getDomainFromUrl,
  upsertCookie,
  removeCookie as removeCookieFromJar,
  removeDomain as removeDomainFromJar,
} from '../utils/cookies.js';

const STORAGE_KEY = 'pu_cookie_jar';

const useCookieStore = create((set, get) => {
  const persist = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(get().jar));
  };

  return {
    jar: (() => {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      } catch {
        return {};
      }
    })(),

    getCookiesForUrl: (url) => cookiesForUrl(get().jar, url),

    setCookiesFromResponse: (url, setCookieValues) => {
      const host = getDomainFromUrl(url);
      let newJar = get().jar;

      for (const v of setCookieValues) {
        const c = parseSetCookie(v);
        if (!c) continue;

        let domain;
        if (c.domain && (host === c.domain || host.endsWith('.' + c.domain))) {
          domain = c.domain;
        } else {
          domain = host;
        }
        if (!domain) continue;

        if (c.expires != null && c.expires <= Date.now()) {
          newJar = removeCookieFromJar(newJar, domain, c.name);
        } else {
          newJar = upsertCookie(newJar, domain, c);
        }
      }

      set({ jar: newJar });
      persist();
    },

    upsert: (domain, cookie) => {
      set({ jar: upsertCookie(get().jar, domain, cookie) });
      persist();
    },

    removeCookie: (domain, name) => {
      set({ jar: removeCookieFromJar(get().jar, domain, name) });
      persist();
    },

    removeDomain: (domain) => {
      set({ jar: removeDomainFromJar(get().jar, domain) });
      persist();
    },

    getDomains: () => Object.keys(get().jar),
  };
});

export default useCookieStore;
