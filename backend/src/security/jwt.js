import jwt from 'jsonwebtoken';
import { config } from '../config.js';

/**
 * JWT session helpers. Stateless tokens signed with HS256; the secret comes
 * from JWT_SECRET.
 */

export function signToken(payload, options = {}) {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: options.expiresIn || config.jwtExpiresIn,
  });
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

/**
 * Express middleware enforcing a valid Authorization: Bearer token.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });
  try {
    req.user = verifyToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
}

export default { signToken, verifyToken, requireAuth };
