// Owner password check (API.md §1.1): the host stores only an Argon2id hash in OWNER_PASSWORD_HASH;
// the password itself is never stored or logged (CLAUDE.md §5). Verified with hash-wasm (D-51).

import { argon2Verify } from "hash-wasm";

/** True only when `password` matches an Argon2id hash in the standard encoded form. */
export async function verifyPassword(encodedHash: string, password: string): Promise<boolean> {
  if (!encodedHash.startsWith("$argon2id$") || password.length === 0 || password.length > 1024) return false;
  try {
    return await argon2Verify({ password, hash: encodedHash });
  } catch {
    return false;
  }
}
