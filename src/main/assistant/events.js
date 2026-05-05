/**
 * Simple event emitter for assistant internal communication.
 * Decouples toast actions, hotkey events, and the orchestrator.
 */
const EventEmitter = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(20);

module.exports = {
  on: (event, handler) => bus.on(event, handler),
  off: (event, handler) => bus.off(event, handler),
  once: (event, handler) => bus.once(event, handler),
  emit: (event, ...args) => bus.emit(event, ...args),
};
