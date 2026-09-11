import { EventEmitter } from 'node:events';
import { logger } from '../logger.js';

/**
 * Emergency kill switch.
 *
 * When triggered (manually by the user, or automatically when a risk limit is
 * breached) it flips the platform into "locked" mode: the trading engine stops
 * opening new positions and issues market close orders for everything open.
 * It can only be reset explicitly.
 */
export class KillSwitch extends EventEmitter {
  constructor() {
    super();
    this.triggered = false;
    this.reason = null;
    this.triggeredAt = null;
  }

  get isTriggered() {
    return this.triggered;
  }

  /**
   * Arm the kill switch.
   * @param {string} reason human-readable reason
   * @returns {{ triggered:boolean, reason:string|null, at:string|null }}
   */
  trigger(reason = 'manual') {
    if (this.triggered) return this.status();
    this.triggered = true;
    this.reason = reason;
    this.triggeredAt = new Date().toISOString();
    logger.warn('KILL SWITCH TRIGGERED', { reason });
    this.emit('trigger', this.status());
    return this.status();
  }

  /** Disarm the kill switch. */
  reset() {
    this.triggered = false;
    this.reason = null;
    this.triggeredAt = null;
    logger.info('Kill switch reset');
    this.emit('reset');
    return this.status();
  }

  status() {
    return { triggered: this.triggered, reason: this.reason, at: this.triggeredAt };
  }

  /** True when the engine must not open new positions. */
  get blocksTrading() {
    return this.triggered;
  }
}

export default KillSwitch;
