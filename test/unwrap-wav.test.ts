import { describe, expect, it } from 'vitest';
import { isWav, unwrapWav } from '../src/tts/unwrap-wav';

function wav(data: Buffer, extra: Buffer = Buffer.alloc(0)): Buffer {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); // PCM
  fmt.writeUInt16LE(1, 2); // mono
  fmt.writeUInt32LE(24000, 4);
  fmt.writeUInt32LE(48000, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  const chunk = (id: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.write(id, 0, 'ascii');
    head.writeUInt32LE(body.length, 4);
    return Buffer.concat([head, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const body = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', fmt), chunk('data', data), extra.length ? chunk('c2pa', extra) : Buffer.alloc(0)]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

describe('unwrapWav', () => {
  it('returns the innermost audio of a wrapped WAV', () => {
    const pcm = Buffer.from([1, 2, 3, 4]);
    const inner = wav(pcm, Buffer.alloc(10, 9));
    const out = unwrapWav(wav(inner));
    expect(isWav(out)).toBe(true);
    expect(out.subarray(out.length - 4)).toEqual(pcm);
    expect(out.length).toBe(44 + 4);
  });

  it('rejects other formats', () => {
    expect(isWav(Buffer.from('ID3....'))).toBe(false);
    expect(() => unwrapWav(Buffer.from('not a wav file at all'))).toThrow(/Not a WAV/);
  });
});
