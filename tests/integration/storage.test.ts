import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createTestDb, resetTestState } from "../helpers/setup";
import type { AppDatabase } from "../../server/db";
import {
  createBucket,
  deleteBucket,
  uploadFile,
  listFiles,
  deleteFile,
  getFileUrl,
  validateFilePath,
  StorageError,
} from "../../server/services/storage.service";

let db: AppDatabase;
let tempDir: string;

beforeEach(() => {
  db = createTestDb();
  resetTestState();
  tempDir = mkdtempSync(join(tmpdir(), "storage-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Storage — Bucket CRUD", () => {
  it("creates a bucket and directory on disk", async () => {
    const bucket = await createBucket("my-bucket", {}, db, tempDir);

    expect(bucket.id).toBeDefined();
    expect(bucket.name).toBe("my-bucket");
    expect(bucket.isPublic).toBe(false);
    expect(existsSync(join(tempDir, "my-bucket"))).toBe(true);
  });

  it("deletes bucket and removes directory", async () => {
    const bucket = await createBucket("deleteme", {}, db, tempDir);

    await deleteBucket(bucket.id, db, tempDir);

    expect(existsSync(join(tempDir, "deleteme"))).toBe(false);
  });

  it("deletes bucket removes all files from DB", async () => {
    const bucket = await createBucket("with-files", {}, db, tempDir);
    await uploadFile(bucket.id, "test.txt", Buffer.from("hello"), {}, db, tempDir);

    await deleteBucket(bucket.id, db, tempDir);

    // File tree query should fail since bucket is gone
    try {
      await listFiles(bucket.id, undefined, db);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(StorageError);
    }
  });
});

describe("Storage — File Upload", () => {
  let bucketId: string;

  beforeEach(async () => {
    const bucket = await createBucket("test-bucket", {}, db, tempDir);
    bucketId = bucket.id;
  });

  it("uploads a file and it exists on disk with correct content", async () => {
    const content = Buffer.from("Hello, World!");
    const file = await uploadFile(bucketId, "hello.txt", content, {}, db, tempDir);

    expect(file.path).toBe("hello.txt");
    expect(file.sizeBytes).toBe(content.length);

    const diskContent = readFileSync(join(tempDir, "test-bucket", "hello.txt"), "utf8");
    expect(diskContent).toBe("Hello, World!");
  });

  it("preserves original filename and detects MIME type", async () => {
    const file = await uploadFile(
      bucketId,
      "image.png",
      Buffer.from("fake-png"),
      {},
      db,
      tempDir
    );

    expect(file.path).toBe("image.png");
    expect(file.mimeType).toBe("image/png");
  });

  it("upload to nonexistent bucket returns 404", async () => {
    try {
      await uploadFile("nonexistent", "file.txt", Buffer.from("x"), {}, db, tempDir);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(StorageError);
      expect((e as StorageError).statusCode).toBe(404);
    }
  });

  it("upload exceeding size limit returns 413", async () => {
    try {
      await uploadFile(
        bucketId,
        "big.bin",
        Buffer.alloc(1000),
        { maxFileSize: 500 },
        db,
        tempDir
      );
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(StorageError);
      expect((e as StorageError).statusCode).toBe(413);
    }
  });

  it("file listing returns correct hierarchy", async () => {
    await uploadFile(bucketId, "root.txt", Buffer.from("a"), {}, db, tempDir);
    await uploadFile(bucketId, "docs/readme.md", Buffer.from("b"), {}, db, tempDir);
    await uploadFile(bucketId, "docs/api/spec.json", Buffer.from("c"), {}, db, tempDir);

    const tree = await listFiles(bucketId, undefined, db);

    // Should have root.txt + docs dir
    const rootFile = tree.find((e) => e.name === "root.txt");
    expect(rootFile).toBeDefined();
    expect(rootFile!.type).toBe("file");

    const docsDir = tree.find((e) => e.name === "docs");
    expect(docsDir).toBeDefined();
    expect(docsDir!.type).toBe("directory");
    expect(docsDir!.children).toBeDefined();
    expect(docsDir!.children!.length).toBeGreaterThanOrEqual(1);
  });

  it("delete file removes from disk and database", async () => {
    await uploadFile(bucketId, "temp.txt", Buffer.from("temp data"), {}, db, tempDir);
    expect(existsSync(join(tempDir, "test-bucket", "temp.txt"))).toBe(true);

    await deleteFile(bucketId, "temp.txt", db, tempDir);

    expect(existsSync(join(tempDir, "test-bucket", "temp.txt"))).toBe(false);

    const files = await listFiles(bucketId, undefined, db);
    expect(files).toHaveLength(0);
  });

  it("storage quota: upload that would exceed quota returns 413", async () => {
    const bucket = await createBucket(
      "limited-bucket",
      { maxSizeBytes: 100 },
      db,
      tempDir
    );

    // First upload: 80 bytes (within quota)
    await uploadFile(bucket.id, "a.txt", Buffer.alloc(80), {}, db, tempDir);

    // Second upload: 30 bytes (would exceed 100 byte quota)
    try {
      await uploadFile(bucket.id, "b.txt", Buffer.alloc(30), {}, db, tempDir);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(StorageError);
      expect((e as StorageError).statusCode).toBe(413);
    }
  });

  it("handles filenames with special chars (spaces, unicode)", async () => {
    // Spaces and unicode should work if no path traversal
    const file = await uploadFile(
      bucketId,
      "my docs/résumé.pdf",
      Buffer.from("pdf"),
      {},
      db,
      tempDir
    );

    expect(file.path).toBe("my docs/résumé.pdf");
  });
});

describe("Storage — Path Traversal Prevention", () => {
  it("blocks ../../../etc/passwd", () => {
    expect(() => validateFilePath("../../../etc/passwd")).toThrow(StorageError);
  });

  it("blocks null bytes in filename", () => {
    expect(() => validateFilePath("file\0.txt")).toThrow(StorageError);
  });

  it("blocks absolute paths", () => {
    expect(() => validateFilePath("/etc/passwd")).toThrow(StorageError);
  });

  it("blocks hidden files", () => {
    expect(() => validateFilePath(".htaccess")).toThrow(StorageError);
  });

  it("blocks empty path", () => {
    expect(() => validateFilePath("")).toThrow(StorageError);
  });

  it("allows normal nested paths", () => {
    expect(validateFilePath("images/photo.jpg")).toBe("images/photo.jpg");
    expect(validateFilePath("docs/api/v1/spec.yaml")).toBe("docs/api/v1/spec.yaml");
  });
});

describe("Storage — Signed URLs", () => {
  it("public bucket returns direct URL", async () => {
    const bucket = await createBucket("public-bucket", { isPublic: true }, db, tempDir);
    await uploadFile(bucket.id, "file.txt", Buffer.from("data"), {}, db, tempDir);

    const { url, isPublic } = await getFileUrl(
      bucket.id,
      "file.txt",
      "https://example.com",
      3600,
      db
    );

    expect(isPublic).toBe(true);
    expect(url).toContain("/api/storage/buckets/");
    expect(url).not.toContain("signature");
  });

  it("private bucket returns signed URL", async () => {
    const bucket = await createBucket("private-bucket", { isPublic: false }, db, tempDir);
    await uploadFile(bucket.id, "secret.txt", Buffer.from("secret"), {}, db, tempDir);

    const { url, isPublic } = await getFileUrl(
      bucket.id,
      "secret.txt",
      "https://example.com",
      3600,
      db
    );

    expect(isPublic).toBe(false);
    expect(url).toContain("signature=");
    expect(url).toContain("expires=");
  });
});
