/**
 * Envelope encryption for the token map vault (invariant #2).
 *
 * - Per-tenant Data Encryption Key (DEK), random 32 bytes.
 * - DEK is stored WRAPPED by the master key (AES-256-GCM). Master key comes from
 *   env in dev; in prod this module is the single seam to swap for a KMS
 *   (implement wrapDek/unwrapDek against KMS and nothing else changes).
 * - Values are encrypted with AES-256-GCM under the tenant DEK.
 * - Reuse lookup uses HMAC-SHA256(tenant DEK, normalized value) — deterministic,
 *   never reversible, tenant-scoped.
 *
 * Plaintext DEKs and decrypted values exist ONLY in gateway process memory,
 * never logged, never cached, never sent anywhere.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { config } from "../config.js";

const ALGO = "aes-256-gcm";

function masterKey(): Buffer {
  const key = Buffer.from(config.masterKey, "base64");
  if (key.length !== 32) {
    throw new Error("MASTER_ENCRYPTION_KEY must be 32 bytes (base64-encoded)");
  }
  return key;
}

export interface Sealed {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

function seal(key: Buffer, plaintext: Buffer): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function open(key: Buffer, sealed: Sealed): Buffer {
  const decipher = createDecipheriv(ALGO, key, sealed.iv);
  decipher.setAuthTag(sealed.tag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
}

/** Create a fresh tenant DEK. Returns plaintext DEK + its wrapped form. */
export function generateDek(): { dek: Buffer; wrapped: Buffer; masterKeyId: string } {
  const dek = randomBytes(32);
  const wrapped = packSealed(seal(masterKey(), dek));
  return { dek, wrapped, masterKeyId: config.masterKeyId };
}

/** Unwrap a stored DEK with the master key. */
export function unwrapDek(wrapped: Buffer): Buffer {
  return open(masterKey(), unpackSealed(wrapped));
}

/** Encrypt a PII value under the tenant DEK. */
export function encryptValue(dek: Buffer, value: string): Sealed {
  return seal(dek, Buffer.from(value, "utf8"));
}

/** Decrypt a PII value under the tenant DEK. */
export function decryptValue(dek: Buffer, sealed: Sealed): string {
  return open(dek, sealed).toString("utf8");
}

/** Deterministic tenant-scoped reuse hash. */
export function valueHash(dek: Buffer, entityType: string, normalizedValue: string): Buffer {
  return createHmac("sha256", dek).update(`${entityType}:${normalizedValue}`).digest();
}

// The wrapped DEK is stored as a single bytea: iv(12) | tag(16) | ciphertext.
function packSealed(s: Sealed): Buffer {
  return Buffer.concat([s.iv, s.tag, s.ciphertext]);
}
function unpackSealed(buf: Buffer): Sealed {
  return { iv: buf.subarray(0, 12), tag: buf.subarray(12, 28), ciphertext: buf.subarray(28) };
}
