/**
 * Test helpers for the push channel (T6, specs/029): a fake browser subscriber and an
 * RFC 8291 (`aes128gcm`) decryptor. NOT shipped code and not a test file.
 */

import { createDecipheriv, createECDH, createHmac, randomBytes } from "node:crypto";

export type TestSubscriber = {
  p256dh: string; // base64url, 65-byte uncompressed point
  auth: string; // base64url, 16 bytes
  decrypt(body: Uint8Array): string;
};

const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer => {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  return createHmac("sha256", prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest()
    .subarray(0, length);
};

export const createTestSubscriber = (): TestSubscriber => {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const uaPublic = ecdh.getPublicKey();
  const authSecret = randomBytes(16);

  return {
    p256dh: uaPublic.toString("base64url"),
    auth: authSecret.toString("base64url"),
    decrypt(body) {
      const buf = Buffer.from(body);
      const salt = buf.subarray(0, 16);
      const rs = buf.readUInt32BE(16);
      const idLen = buf.readUInt8(20);
      const asPublic = buf.subarray(21, 21 + idLen);
      const record = buf.subarray(21 + idLen);
      if (record.length > rs) throw new Error("more than one record");

      const shared = ecdh.computeSecret(asPublic);
      const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
      const ikm = hkdf(authSecret, shared, keyInfo, 32);
      const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
      const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);

      const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
      decipher.setAuthTag(record.subarray(record.length - 16));
      const padded = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
      // strip padding: plaintext || 0x02 || 0x00*
      let end = padded.length;
      while (end > 0 && padded[end - 1] === 0) end--;
      if (padded[end - 1] !== 2) throw new Error("bad padding delimiter");
      return padded.subarray(0, end - 1).toString("utf8");
    },
  };
};
