import { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useWorkbench } from '../contexts/WorkbenchContext';
import { useToast } from '../components/Toast';
import * as data from '../data/index.js';

export function useClipboardLinks() {
  const toast = useToast();
  const { user } = useAuth();
  const {
    collections,
    openCollectionInTab,
    openRequestInTab,
    openExampleInTab,
    setRevealCollectionId,
    setRevealRequestId,
  } = useWorkbench();
  const lastClipboardLinkRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    const baseUrl = import.meta.env.VITE_APP_URL || window.location.origin;
    const pattern = new RegExp(
      `^${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\?.*type=(collection|folder|request|example)&id=([0-9a-f-]+)`
    );

    const handleFocus = async () => {
      let text;
      try {
        text = await navigator.clipboard.readText();
      } catch {
        return;
      }
      if (!text) return;
      const match = text.match(pattern);
      if (!match) return;
      const type = match[1];
      const id = match[2];

      const urlParams = new URLSearchParams(text.split('?')[1]);
      const uid = urlParams.get('uid');
      if (uid && uid === String(user.id)) return;

      if (text === lastClipboardLinkRef.current) return;
      lastClipboardLinkRef.current = text;

      if (type === 'collection' || type === 'folder') {
        const found = collections.find(c => c.id === id);
        if (!found) return;
        toast.action(`Open shared ${type}?`, {
          label: 'Open',
          onClick: () => {
            openCollectionInTab(found, { replacePreview: false });
            setRevealCollectionId(id);
          },
        });
      } else if (type === 'request') {
        let request = null;
        for (const c of collections) {
          request = c.requests?.find(r => r.id === id);
          if (request) break;
        }
        if (!request) return;
        toast.action('Open shared request?', {
          label: 'Open',
          onClick: async () => {
            const fullRequest = await data.getRequest(id);
            openRequestInTab(fullRequest, { replacePreview: false });
            setRevealRequestId(id);
          },
        });
      } else if (type === 'example') {
        toast.action('Open shared example?', {
          label: 'Open',
          onClick: async () => {
            try {
              const example = await data.getExample(id);
              const parentRequest = await data.getRequest(example.request_id);
              openExampleInTab(example, parentRequest, { replacePreview: false });
              setRevealRequestId(parentRequest.id);
            } catch {
              toast.error('Failed to open shared example.');
            }
          },
        });
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [user, collections, toast, openCollectionInTab, openRequestInTab, openExampleInTab, setRevealCollectionId, setRevealRequestId]);
}
