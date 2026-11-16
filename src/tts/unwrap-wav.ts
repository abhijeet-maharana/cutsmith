/**
 * Some proxies return Gemini TTS's whole WAV file (its header, the audio and a trailing C2PA provenance
 * chunk) wrapped as the audio of a second WAV. Played as is, the inner header is a click at the start
 * and the ~6 KB of C2PA bytes are ~0.1 s of buzz at the end. Returns the innermost audio as a plain WAV
 * (fmt + data chunks only). A normal WAV comes back unchanged apart from dropped extra chunks.
 */
export function unwrapWav(bytes: Uint8Array): Buffer {
  let wav: Buffer = Buffer.from(bytes);
  for (let depth = 0; depth < 4; depth++) {
    const { fmt, data } = wavChunks(wav);
    if (data.subarray(0, 4).toString('ascii') !== 'RIFF') return toWav(fmt, data);
    wav = data;
  }
  throw new Error('[unwrapWav] WAV nested too deep');
}

export function isWav(bytes: Uint8Array): boolean {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(12, bytes.byteLength));
  return b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WAVE';
}

function wavChunks(wav: Buffer): { fmt: Buffer; data: Buffer } {
  if (!isWav(wav)) throw new Error('[unwrapWav] Not a WAV file');
  let fmt: Buffer | undefined;
  for (let at = 12; at + 8 <= wav.length; ) {
    const id = wav.subarray(at, at + 4).toString('ascii');
    const size = wav.readUInt32LE(at + 4);
    const body = wav.subarray(at + 8, Math.min(at + 8 + size, wav.length));
    if (id === 'fmt ') fmt = body;
    if (id === 'data') {
      if (!fmt) throw new Error('[unwrapWav] data chunk before fmt chunk');
      return { fmt, data: body };
    }
    at += 8 + size + (size % 2); // chunks are padded to an even length
  }
  throw new Error('[unwrapWav] No data chunk');
}

function toWav(fmt: Buffer, data: Buffer): Buffer {
  const header = Buffer.alloc(12 + 8 + fmt.length + 8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(header.length - 8 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(fmt.length, 16);
  fmt.copy(header, 20);
  header.write('data', 20 + fmt.length, 'ascii');
  header.writeUInt32LE(data.length, 24 + fmt.length);
  return Buffer.concat([header, data]);
}
