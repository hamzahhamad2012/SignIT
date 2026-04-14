import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react';
import { io } from 'socket.io-client';

// Singleton socket — lives for the entire session, never destroyed on unmount
const socket = io(window.location.origin, {
  query: { role: 'admin' },
  transports: ['websocket', 'polling'],
});

// Shared connection state — all components see the same value
let currentConnected = socket.connected;
const listeners = new Set();

socket.on('connect', () => {
  currentConnected = true;
  listeners.forEach(fn => fn());
});
socket.on('disconnect', () => {
  currentConnected = false;
  listeners.forEach(fn => fn());
});

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function getSnapshot() {
  return currentConnected;
}

export function useSocket() {
  const connected = useSyncExternalStore(subscribe, getSnapshot);

  const on = useCallback((event, handler) => {
    socket.on(event, handler);
    return () => socket.off(event, handler);
  }, []);

  const emit = useCallback((event, data) => {
    socket.emit(event, data);
  }, []);

  return { socket, connected, on, emit };
}
