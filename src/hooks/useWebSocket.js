import { useEffect, useRef } from 'react';
import { providerName, subscribeToChanges } from '../data/index.js';

export function useWebSocket(onMessage) {
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const onMessageRef = useRef(onMessage);
  const unsubscribeRef = useRef(null);

  // Keep the callback ref updated without triggering reconnects
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    // Use Supabase Realtime for supabase provider
    if (providerName === 'supabase') {
      unsubscribeRef.current = subscribeToChanges((message) => {
        // Transform Supabase event format to match Express format
        const { type, data } = message;
        // type is like 'collection:INSERT', 'request:UPDATE', etc.
        const [table, eventType] = type.split(':');
        const event = `${table}:${eventType.toLowerCase()}`;
        onMessageRef.current({ event, data });
      });

      return () => {
        if (unsubscribeRef.current) {
          unsubscribeRef.current();
        }
      };
    }

    // Use WebSocket for express provider
    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.hostname}:3001`;

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Use the ref so we always have the latest callback
          onMessageRef.current(data);
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting...');
        reconnectTimeoutRef.current = setTimeout(connect, 2000);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []); // Empty deps - only connect once on mount

  return wsRef;
}
