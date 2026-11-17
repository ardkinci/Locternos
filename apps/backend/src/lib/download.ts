import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';

export type HashAlgorithm = 'sha1' | 'sha256';

/** Raised when a download cannot be fetched or stored. */
export class DownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadError';
  }
}

/** Raised when downloaded bytes do not match the published digest. */
export class ChecksumMismatchError extends DownloadError {
  constructor(
    readonly algorithm: HashAlgorithm,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`Downloaded file ${algorithm} mismatch (expected ${expected}, got ${actual})`);
    this.name = 'ChecksumMismatchError';
  }
}

export interface DownloadToFileOptions {
  url: string;
  destination: string;
  algorithm: HashAlgorithm;
  /** Expected lowercase or uppercase hex digest; when set it is enforced. */
  expectedHex?: string;
  expectedSizeBytes?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Streams a remote file to disk while hashing it, then verifies the digest and
 * optional size. Nothing downstream should trust the file before this returns.
 */
export async function downloadToFile(
  options: DownloadToFileOptions,
): Promise<{ hash: string; sizeBytes: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(options.url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 10 * 60 * 1000),
    });
  } catch (error) {
    throw new DownloadError(
      `Failed to download ${options.url}: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  if (!response.ok) {
    throw new DownloadError(`Download failed with status ${response.status}`);
  }
  if (!response.body) {
    throw new DownloadError('Download returned an empty body');
  }

  const hash = createHash(options.algorithm);
  let sizeBytes = 0;
  const hasher = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      sizeBytes += chunk.length;
      callback(null, chunk);
    },
  });

  const body = response.body as unknown as NodeReadableStream<Uint8Array>;
  await pipeline(Readable.fromWeb(body), hasher, createWriteStream(options.destination));

  const digest = hash.digest('hex');
  if (options.expectedHex && digest !== options.expectedHex.toLowerCase()) {
    throw new ChecksumMismatchError(options.algorithm, options.expectedHex.toLowerCase(), digest);
  }
  if (options.expectedSizeBytes !== undefined && sizeBytes !== options.expectedSizeBytes) {
    throw new DownloadError(
      `Downloaded file size mismatch (expected ${options.expectedSizeBytes}, got ${sizeBytes})`,
    );
  }

  return { hash: digest, sizeBytes };
}
