import { maxReportFiles, maxReportBytes, maxReportRequestBytes } from '../public/report-files.js';

export async function readReportFiles(request) {
  if (Number(request.headers.get('Content-Length')) > maxReportRequestBytes) throw new RangeError('附件总大小超过限制。');
  if (!request.body) throw new TypeError('举报内容无效。');
  const reader = request.body.getReader();
  let length = 0;
  const limited = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) return controller.close();
      length += value.byteLength;
      if (length > maxReportRequestBytes) {
        controller.error(new RangeError('附件总大小超过限制。'));
        await reader.cancel();
      } else controller.enqueue(value);
    },
    cancel(reason) { return reader.cancel(reason); }
  });
  const form = await new Response(limited, { headers: { 'Content-Type': request.headers.get('Content-Type') } }).formData();
  const payload = form.get('payload');
  if (typeof payload !== 'string' || payload.length > 24_000) throw new TypeError('举报内容无效。');
  return { input: JSON.parse(payload), files: form.getAll('attachments') };
}

async function reportFileType(file) {
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const text = (from, to) => String.fromCharCode(...bytes.subarray(from, to));
  const view = new DataView(bytes.buffer);
  const tail = async length => new Uint8Array(await file.slice(-length).arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const end = await tail(2);
    if (file.size >= 64 && end[0] === 0xff && end[1] === 0xd9) return 'image/jpeg';
    return;
  }
  if (bytes[0] === 0x89 && text(1, 8) === 'PNG\r\n\x1a\n') {
    const end = await tail(12);
    if (file.size >= 57 && text(12, 16) === 'IHDR' && view.getUint32(16) && view.getUint32(20) &&
        String.fromCharCode(...end.subarray(4, 8)) === 'IEND') return 'image/png';
    return;
  }
  if (['GIF87a', 'GIF89a'].includes(text(0, 6))) {
    if (file.size >= 26 && view.getUint16(6, true) && view.getUint16(8, true) && (await tail(1))[0] === 0x3b) return 'image/gif';
    return;
  }
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') {
    if (file.size >= 26 && view.getUint32(4, true) + 8 === file.size && ['VP8 ', 'VP8L', 'VP8X'].includes(text(12, 16))) return 'image/webp';
    return;
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    if (file.size >= 64 && text(0, bytes.length).includes('webm')) return 'video/webm';
    return;
  }
  if (text(4, 8) !== 'ftyp' || bytes.length < 16 || view.getUint32(0) < 16 || view.getUint32(0) > file.size - 8) return;
  const brand = text(8, 12);
  if (['avif', 'avis'].includes(brand)) return 'image/avif';
  if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
  if (brand === 'qt  ') return 'video/quicktime';
  if (/^(isom|iso[2-9]|mp4[12]|avc1|M4V |dash|3gp[456]|MSNV)$/.test(brand)) return 'video/mp4';
}

export async function validateReportFiles(files) {
  if (files.length > maxReportFiles || files.some(file => typeof file?.slice !== 'function' || !file.size) ||
    files.reduce((size, file) => size + file.size, 0) > maxReportBytes) return null;
  const attachments = [];
  for (const file of files) {
    const type = await reportFileType(file);
    if (!type) return null;
    const name = Array.from(file.name.split(/[\\/]/).pop().replace(/\p{C}/gu, '')).slice(0, 100).join('').trim() || '附件';
    attachments.push({ name, type, size: file.size });
  }
  return attachments;
}

export const reportFileKey = (id, index) => `reports/${id}/${index}`;

export function parseByteRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return null;
  return { start, end };
}

export async function serveReportFile(request, bucket, id, index, attachment) {
  const { name, size, type } = attachment;
  const requested = request.headers.get('Range');
  const partial = requested ? parseByteRange(requested, size) : null;
  const headers = new Headers({
    'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Type': type
  });
  if (requested && !partial) {
    headers.set('Content-Range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  const length = partial ? partial.end - partial.start + 1 : size;
  const inline = type !== 'image/heic' && !new URL(request.url).searchParams.has('download');
  const filename = encodeURIComponent(name).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16));
  headers.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${filename}`);
  headers.set('Content-Length', String(length));
  if (partial) headers.set('Content-Range', `bytes ${partial.start}-${partial.end}/${size}`);
  const object = await bucket.get(reportFileKey(id, index), partial ? { range: { offset: partial.start, length } } : undefined);
  if (!object) return new Response('附件已不可用。', { status: 404 });
  return new Response(request.method === 'HEAD' ? null : object.body, { status: partial ? 206 : 200, headers });
}

export function memoryReportBucket() {
  const files = new Map();
  return {
    async put(key, data) { files.set(key, new Uint8Array(await new Response(data).arrayBuffer())); },
    get(key, options) {
      const bytes = files.get(key);
      const range = options?.range;
      return bytes ? { body: range ? bytes.subarray(range.offset, range.offset + range.length) : bytes } : null;
    },
    async delete(keys) { for (const key of keys) files.delete(key); }
  };
}
