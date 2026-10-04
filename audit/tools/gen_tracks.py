#!/usr/bin/env python3
"""Generate synthetic test tracks for the Murmur audit (pure stdlib, no numpy).

Usage: python3 audit/tools/gen_tracks.py [out_dir] [seconds]
Writes 48 kHz mono 16-bit WAV files:
  click_<bpm>.wav  four-on-the-floor kick (55 Hz body + click) with an off-beat hat
  silence.wav      digital zero
  noise.wav        white noise, -12 dBFS RMS
  sweep.wav        log sine sweep 20 Hz -> 16 kHz over the whole file
The BPM in the file name is the ground truth.
"""
import math, os, random, struct, sys, wave

SR = 48000


def write_wav(path, samples):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        buf = bytearray()
        for s in samples:
            v = int(max(-1.0, min(1.0, s)) * 32767)
            buf += struct.pack('<h', v)
        w.writeframes(bytes(buf))


def kick_track(bpm, secs, seed=1):
    rnd = random.Random(seed)
    n = int(SR * secs)
    out = [0.0] * n
    per = 60.0 / bpm
    beat = 0
    # Pre-render one kick and one hat, then stamp them.
    kick = []
    for i in range(int(SR * 0.35)):
        t = i / SR
        f = 55 + 90 * math.exp(-t * 30)          # pitch drop
        ph = 2 * math.pi * (55 * t + 90 * (1 - math.exp(-t * 30)) / 30)
        kick.append(0.9 * math.sin(ph) * math.exp(-t * 9) + (0.3 * math.exp(-t * 400) if i < 200 else 0))
    hat = [(rnd.random() * 2 - 1) * 0.25 * math.exp(-(i / SR) * 60) for i in range(int(SR * 0.08))]
    # crude high-pass on the hat: first difference
    hat = [hat[i] - (hat[i - 1] if i else 0) for i in range(len(hat))]
    while True:
        t0 = beat * per
        s0 = int(t0 * SR)
        if s0 >= n:
            break
        for i, v in enumerate(kick):
            if s0 + i < n:
                out[s0 + i] += v
        h0 = int((t0 + per / 2) * SR)
        for i, v in enumerate(hat):
            if h0 + i < n:
                out[h0 + i] += v
        beat += 1
    return out


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'tracks')
    secs = float(sys.argv[2]) if len(sys.argv) > 2 else 90
    os.makedirs(out_dir, exist_ok=True)
    for bpm in (120, 128, 140, 174):
        write_wav(os.path.join(out_dir, 'click_%d.wav' % bpm), kick_track(bpm, secs))
    n = int(SR * secs)
    write_wav(os.path.join(out_dir, 'silence.wav'), [0.0] * n)
    rnd = random.Random(7)
    write_wav(os.path.join(out_dir, 'noise.wav'), [rnd.gauss(0, 0.25) for _ in range(n)])
    f0, f1 = 20.0, 16000.0
    k = math.log(f1 / f0)
    write_wav(os.path.join(out_dir, 'sweep.wav'),
              [0.5 * math.sin(2 * math.pi * f0 * secs / k * (math.exp(k * (i / SR) / secs) - 1)) for i in range(n)])
    print('wrote tracks to', os.path.abspath(out_dir))


if __name__ == '__main__':
    main()
