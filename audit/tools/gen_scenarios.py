#!/usr/bin/env python3
"""Harder synthetic tracks for the beat detector (pure stdlib).
Usage: python3 audit/tools/gen_scenarios.py [out_dir]
Each track gets a sidecar <name>.json with the true kick times and the tempo per segment.
  tempo_change   128 BPM for 40 s, then 140 BPM for 40 s
  breakdown      128 BPM 30 s, 16 s of pads only (no drums), 128 BPM 30 s
  swing          124 BPM kick + swung 16th hats (66 %)
  quiet          128 BPM at -40 dBFS
  clipped        128 BPM driven 20 dB into hard clipping
  halftime       140 BPM grid, kick on 1 and 3 only, snare on 2 and 4
  dnb            174 BPM two-step: kick on 1 and the 'and' of 2, snare on 2 and 4
  drift          125 -> 129 BPM linear tempo ramp over 80 s
"""
import json, math, os, random, struct, sys, wave

SR = 48000
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'tracks')
os.makedirs(out, exist_ok=True)
rnd = random.Random(3)

def kick():
    return [0.9 * math.sin(2 * math.pi * (55 * (i / SR) + 90 * (1 - math.exp(-(i / SR) * 30)) / 30)) * math.exp(-(i / SR) * 9) + (0.3 * math.exp(-(i / SR) * 400) if i < 200 else 0) for i in range(int(SR * .35))]
def hat():
    h = [(rnd.random() * 2 - 1) * .2 * math.exp(-(i / SR) * 70) for i in range(int(SR * .06))]
    return [h[i] - (h[i - 1] if i else 0) for i in range(len(h))]
def snare():
    return [((rnd.random() * 2 - 1) * .35 + .25 * math.sin(2 * math.pi * 190 * i / SR)) * math.exp(-(i / SR) * 18) for i in range(int(SR * .25))]
K, Hh, Sn = kick(), hat(), snare()

def stamp(buf, s, at):
    i0 = int(at * SR)
    for i, v in enumerate(s):
        if 0 <= i0 + i < len(buf):
            buf[i0 + i] += v

def pad(buf, t0, t1):
    for i in range(int(t0 * SR), min(len(buf), int(t1 * SR))):
        t = i / SR
        buf[i] += .12 * (math.sin(2 * math.pi * 220 * t) + .7 * math.sin(2 * math.pi * 277.2 * t) + .5 * math.sin(2 * math.pi * 329.6 * t)) * (.6 + .4 * math.sin(2 * math.pi * .25 * t))

def write(name, buf, meta, gain=1.0, drive=None):
    with wave.open(os.path.join(out, name + '.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        b = bytearray()
        for v in buf:
            v *= gain
            if drive: v = max(-1, min(1, v * drive))
            b += struct.pack('<h', int(max(-1, min(1, v)) * 32767))
        w.writeframes(bytes(b))
    json.dump(meta, open(os.path.join(out, name + '.json'), 'w'))

def four(buf, t0, t1, bpm, hats=True, swing=None):
    kicks, per, t = [], 60 / bpm, t0
    while t < t1 - 1e-6:
        stamp(buf, K, t); kicks.append(round(t, 4))
        if hats:
            if swing:
                for j in range(4):
                    off = per / 4 * j + (per / 4 * (swing - .5) * 2 if j % 2 else 0)
                    if j: stamp(buf, Hh, t + off)
            else:
                stamp(buf, Hh, t + per / 2)
        t += per
    return kicks

N = lambda s: [0.0] * int(SR * s)
b = N(80); k = four(b, 0, 40, 128) + four(b, 40 + (60 / 128 - (40 % (60 / 128))) % (60 / 128), 80, 140)
write('tempo_change', b, {'kicks': k, 'segments': [[0, 40, 128], [40, 80, 140]]})
b = N(76); k = four(b, 0, 30, 128); pad(b, 30, 46); k += four(b, 30 + 16 + (60 / 128 - (46 % (60 / 128))) % (60 / 128) - 16 + 16 - 16 + 0, 76, 128) if False else k + four(b, 46.0, 76, 128)
pad(b, 0, 76)
write('breakdown', b, {'kicks': k, 'segments': [[0, 30, 128], [30, 46, 0], [46, 76, 128]]})
b = N(80); k = four(b, 0, 80, 124, swing=.66); write('swing', b, {'kicks': k, 'segments': [[0, 80, 124]]})
b = N(80); k = four(b, 0, 80, 128); write('quiet', b, {'kicks': k, 'segments': [[0, 80, 128]]}, gain=0.01)
b = N(80); k = four(b, 0, 80, 128); write('clipped', b, {'kicks': k, 'segments': [[0, 80, 128]]}, drive=10)
b = N(80); per = 60 / 140; k = []; t = 0; n = 0
while t < 80:
    if n % 4 in (0, 2): stamp(b, K, t); k.append(round(t, 4))
    else: stamp(b, Sn, t)
    stamp(b, Hh, t + per / 2); t += per; n += 1
write('halftime', b, {'kicks': k, 'segments': [[0, 80, 140]], 'note': 'kick 1+3, snare 2+4 on a 140 grid'})
b = N(80); per = 60 / 174; k = []; t = 0; n = 0
while t < 80:
    if n % 2 == 0: stamp(b, K, t); k.append(round(t, 4)); stamp(b, K, t + per * 1.5)
    else: stamp(b, Sn, t)
    stamp(b, Hh, t + per / 2); t += per; n += 1
write('dnb', b, {'kicks': k, 'segments': [[0, 80, 174]]})
b = N(80); k = []; t = 0.0
while t < 80:
    bpm = 125 + 4 * t / 80; stamp(b, K, t); k.append(round(t, 4)); stamp(b, Hh, t + 30 / bpm); t += 60 / bpm
write('drift', b, {'kicks': k, 'segments': [[0, 80, 'ramp 125-129']]})
print('scenario tracks in', os.path.abspath(out))
