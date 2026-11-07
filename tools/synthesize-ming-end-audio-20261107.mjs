#!/usr/bin/env node
/**
 * Reproduce all Ming-end sound assets with Node's standard library and a local
 * FFmpeg build containing libmp3lame:
 *   MING_END_FFMPEG=/path/to/ffmpeg node tools/synthesize-ming-end-audio-20261107.mjs
 *
 * Original composition and procedural synthesis for this repository. No samples,
 * recordings, borrowed melodies, synthesis packages, services, or game RNG are used.
 * The instrumental colors suggest plucked strings, soft glass and breath; they are
 * deliberately not claimed to be recordings of historically authentic instruments.
 * Mono 22,050 Hz / 64 kbps MP3 is registered by Cocos Creator 3.8.8 and keeps the
 * complete sound pack below 1.5 MiB. Circular note/room tails, periodic filter state,
 * a 12 ms zero-crossing taper and retained Xing/LAME trim metadata avoid padded gaps.
 * Non-looping cues have explicit attack/release and room tails, including the quiet,
 * non-celebratory death and ending sounds. The JSON provenance includes file hashes,
 * synthesis parameters and levels measured by decoding each final MP3, sequentially.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const DESTINATION = join(REPO, 'assets/resources/audio/ming_end');
const RATE = 22050;
const AMBIENCE_SECONDS = 16;
const TAU = Math.PI * 2;
const SEED = 0x16381644;
const manifest = [];
const FFMPEG = process.env.MING_END_FFMPEG || 'ffmpeg';
const ENCODER_VERSION = runEncoder(['-version']).toString().split('\n')[0];
if (!runEncoder(['-hide_banner', '-encoders']).toString().includes('libmp3lame')) {
  throw new Error('MING_END_FFMPEG must point to a local FFmpeg build containing libmp3lame.');
}

function runEncoder(args, input) {
  const result = spawnSync(FFMPEG, args, { input, maxBuffer: 8 * 1048576 });
  if (result.error || result.status !== 0) {
    throw new Error(`Local audio encoder failed: ${result.error?.message || result.stderr?.toString()}`);
  }
  return result.stdout;
}

function measureDecodedPcm(bytes) {
  if (!bytes.length || bytes.length % 2 !== 0) throw new Error('Invalid decoded PCM data');
  const frames = bytes.length / 2;
  const window = Math.min(Math.round(RATE * 0.01), frames);
  let squares = 0;
  let peak = 0;
  let firstSquares = 0;
  let lastSquares = 0;
  let leadingBlank = 0;
  let trailingBlank = 0;
  for (let i = 0; i < frames; i++) {
    const sample = bytes.readInt16LE(i * 2) / 32768;
    squares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
    if (i < window) firstSquares += sample * sample;
    if (i >= frames - window) lastSquares += sample * sample;
  }
  while (leadingBlank < frames && Math.abs(bytes.readInt16LE(leadingBlank * 2)) <= 1) leadingBlank++;
  while (trailingBlank < frames && Math.abs(bytes.readInt16LE((frames - trailingBlank - 1) * 2)) <= 1) trailingBlank++;
  const jump = Math.abs(bytes.readInt16LE(0) - bytes.readInt16LE(bytes.length - 2)) / 32768;
  return { frames, peakDbfs: 20 * Math.log10(Math.max(peak, 1e-9)),
    rmsDbfs: 20 * Math.log10(Math.max(Math.sqrt(squares / frames), 1e-9)),
    leadingBlankMs: leadingBlank * 1000 / RATE, trailingBlankMs: trailingBlank * 1000 / RATE,
    boundaryJumpDbfs: 20 * Math.log10(Math.max(jump, 1e-9)),
    first10msRmsDbfs: 20 * Math.log10(Math.max(Math.sqrt(firstSquares / window), 1e-9)),
    last10msRmsDbfs: 20 * Math.log10(Math.max(Math.sqrt(lastSquares / window), 1e-9)) };
}

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function addNote(target, start, duration, midi, amplitude, color = 'pluck', circular = true) {
  const startFrame = Math.round(start * RATE);
  const frames = Math.round(duration * RATE);
  const frequency = 440 * 2 ** ((midi - 69) / 12);
  for (let i = 0; i < frames; i++) {
    const destination = startFrame + i;
    if (!circular && destination >= target.length) break;
    const t = i / RATE;
    const phase = TAU * frequency * t;
    const attack = Math.min(1, t / (color === 'pad' ? 0.32 : color === 'wood' ? 0.002 : 0.012));
    const release = Math.sin(Math.min(1, (frames - i - 1) / (RATE * 0.12)) * Math.PI / 2) ** 2;
    let envelope;
    let wave;
    switch (color) {
      case 'pad':
        envelope = Math.sin(Math.PI * i / frames) ** 2;
        wave = Math.sin(phase + 0.008 * Math.sin(TAU * 0.35 * t))
          + 0.23 * Math.sin(phase * 2) + 0.08 * Math.sin(phase * 3);
        break;
      case 'glass':
        envelope = attack * Math.exp(-3.8 * t / duration) * release;
        wave = 0.74 * Math.sin(phase + 0.55 * Math.exp(-5 * t) * Math.sin(phase * 2))
          + 0.17 * Math.sin(phase * 2.008) * Math.exp(-3 * t)
          + 0.05 * Math.sin(phase * 3.99) * Math.exp(-7 * t);
        break;
      case 'bass':
        envelope = Math.min(1, t / 0.035) * Math.exp(-2.8 * t / duration) * release;
        wave = Math.sin(phase) + 0.22 * Math.sin(phase * 2) + 0.06 * Math.sin(phase * 3);
        break;
      case 'wood':
        envelope = attack * Math.exp(-42 * t) * release;
        wave = Math.sin(phase + 0.45 * Math.exp(-35 * t))
          + 0.36 * Math.sin(phase * 2.73) + 0.15 * Math.sin(phase * 4.13);
        break;
      default:
        envelope = attack * Math.exp(-4.5 * t / duration) * release;
        wave = Math.sin(phase) + 0.31 * Math.sin(phase * 2.002) * Math.exp(-2.3 * t)
          + 0.12 * Math.sin(phase * 3.995) * Math.exp(-5.5 * t)
          + 0.045 * Math.sin(phase * 6.01) * Math.exp(-9 * t);
    }
    target[destination % target.length] += wave * envelope * amplitude;
  }
}

function addSwell(target, start, duration, amplitude, seed, circular = true) {
  const random = rng(seed);
  const startFrame = Math.round(start * RATE);
  const frames = Math.round(duration * RATE);
  let low = 0;
  let smooth = 0;
  for (let i = 0; i < frames; i++) {
    const destination = startFrame + i;
    if (!circular && destination >= target.length) break;
    low += 0.16 * (random() * 2 - 1 - low);
    smooth += 0.035 * (low - smooth);
    const envelope = Math.sin(Math.PI * i / frames) ** 2;
    target[destination % target.length] += (low - smooth) * envelope * amplitude;
  }
}

function addDrop(target, start, amplitude, frequency) {
  const frames = Math.round(0.42 * RATE);
  const startFrame = Math.round(start * RATE);
  let phase = 0;
  for (let i = 0; i < frames; i++) {
    const t = i / RATE;
    phase += TAU * (frequency * (0.6 + 0.4 * Math.exp(-t * 18))) / RATE;
    const envelope = Math.min(1, t / 0.008) * Math.exp(-t * 15)
      * Math.sin(Math.min(1, (frames - i - 1) / (0.04 * RATE)) * Math.PI / 2) ** 2;
    target[(startFrame + i) % target.length] += Math.sin(phase) * amplitude * envelope;
  }
}

function filteredNoise(frames, seed, cutoff) {
  const random = rng(seed);
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) samples[i] = random() * 2 - 1;
  lowpass(samples, cutoff, true);
  return samples;
}

function lowpass(samples, cutoff, circular) {
  const alpha = 1 - Math.exp(-TAU * cutoff / RATE);
  let previous = 0;
  // One warm-up period converges to the periodic filter state before output is kept.
  if (circular) for (const sample of samples) previous += alpha * (sample - previous);
  for (let i = 0; i < samples.length; i++) {
    previous += alpha * (samples[i] - previous);
    samples[i] = previous;
  }
}

function room(samples, circular, amount = 1) {
  const dry = Float32Array.from(samples);
  const taps = [[0.087, 0.12], [0.149, 0.075], [0.233, 0.045], [0.371, 0.025]];
  for (const [seconds, gain] of taps) {
    const delay = Math.round(seconds * RATE);
    for (let i = 0; i < samples.length; i++) {
      const source = i - delay;
      if (source >= 0 || circular) samples[i] += dry[(source + dry.length) % dry.length] * gain * amount;
    }
  }
}

function stitchLoop(samples) {
  // MP3's first/last transform windows do not share circular context. Taper only
  // six milliseconds on each side to a genuine zero crossing, not a silent pad.
  const half = Math.round(0.006 * RATE);
  for (let i = 0; i < half; i++) {
    const gain = Math.sin(Math.PI * i / (half - 1) / 2) ** 2;
    samples[i] *= gain;
    samples[samples.length - 1 - i] *= gain;
  }
}

function composeMusic(name) {
  const bpm = name === 'home' ? 80 : name === 'life' ? 84 : 64;
  const beat = 60 / bpm;
  const bar = beat * 4;
  const samples = new Float32Array(Math.round(bar * 8 * RATE));
  const chords = name === 'life'
    ? [[50, 57, 62], [47, 54, 62], [43, 50, 59], [45, 52, 61], [50, 57, 64], [47, 54, 62], [43, 57, 62], [45, 57, 64]]
    : [[50, 57, 65], [46, 53, 62], [43, 50, 62], [45, 52, 64], [50, 57, 65], [46, 53, 60], [43, 57, 62], [45, 57, 64]];
  for (let measure = 0; measure < 8; measure++) {
    const time = measure * bar;
    for (const note of chords[measure]) {
      addNote(samples, time, bar * 1.85, note, name === 'ending' ? 0.028 : 0.023, 'pad');
    }
    addNote(samples, time + beat * 0.04, bar * 0.95, chords[measure][0], 0.095, 'bass');
    if (name === 'life') {
      addNote(samples, time + beat * 2, beat * 1.4, chords[measure][1], 0.026, 'pluck');
      addNote(samples, time + beat * 0.01, 0.17, 43, 0.04, 'wood');
      addNote(samples, time + beat * 2.5, 0.15, 55, 0.025, 'wood');
    }
  }
  // Explicit original 8-bar phrases. Values are MIDI notes and beat offsets,
  // not imported tunes or a generator driven by the simulation's random stream.
  const melody = name === 'home' ? [
    [[0.5, 74], [2, 69], [3, 72]], [[0.75, 77], [2.5, 74]],
    [[0, 79], [1.5, 77], [3, 74]], [[1, 76], [2.5, 69]],
    [[0.5, 74], [1.75, 81], [3, 79]], [[0.75, 77], [2.5, 72]],
    [[0, 74], [1.5, 69], [3, 67]], [[0.75, 69], [2.25, 72], [3.25, 69]],
  ] : name === 'life' ? [
    [[0.5, 66], [1.5, 69], [2.75, 74]], [[0.5, 71], [2.5, 69]],
    [[0.75, 67], [2, 69], [3, 71]], [[0.5, 69], [2.5, 64]],
    [[0.5, 66], [1.5, 69], [2.75, 76]], [[0.5, 74], [2.5, 71]],
    [[0.75, 69], [2, 67], [3, 66]], [[0.5, 64], [2.5, 69]],
  ] : [
    [[1, 69]], [[0.75, 65], [2.75, 62]], [[1.5, 67]], [[1, 64], [3, 69]],
    [[1, 74]], [[0.75, 72], [2.75, 65]], [[1.5, 69]], [[0.75, 64], [2.75, 62]],
  ];
  for (let measure = 0; measure < melody.length; measure++) {
    for (const [offset, note] of melody[measure]) {
      const duration = name === 'ending' ? beat * 3.4 : beat * 2.0;
      addNote(samples, measure * bar + offset * beat, duration, note,
        name === 'ending' ? 0.095 : 0.11, name === 'home' ? 'glass' : 'pluck');
      if (name === 'home') addNote(samples, measure * bar + offset * beat + 0.14, duration, note - 12, 0.022, 'pluck');
    }
  }
  if (name === 'home') {
    for (let i = 0; i < 4; i++) addSwell(samples, i * bar * 2 + beat, bar * 1.6, 0.075, SEED + i);
    for (let i = 0; i < samples.length; i++) {
      const t = i / RATE;
      // Whole-number oscillator cycles preserve the portal's quiet underlying loop.
      const period = samples.length / RATE;
      samples[i] += 0.012 * Math.sin(TAU * Math.round(146.83 * period) * t / period)
        * (0.65 + 0.35 * Math.cos(TAU * 4 * t / period));
    }
  }
  room(samples, true, name === 'ending' ? 1.25 : 0.9);
  lowpass(samples, name === 'life' ? 4300 : 3600, true);
  return { samples, bpm };
}

function composeAmbience(region) {
  const frames = RATE * AMBIENCE_SECONDS;
  const samples = new Float32Array(frames);
  const bed = filteredNoise(frames, SEED + 71, region === 'shanbei' ? 850 : 1200);
  const soft = Float32Array.from(bed);
  lowpass(soft, region === 'capital' ? 260 : 75, true);
  for (let i = 0; i < frames; i++) {
    const t = i / RATE;
    const cycle = TAU * t / AMBIENCE_SECONDS;
    if (region === 'shanbei') {
      const gust = 0.55 + 0.18 * Math.sin(cycle + 0.4) + 0.12 * Math.sin(cycle * 3 - 0.8)
        + 0.09 * Math.sin(cycle * 7);
      samples[i] = (bed[i] - soft[i] * 0.65) * gust * 0.8;
      samples[i] += 0.006 * Math.sin(TAU * 166 * t) * (0.5 + 0.5 * Math.sin(cycle * 2));
    } else if (region === 'capital') {
      // Diffuse nonverbal noise, cloth and wood: no fabricated speech or sampled crowds.
      const movement = 0.66 + 0.12 * Math.sin(cycle * 5) + 0.07 * Math.cos(cycle * 9);
      samples[i] = (soft[i] * 0.7 + bed[i] * 0.2) * movement;
      samples[i] += soft[i] * 0.15 * Math.sin(TAU * 132 * t);
    } else {
      const lap = 0.58 + 0.18 * Math.sin(cycle * 11) + 0.1 * Math.sin(cycle * 5 + 1);
      samples[i] = (bed[i] - soft[i] * 0.4) * lap * 0.45;
    }
  }
  if (region === 'capital') {
    for (const [index, time] of [0.65, 2.15, 4.85, 6.9, 9.35, 11.8, 14.1, 15.15].entries()) {
      addNote(samples, time * AMBIENCE_SECONDS / 16, 0.17, index % 2 ? 51 : 47, 0.048, 'wood');
      addSwell(samples, time * AMBIENCE_SECONDS / 16 + 0.15, 0.6, 0.065, SEED + index + 100);
    }
    addNote(samples, 3.8 * AMBIENCE_SECONDS / 16, 0.48, 86, 0.012, 'glass');
    addNote(samples, 12.6 * AMBIENCE_SECONDS / 16, 0.55, 81, 0.014, 'glass');
  } else if (region === 'jiangnan') {
    for (const [index, time] of [0.5, 1.9, 4.15, 5.5, 7.95, 10.2, 11.85, 14.6].entries()) {
      addDrop(samples, time * AMBIENCE_SECONDS / 16, index % 3 === 0 ? 0.07 : 0.045, 690 + index % 4 * 130);
    }
  } else {
    for (let i = 0; i < 4; i++) addSwell(samples, (0.4 + i * 3.8) * AMBIENCE_SECONDS / 16,
      2.9 * AMBIENCE_SECONDS / 16, 0.12, SEED + i + 200);
  }
  room(samples, true, region === 'jiangnan' ? 0.4 : 0.2);
  lowpass(samples, 4200, true);
  return samples;
}

function composeCue(name) {
  const durations = { tap: 0.11, reveal: 1.08, select: 0.32, error: 0.44, choice: 0.52,
    gain: 0.92, achievement: 1.9, ending: 2.6, death: 2.4, item: 1.02, identity: 1.3 };
  const samples = new Float32Array(Math.round(durations[name] * RATE));
  const note = (time, duration, midi, gain, color = 'glass') => addNote(samples, time, duration, midi, gain, color, false);
  switch (name) {
    case 'tap':
      note(0, 0.1, 79, 0.18, 'wood');
      break;
    case 'select':
      note(0, 0.18, 74, 0.13, 'pluck');
      note(0.055, 0.22, 81, 0.11);
      break;
    case 'error':
      note(0, 0.22, 62, 0.12, 'pluck');
      note(0.13, 0.25, 60, 0.1, 'pluck');
      break;
    case 'choice':
      note(0, 0.16, 47, 0.1, 'wood');
      note(0.045, 0.32, 62, 0.1, 'pluck');
      note(0.135, 0.32, 69, 0.09);
      break;
    case 'reveal':
      addSwell(samples, 0, 0.65, 0.18, SEED + 300, false);
      note(0.08, 0.8, 62, 0.12);
      note(0.18, 0.75, 69, 0.08);
      note(0.3, 0.65, 74, 0.07);
      break;
    case 'gain':
      for (const [i, midi] of [67, 74, 79].entries()) note(i * 0.09, 0.6, midi, 0.11);
      note(0.28, 0.45, 86, 0.035);
      break;
    case 'achievement':
      for (const [i, midi] of [62, 66, 69, 74].entries()) note(i * 0.15, 1.1, midi, 0.1);
      for (const midi of [50, 57, 66]) note(0.25, 1.45, midi, 0.035, 'pad');
      break;
    case 'ending':
      for (const [i, midi] of [62, 69, 65, 74].entries()) note(i * 0.3, 1.4, midi, 0.085, 'pluck');
      for (const midi of [50, 57, 65]) note(0.1, 2.2, midi, 0.025, 'pad');
      break;
    case 'death':
      // Quiet, grounded release: no stinger, heartbeat, scream or celebratory ascent.
      note(0, 1.8, 62, 0.06, 'pluck');
      note(0.24, 1.7, 57, 0.055, 'pluck');
      note(0.5, 1.7, 50, 0.055, 'pad');
      break;
    case 'item':
      note(0, 0.12, 67, 0.08, 'wood');
      note(0.05, 0.76, 67, 0.11, 'pluck');
      note(0.18, 0.68, 74, 0.08);
      break;
    case 'identity':
      note(0, 0.15, 43, 0.085, 'wood');
      for (const [i, midi] of [62, 69, 74].entries()) note(0.05 + i * 0.17, 0.75, midi, 0.095, 'pluck');
      break;
    default:
      throw new Error(`Unknown authored cue: ${name}`);
  }
  room(samples, false, name === 'tap' ? 0.15 : 0.75);
  lowpass(samples, name === 'death' ? 2400 : 4600, false);
  const releaseFrames = Math.min(Math.round(RATE * 0.055), Math.floor(samples.length / 4));
  for (let i = 0; i < releaseFrames; i++) {
    const gain = Math.sin(Math.PI * i / (releaseFrames - 1) / 2) ** 2;
    samples[samples.length - 1 - i] *= gain;
  }
  samples[0] = 0;
  samples[samples.length - 1] = 0;
  return samples;
}

function wav(samples, looping, targetRms, seed) {
  let sum = 0;
  for (const value of samples) sum += value;
  const mean = sum / samples.length;
  for (let i = 0; i < samples.length; i++) samples[i] -= mean;
  if (looping) stitchLoop(samples);
  let squares = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    squares += samples[i] ** 2;
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  const rms = Math.sqrt(squares / samples.length);
  // Rendering an empty/non-finite waveform is a generator error, never a silent asset fallback.
  if (!(rms > 0.00001) || !Number.isFinite(peak)) throw new Error('Invalid synthesis output');
  const gain = Math.min(targetRms / rms, 0.66 / peak);
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(RATE, 24);
  bytes.writeUInt32LE(RATE * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples.length * 2, 40);
  const random = rng(seed);
  let renderedSquares = 0;
  let renderedPeak = 0;
  for (let i = 0; i < samples.length; i++) {
    // Deterministic TPDF dither, with genuinely zero boundary samples on every file.
    const value = i === 0 || i === samples.length - 1 ? 0
      : Math.round(samples[i] * gain * 32767 + (random() - random()) * 0.5);
    bytes.writeInt16LE(value, 44 + i * 2);
    renderedSquares += (value / 32768) ** 2;
    renderedPeak = Math.max(renderedPeak, Math.abs(value / 32768));
  }
  return { bytes, peakDbfs: 20 * Math.log10(renderedPeak),
    rmsDbfs: 20 * Math.log10(Math.sqrt(renderedSquares / samples.length)) };
}

function stableUuid(path) {
  const hex = createHash('sha1').update(`ming-end-original-audio:20261107:${path}`).digest().subarray(0, 16);
  hex[6] = hex[6] & 0x0f | 0x50;
  hex[8] = hex[8] & 0x3f | 0x80;
  return `${hex.subarray(0, 4).toString('hex')}-${hex.subarray(4, 6).toString('hex')}-${hex.subarray(6, 8).toString('hex')}-${hex.subarray(8, 10).toString('hex')}-${hex.subarray(10).toString('hex')}`;
}

async function writeMeta(path, importer, files = [], userData = {}) {
  await writeFile(`${path}.meta`, `${JSON.stringify({ ver: importer === 'directory' ? '1.2.0' : importer === 'audio-clip' ? '1.0.3' : '1.0.0',
    importer, imported: true, uuid: stableUuid(relative(REPO, path).replaceAll('\\', '/')),
    files, subMetas: {}, userData }, null, 2)}\n`);
}

async function emit(path, samples, loop, description, extra = {}) {
  const targetRms = path.startsWith('music/') ? 0.105 : path.startsWith('ambience/') ? 0.075
    : path === 'cues/death' ? 0.09 : 0.125;
  const rendered = wav(samples, loop, targetRms, SEED + manifest.length * 101);
  const file = join(DESTINATION, `${path}.mp3`);
  // The seekable output file is required: a stdout MP3 cannot retain the final
  // Xing/LAME delay/padding values. One process/file at a time keeps memory bounded.
  runEncoder(['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1',
    '-f', 'wav', '-i', 'pipe:0', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
    '-c:a', 'libmp3lame', '-b:a', '64k', '-ar', String(RATE), '-ac', '1', '-write_xing', '1', '-y', file], rendered.bytes);
  const encoded = await readFile(file);
  const decoded = runEncoder(['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1',
    '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(RATE), 'pipe:1']);
  const measured = measureDecodedPcm(decoded);
  const hasTrimMetadata = encoded.subarray(0, 2048).includes(Buffer.from('Xing'))
    || encoded.subarray(0, 2048).includes(Buffer.from('Info'));
  if (!hasTrimMetadata || measured.rmsDbfs < -50 || Math.abs(measured.frames - samples.length) > 32) {
    throw new Error(`Invalid or untrimmed MP3 output: ${path}`);
  }
  if (loop && (measured.leadingBlankMs > 2 || measured.trailingBlankMs > 2 || measured.boundaryJumpDbfs > -34)) {
    throw new Error(`MP3 loop has an unacceptable boundary: ${path} ${JSON.stringify(measured)}`);
  }
  await writeMeta(file, 'audio-clip', ['.json', '.mp3'], { downloadMode: 0, duration: samples.length / RATE });
  // Clean cutover of this generator's former PCM outputs; never ship duplicate media.
  await rm(join(DESTINATION, `${path}.wav`), { force: true });
  await rm(join(DESTINATION, `${path}.wav.meta`), { force: true });
  const rounded = Object.fromEntries(Object.entries(measured).map(([key, value]) => [key, Number(value.toFixed(6))]));
  manifest.push({ resource: `audio/ming_end/${path}`, file: `${path}.mp3`, loop,
    durationSeconds: Number((samples.length / RATE).toFixed(6)), sourceFrames: samples.length,
    bytes: encoded.length, sha256: createHash('sha256').update(encoded).digest('hex'),
    decoded: { ...rounded, frameDifference: measured.frames - samples.length, hasXingLameTrimMetadata: hasTrimMetadata },
    description, ...extra });
  console.log(`${path}.mp3: ${(samples.length / RATE).toFixed(3)}s, ${encoded.length} bytes, decoded ${measured.frames} frames, RMS ${measured.rmsDbfs.toFixed(1)} dBFS${loop ? `, seam ${measured.boundaryJumpDbfs.toFixed(1)} dBFS` : ''}`);
}

await mkdir(DESTINATION, { recursive: true });
for (const folder of ['music', 'ambience', 'cues'].map(name => join(DESTINATION, name))) {
  await mkdir(folder, { recursive: true });
  await writeMeta(folder, 'directory');
}
for (const [name, description] of [
  ['home', 'Original 8-bar portal theme: suspended ink-blue pad, sparse glass melody, lower plucked echoes and a soft breath swell.'],
  ['life', 'Original 8-bar life theme: warm, restrained pentatonic plucked phrases, rounded bass and quiet wooden pulses.'],
  ['ending', 'Original 8-bar reflective ending theme: spacious descending/answering plucked phrases and a soft sustained bed, no fanfare.'],
]) {
  const { samples, bpm } = composeMusic(name);
  await emit(`music/${name}`, samples, true, description, { bpm, bars: 8, meter: '4/4' });
}
for (const [region, description] of [
  ['shanbei', 'Original synthetic dry wind: periodic low-passed noise gusts, light grain and restrained reed-like air resonance.'],
  ['capital', 'Original synthetic market bed: diffuse nonverbal murmur, cloth swishes, distant wood steps and two light metal tints; no speech or recordings.'],
  ['jiangnan', 'Original synthetic water bed: soft lapping noise with irregular damped droplets; no recordings.'],
]) await emit(`ambience/${region}`, composeAmbience(region), true, description);
for (const cue of ['tap', 'reveal', 'select', 'error', 'choice', 'gain', 'achievement', 'ending', 'death', 'item', 'identity']) {
  await emit(`cues/${cue}`, composeCue(cue), false, `Original ${cue} cue; explicitly scored in the source generator with softened envelope and room tail.`);
}
const totalBytes = manifest.reduce((sum, entry) => sum + entry.bytes, 0);
if (totalBytes > 1.5 * 1048576) throw new Error(`Audio pack exceeds the authored 1.5 MiB cap: ${totalBytes}`);
const provenance = {
  schemaVersion: 2,
  title: 'Ming-end original procedural audio',
  source: 'tools/synthesize-ming-end-audio-20261107.mjs',
  reproduce: 'MING_END_FFMPEG=/path/to/ffmpeg node tools/synthesize-ming-end-audio-20261107.mjs',
  provenance: 'Project-original algorithmic composition and synthesis. No external service, borrowed melody, recording, sample library, speech, or third-party audio was used.',
  rights: 'Original audio created for this repository; no third-party audio license obligations.',
  historicalAuthenticity: 'Synthetic atmospheric and instrumental colors, not documentary recordings or a claim of period-authentic performance.',
  seed: SEED,
  encoding: { container: 'MPEG audio', codec: 'MP3 / libmp3lame', sampleRateHz: RATE, channels: 1, bitrateKbps: 64,
    sourcePcmBits: 16, trimMetadata: 'Xing/LAME retained on seekable files; final files decoded and measured individually.' },
  encoder: { version: ENCODER_VERSION, source: 'imageio-ffmpeg 0.6.0 free manylinux2014_x86_64 wheel from PyPI',
    wheelSha256: 'c7e46fcec401dd990405049d2e2f475e2b397779df2519b544b8aab515195282',
    license: 'The encoder is a GPLv3-enabled FFmpeg build, used only as a local build tool; no encoder binary/library is shipped in this project or audio pack.' },
  loopMethod: 'Circular note/room tails, periodic filter state, whole-cycle tones and a 6 ms sine-squared taper on each edge to an exact zero crossing; Xing/LAME padding retained and decoded edge levels recorded, without silent padding.',
  mobile: { totalWaveformBytes: totalBytes, maximumBytes: 1.5 * 1048576, runtimeLoopSources: 2, runtimeCueVoices: 4,
    loading: 'Preload only short cues. Load music/ambience on request and release superseded loop references.',
    codecChoice: '64 kbps mono MP3 is registered by Cocos and avoids reliance on Ogg support on iOS. OS/WeChat InnerAudioContext may still impose its own loop scheduling gap; device playback must be assessed separately from file-level decode continuity.' },
  assets: manifest,
};
const provenancePath = join(DESTINATION, 'provenance.json');
await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
await writeMeta(provenancePath, 'json', ['.json']);
console.log(`Rendered ${manifest.length} original assets, ${totalBytes} bytes (${(totalBytes / 1048576).toFixed(2)} MiB).`);
