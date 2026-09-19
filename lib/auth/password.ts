import "server-only";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

const KEY_LENGTH = 64;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function encode(value: Buffer) {
  return value.toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url");
}

function derive(password: string, salt: Buffer, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${encode(salt)}$${encode(key)}`;
}

export async function verifyPassword(password: string, encodedHash: string) {
  try {
    const [algorithm, n, r, p, encodedSalt, encodedKey] = encodedHash.split("$");
    if (algorithm !== "scrypt" || Number(n) !== SCRYPT_N || Number(r) !== SCRYPT_R || Number(p) !== SCRYPT_P || !encodedSalt || !encodedKey) return false;
    const expected = decode(encodedKey);
    if (expected.length !== KEY_LENGTH) return false;
    const actual = await derive(password, decode(encodedSalt), { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 });
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
