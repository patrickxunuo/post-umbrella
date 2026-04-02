import { useState, useEffect, useRef } from 'react';

export function ConnectionStatus({ connected, reconnecting }) {
  const [showConnected, setShowConnected] = useState(false);
  const [showLost, setShowLost] = useState(false);
  const hasConnectedRef = useRef(false);

  useEffect(() => {
    if (connected && !hasConnectedRef.current) {
      hasConnectedRef.current = true;
      return;
    }

    if (connected && hasConnectedRef.current) {
      setShowConnected(true);
      setShowLost(false);
      const timer = setTimeout(() => setShowConnected(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [connected]);

  // Show "Connection lost" only after 5 seconds of being disconnected
  useEffect(() => {
    if (!connected && !reconnecting && hasConnectedRef.current) {
      const timer = setTimeout(() => setShowLost(true), 5000);
      return () => clearTimeout(timer);
    }
    setShowLost(false);
  }, [connected, reconnecting]);

  if (connected && showConnected) {
    return (
      <div className="connection-status connection-status--connected" data-testid="connection-status">
        Connected
      </div>
    );
  }

  if (reconnecting) {
    return (
      <div className="connection-status connection-status--reconnecting" data-testid="connection-status">
        Reconnecting...
      </div>
    );
  }

  if (showLost) {
    return (
      <div className="connection-status connection-status--lost" data-testid="connection-status">
        Connection lost
      </div>
    );
  }

  return null;
}
