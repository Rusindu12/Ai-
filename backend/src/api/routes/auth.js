import { Router } from 'express';
import crypto from 'node:crypto';
import { store } from '../../db/store.js';
import { signToken, requireAuth } from '../../security/jwt.js';
import { generateSecret, verifyTotp, otpauthUrl } from '../../security/totp.js';

/**
 * Auth routes: registration, login with optional TOTP 2FA, and management of
 * the encrypted Binance credentials.
 */
export function authRouter() {
  const router = Router();

  const hashPassword = (password) =>
    crypto.createHash('sha256').update(password).digest('hex');

  // POST /api/auth/register
  router.post('/register', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const existing = await store.getUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'email already registered' });
    const user = {
      id: crypto.randomUUID(),
      email,
      passwordHash: hashPassword(password),
      totpSecret: null,
    };
    await store.createUser(user);
    const token = signToken({ sub: user.id, email: user.email });
    return res.status(201).json({ token, user: { id: user.id, email: user.email } });
  });

  // POST /api/auth/login  { email, password, totpCode? }
  router.post('/login', async (req, res) => {
    const { email, password, totpCode } = req.body || {};
    const user = await store.getUserByEmail(email);
    if (!user || user.passwordHash !== hashPassword(password)) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    // If the user enrolled 2FA, require the TOTP code.
    if (user.totpSecret) {
      if (!totpCode || !verifyTotp(user.totpSecret, totpCode)) {
        return res.status(401).json({ error: 'invalid 2FA code' });
      }
    }
    const token = signToken({ sub: user.id, email: user.email });
    return res.json({ token, user: { id: user.id, email: user.email, twoFactorEnabled: Boolean(user.totpSecret) } });
  });

  // GET /api/auth/2fa/setup — begin 2FA enrolment (returns secret + otpauth URL)
  router.get('/2fa/setup', requireAuth, async (req, res) => {
    const secret = generateSecret();
    // The secret is returned to the client once for QR enrolment; it is only
    // persisted after the user confirms a valid code via /2fa/confirm.
    return res.json({
      secret,
      otpauthUrl: otpauthUrl(secret, req.user.email),
    });
  });

  // POST /api/auth/2fa/confirm { secret, code } — verify and persist 2FA
  router.post('/2fa/confirm', requireAuth, async (req, res) => {
    const { secret, code } = req.body || {};
    if (!secret || !code) return res.status(400).json({ error: 'secret and code required' });
    if (!verifyTotp(secret, code)) return res.status(400).json({ error: 'invalid code' });
    const user = await store.getUserById(req.user.sub);
    if (!user) return res.status(404).json({ error: 'user not found' });
    await store.createUser({ ...user, totpSecret: secret });
    return res.json({ enabled: true });
  });

  // POST /api/auth/binance { apiKey, apiSecret } — store encrypted credentials
  router.post('/binance', requireAuth, async (req, res) => {
    const { apiKey, apiSecret } = req.body || {};
    if (!apiKey || !apiSecret) return res.status(400).json({ error: 'apiKey and apiSecret required' });
    await store.saveApiCredentials(req.user.sub, apiKey, apiSecret);
    return res.json({ saved: true });
  });

  // GET /api/auth/me
  router.get('/me', requireAuth, async (req, res) => {
    const user = await store.getUserById(req.user.sub);
    const hasCredentials = await store.hasApiCredentials(req.user.sub);
    return res.json({
      id: user?.id,
      email: user?.email,
      twoFactorEnabled: Boolean(user?.totpSecret),
      hasBinanceCredentials: hasCredentials,
    });
  });

  return router;
}

export default authRouter;
