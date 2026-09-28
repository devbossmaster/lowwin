/** Enforce a byte limit while streaming, including chunked requests without Content-Length. */
export class RequestBodyError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function readRequestText(request: Request, maxBytes: number): Promise<string> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes))
    throw new RequestBodyError(413, 'Request is too large.');
  const encoding = request.headers.get('content-encoding');
  if (encoding && encoding !== 'identity') throw new RequestBodyError(415, 'Compressed requests are not supported.');
  const reader = request.body?.getReader();
  if (!reader) return '';
  let size = 0;
  const chunks: Uint8Array[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RequestBodyError(408, 'Request timed out.')), 10000);
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new RequestBodyError(413, 'Request is too large.');
      chunks.push(value);
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
    catch { throw new RequestBodyError(400, 'Invalid request encoding.'); }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
