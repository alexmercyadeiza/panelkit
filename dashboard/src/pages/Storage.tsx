import { useEffect, useState, useCallback, useRef } from "react";
import { api, ApiError } from "../api/client";
import { Button } from "../components/ui/Button";
import { StatusBadge } from "../components/ui/StatusBadge";
import { EmptyState } from "../components/ui/EmptyState";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Bucket {
  id: string;
  name: string;
  isPublic: boolean;
  maxSizeBytes: number | null;
  fileCount: number;
  totalSize: number;
  createdAt: string;
}

interface FileRecord {
  id: string;
  bucketId: string;
  path: string;
  size: number;
  mimeType: string | null;
  createdAt: string;
}

type View = "list" | "create" | "detail";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

// ─── Create Bucket Form ──────────────────────────────────────────────────────

function CreateBucketForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [maxSize, setMaxSize] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name, isPublic };
      if (maxSize.trim()) {
        const parsed = parseInt(maxSize, 10);
        if (isNaN(parsed) || parsed <= 0) {
          setError("Max size must be a positive number (in MB)");
          setSaving(false);
          return;
        }
        body.maxSizeBytes = parsed * 1024 * 1024;
      }
      await api("/storage/buckets", {
        method: "POST",
        body: JSON.stringify(body),
      });
      onCreated();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create bucket"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white">Create Bucket</h2>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">
            Bucket Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-bucket"
            required
            pattern="^[a-z0-9][a-z0-9._-]*$"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono-code"
          />
          <p className="text-xs text-zinc-600 mt-1">
            Lowercase alphanumeric, starting with letter or digit
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
            />
            Public bucket
          </label>
          <span className="text-xs text-zinc-600">
            {isPublic
              ? "Files will be publicly accessible"
              : "Files require signed URLs"}
          </span>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">
            Max Size (MB)
          </label>
          <input
            type="number"
            value={maxSize}
            onChange={(e) => setMaxSize(e.target.value)}
            placeholder="No limit"
            min="1"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono-code"
          />
          <p className="text-xs text-zinc-600 mt-1">
            Leave empty for no size limit
          </p>
        </div>

        <div className="pt-2">
          <Button type="submit" variant="primary" loading={saving}>
            Create Bucket
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Bucket Detail View ──────────────────────────────────────────────────────

