import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Alert dispatcher — pushes trade/signal notifications to Telegram, Discord
 * and email. Every channel is optional and enabled by presence of its
 * configuration. All calls are fire-and-forget (never block trading).
 */
export class AlertService {
  async notify({ type, message }) {
    const text = `[${type.toUpperCase()}] ${message}`;
    const results = await Promise.allSettled([
      this._telegram(text),
      this._discord(text),
      this._email(text),
    ]);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) logger.warn('Some alert channels failed', { count: failed.length });
    return { text, channels: results.length, failed: failed.length };
  }

  trade(trade) {
    return this.notify({
      type: 'trade',
      message: `${trade.side} ${trade.quantity} ${trade.symbol} @ ${trade.price}`,
    });
  }

  signal(signal) {
    return this.notify({
      type: 'signal',
      message: `${signal.symbol}: ${signal.signal} (${(signal.confidence * 100).toFixed(0)}% confidence)`,
    });
  }

  risk(reason) {
    return this.notify({ type: 'risk', message: reason });
  }

  async _telegram(text) {
    const { botToken, chatId } = config.telegram;
    if (!botToken || !chatId) return false;
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    return true;
  }

  async _discord(text) {
    if (!config.discord.webhookUrl) return false;
    await fetch(config.discord.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });
    return true;
  }

  async _email(text) {
    const smtp = config.smtp;
    if (!smtp.host || !smtp.to) return false;
    // SMTP is delegated to nodemailer in a real deployment; here we log the
    // intent and no-op rather than ship an extra dependency for the demo.
    logger.debug('Email alert (SMTP not configured in demo)', { to: smtp.to, text });
    return false;
  }
}

export default AlertService;
