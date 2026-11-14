/**
 * An in-memory stand-in for the task files bucket (ADR 20261113-task-description-files-in-activities-api-bucket): what the routes would have asked
 * of S3, and what S3 would hold. `upload(key, bytes)` is the browser's presigned POST landing;
 * `failDeletes` makes every delete throw, as a bucket outage would.
 */

import type { HeadResult, PresignedPostResult, Storage } from "../lib/storage";
import { setStorageForTests } from "../lib/storage";

export interface FakeStorage extends Storage {
  readonly objects: Map<string, { sizeBytes: number; contentType: string }>;
  readonly posts: { objectKey: string; contentType: string; maxBytes: number }[];
  readonly gets: { objectKey: string; contentType: string; fileName: string; disposition: "inline" | "attachment" }[];
  readonly deletes: string[];
  failDeletes: boolean;
  upload(objectKey: string, sizeBytes: number, contentType?: string): void;
}

export function fakeStorage(): FakeStorage {
  const objects = new Map<string, { sizeBytes: number; contentType: string }>();
  const fake: FakeStorage = {
    objects,
    posts: [],
    gets: [],
    deletes: [],
    failDeletes: false,
    upload(objectKey, sizeBytes, contentType = "application/pdf") {
      objects.set(objectKey, { sizeBytes, contentType });
    },
    async mintPresignedPost(objectKey, contentType, maxBytes): Promise<PresignedPostResult> {
      fake.posts.push({ objectKey, contentType, maxBytes });
      return { url: "https://bucket.test/activities", fields: { key: objectKey, "Content-Type": contentType } };
    },
    async headObject(objectKey): Promise<HeadResult | null> {
      const object = objects.get(objectKey);
      return object ? { sizeBytes: object.sizeBytes, contentType: object.contentType } : null;
    },
    async mintPresignedGet(objectKey, options) {
      fake.gets.push({ objectKey, ...options });
      return `https://bucket.test/${objectKey}?signed=1`;
    },
    async deleteObject(objectKey) {
      if (fake.failDeletes) throw new Error("bucket unavailable");
      fake.deletes.push(objectKey);
      objects.delete(objectKey);
    },
  };
  return fake;
}

/** Wires a fresh fake for this test; `resetWorld` unwires it. */
export function useFakeStorage(): FakeStorage {
  const fake = fakeStorage();
  setStorageForTests(fake);
  return fake;
}
