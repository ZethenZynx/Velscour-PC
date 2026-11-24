// Reproducibly synthesize the short Iron Express notification whistle as PCM WAV.
import { writeFile } from 'node:fs/promises';

const sampleRate = 44_100;
const seconds = 1.4;
const count = Math.round(sampleRate * seconds);
const data = Buffer.alloc(count * 2);
let noiseState = 0;
let seed = 911;
const random = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

for (let i = 0; i < count; i++) {
  const t = i / sampleRate;
  const attack = Math.min(1, t / 0.055);
  const release = t < 0.92 ? 1 : Math.max(0, (seconds - t) / 0.48);
  const envelope = attack * release;
  const glide = 0.976 + 0.024 * Math.min(1, t / 0.12) - 0.012 * (t / seconds);
  const vibrato = 1 + 0.003 * Math.sin(2 * Math.PI * 4.1 * t);
  let sum = 0;
  for (const [base, amplitude] of [[293.66, 0.30], [369.99, 0.23], [440, 0.17]]) {
    const frequency = base * glide * vibrato;
    sum += amplitude * Math.sin(2 * Math.PI * frequency * t);
    sum += amplitude * 0.24 * Math.sin(2 * Math.PI * 2 * frequency * t + 0.12);
    sum += amplitude * 0.075 * Math.sin(2 * Math.PI * 3 * frequency * t + 0.31);
  }
  noiseState = 0.88 * noiseState + 0.12 * (random() * 2 - 1);
  const steamEnvelope = t < 0.06 ? t / 0.06 : t < 0.8 ? 0.35 : Math.max(0, (seconds - t) / 0.6);
  const sample = Math.max(-0.98, Math.min(0.98, (sum * envelope + noiseState * 0.1 * steamEnvelope) * 0.78));
  data.writeInt16LE(Math.round(sample * 32767), i * 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);

await writeFile('assets/audio/sfx/iron_express_whistle.wav', Buffer.concat([header, data]));
console.log(`Wrote 1.4-second ${sampleRate} Hz mono whistle WAV.`);
