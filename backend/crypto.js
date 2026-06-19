/**
 * crypto.js — AES-256-GCM credential encryption/decryption.
 *
 * The ENCRYPTION_KEY is a 32-byte (64 hex chars) secret stored only in .env.
 * Each encrypt() call generates a fresh random IV, so the same plaintext
 * produces different ciphertext every time. The IV is stored alongside the
 * ciphertext so decrypt() can always recover it.
 *
 * Storage format (stored as JSON string in SQLite):
 *   { "iv": "<24-char base64url>", "tag": "<24-char base64url>", "ct": "<base64url ciphertext>" }
 */

'use strict';

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_HEX   = process.env.ENCRYPTION_KEY;

if (!KEY_HEX || KEY_HEX.length !== 64) {
  throw new Error(
    'ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
    'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
}

const KEY = Buffer.from(KEY_HEX, 'hex');

/**
 * Encrypts a plaintext string.
 * @param {string} plaintext
 * @returns {string} JSON string safe to store in SQLite
 */
function encrypt(plaintext) {
  const iv         = crypto.randomBytes(12); // 96-bit IV — GCM standard
  const cipher     = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag        = cipher.getAuthTag(); // 128-bit auth tag

  return JSON.stringify({
    iv:  iv.toString('base64url'),
    tag: tag.toString('base64url'),
    ct:  ciphertext.toString('base64url'),
  });
}

/**
 * Decrypts a string produced by encrypt().
 * @param {string} stored — the JSON string from SQLite
 * @returns {string} original plaintext
 * @throws if the ciphertext has been tampered with (GCM auth failure)
 */
function decrypt(stored) {
  const { iv, tag, ct } = JSON.parse(stored);

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    KEY,
    Buffer.from(iv, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(ct, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = { encrypt, decrypt };