function BucketDetailView({
  bucket,
  onBack,
  onDeleted,
}: {
  bucket: Bucket;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<{
    path: string;
    url: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      const data = await api<{ files: FileRecord[] }>(
        `/storage/buckets/${bucket.id}/files`
      );
      setFiles(data.files);
    } catch {
      setFiles([]);
    } finally {
      setFilesLoading(false);
    }
  }, [bucket.id]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadStatus(`Uploading ${file.name}...`);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      await fetch(`/api/storage/buckets/${bucket.id}/upload`, {
        method: "POST",
        credentials: "include",
        body: formData,
      }).then(async (res) => {
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Upload failed");
        }
      });

      setUploadStatus(`Uploaded ${file.name}`);
      await fetchFiles();
      setTimeout(() => setUploadStatus(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploadStatus(null);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDeleteFile = async (filePath: string) => {
    setDeletingFile(filePath);
    setError(null);
    try {
      await api(`/storage/buckets/${bucket.id}/files/${encodeURIComponent(filePath)}`, {
        method: "DELETE",
      });
      await fetchFiles();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to delete file"
      );
    } finally {
      setDeletingFile(null);
    }
  };

  const handleGetUrl = async (filePath: string) => {
    setError(null);
    try {
      const data = await api<{ url: string; expiresIn: number }>(
        `/storage/buckets/${bucket.id}/url/${encodeURIComponent(filePath)}`
      );
      setSignedUrl({ path: filePath, url: data.url });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to get URL"
      );
    }
  };

  const handleDeleteBucket = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api(`/storage/buckets/${bucket.id}`, { method: "DELETE" });
      onDeleted();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to delete bucket"
      );
      setDeleting(false);
    }
  };

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // fallback
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-white truncate">
              {bucket.name}
            </h2>
            <StatusBadge status={bucket.isPublic ? "active" : "private"} />
          </div>
          <p className="text-sm text-zinc-500 font-mono-code mt-0.5">
            {formatBytes(bucket.totalSize)}
            {bucket.maxSizeBytes
              ? ` / ${formatBytes(bucket.maxSizeBytes)}`
              : ""}
            {" "}
            &middot; {bucket.fileCount} file{bucket.fileCount !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Signed URL display */}
      {signedUrl && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-blue-400">
              Signed URL for {fileName(signedUrl.path)}
            </h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSignedUrl(null)}
            >
              Dismiss
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300 font-mono-code overflow-x-auto whitespace-nowrap">
              {signedUrl.url}
            </code>
            <button
              onClick={() => handleCopyUrl(signedUrl.url)}
              className="p-2 text-zinc-500 hover:text-zinc-300 transition-colors shrink-0 bg-zinc-950 border border-zinc-800 rounded-lg"
              title="Copy to clipboard"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Bucket Info + Actions */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">
            Bucket Info
          </h3>
          <div className="flex items-center gap-2">
            {confirmDelete ? (
              <>
                <span className="text-xs text-zinc-500">Are you sure?</span>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleDeleteBucket}
                  loading={deleting}
                >
                  Confirm Delete
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setConfirmDelete(true)}
              >
                Delete Bucket
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <span className="text-xs text-zinc-500 block">Visibility</span>
            <span className="text-sm text-white">
              {bucket.isPublic ? "Public" : "Private"}
            </span>
          </div>
          <div>
            <span className="text-xs text-zinc-500 block">Files</span>
            <span className="text-sm text-white font-mono-code">
              {bucket.fileCount}
            </span>
          </div>
          <div>
            <span className="text-xs text-zinc-500 block">Size Used</span>
            <span className="text-sm text-white font-mono-code">
              {formatBytes(bucket.totalSize)}
            </span>
          </div>
          <div>
            <span className="text-xs text-zinc-500 block">Quota</span>
            <span className="text-sm text-white font-mono-code">
              {bucket.maxSizeBytes
                ? formatBytes(bucket.maxSizeBytes)
                : "Unlimited"}
            </span>
          </div>
        </div>
      </div>

      {/* File Browser */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">
            Files
          </h3>
          <div className="flex items-center gap-2">
            {uploadStatus && (
              <span className="text-xs text-zinc-400">{uploadStatus}</span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleUpload}
              className="hidden"
              id="file-upload"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              loading={uploading}
            >
              Upload File
            </Button>
          </div>
        </div>

        {filesLoading ? (
          <p className="text-sm text-zinc-500">Loading files...</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No files in this bucket yet. Upload a file to get started.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Filename
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Size
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Type
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Uploaded
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr
                    key={file.id}
                    className="border-b border-zinc-800/50 last:border-b-0"
                  >
                    <td className="px-4 py-3 text-sm text-zinc-300 font-mono-code">
                      {file.path}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-400 font-mono-code whitespace-nowrap">
                      {formatBytes(file.size)}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-400 font-mono-code whitespace-nowrap">
                      {file.mimeType || (
                        <span className="text-zinc-600">--</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-500 whitespace-nowrap">
                      {formatDate(file.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleGetUrl(file.path)}
                        >
                          URL
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteFile(file.path)}
                          loading={deletingFile === file.path}
                        >
                          <span className="text-red-400">Delete</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Storage Page ─────────────────────────────────────────────────────────────

export function StoragePage() {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");
  const [selectedBucket, setSelectedBucket] = useState<Bucket | null>(null);

  const fetchBuckets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ buckets: Bucket[] }>("/storage/buckets");
      setBuckets(data.buckets);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load buckets"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBuckets();
  }, [fetchBuckets]);

  const handleBucketCreated = () => {
    setView("list");
    fetchBuckets();
  };

  const handleBucketClick = (bucket: Bucket) => {
    setSelectedBucket(bucket);
    setView("detail");
  };

  const handleBucketDeleted = () => {
    setSelectedBucket(null);
    setView("list");
    fetchBuckets();
  };

  // ─── Detail view ──────────────────────────────────────────────────────

  if (view === "detail" && selectedBucket) {
    return (
      <BucketDetailView
        bucket={selectedBucket}
        onBack={() => {
          setView("list");
          fetchBuckets();
        }}
        onDeleted={handleBucketDeleted}
      />
    );
  }

  // ─── Create view ─────────────────────────────────────────────────────

  if (view === "create") {
    return (
      <CreateBucketForm
        onCreated={handleBucketCreated}
        onCancel={() => setView("list")}
      />
    );
  }

  // ─── List view ────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Storage</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Manage file storage buckets
          </p>
        </div>
        <Button variant="primary" onClick={() => setView("create")}>
          Create Bucket
        </Button>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="text-sm text-zinc-500">Loading buckets...</div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && buckets.length === 0 && (
        <EmptyState
          title="No storage buckets"
          description="Create your first bucket to start storing files. Buckets can be public or private."
          action={{
            label: "Create Bucket",
            onClick: () => setView("create"),
          }}
        />
      )}

      {/* Bucket cards */}
      {!loading && buckets.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {buckets.map((bucket) => (
            <button
              key={bucket.id}
              onClick={() => handleBucketClick(bucket)}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 text-left hover:border-zinc-700 hover:bg-zinc-900/80 transition-all duration-100 group"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-sm font-semibold text-white group-hover:text-blue-400 transition-colors truncate font-mono-code">
                  {bucket.name}
                </h3>
                <StatusBadge
                  status={bucket.isPublic ? "active" : "private"}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0"
                  >
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                    <polyline points="13 2 13 9 20 9" />
                  </svg>
                  <span className="font-mono-code">
                    {bucket.fileCount} file
                    {bucket.fileCount !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0"
                  >
                    <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                    <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                    <line x1="6" y1="6" x2="6.01" y2="6" />
                    <line x1="6" y1="18" x2="6.01" y2="18" />
                  </svg>
                  <span className="font-mono-code">
                    {formatBytes(bucket.totalSize)}
                    {bucket.maxSizeBytes
                      ? ` / ${formatBytes(bucket.maxSizeBytes)}`
                      : ""}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-800/50">
                <span className="text-xs text-zinc-600">
                  {bucket.isPublic ? "Public" : "Private"}
                </span>
                <span className="text-xs text-zinc-600">
                  {formatDate(bucket.createdAt)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
