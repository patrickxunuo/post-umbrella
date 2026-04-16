// Node `Buffer` polyfill for deps that assume a Node environment.
// Loaded from main.jsx before any other imports.
import { Buffer } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}
