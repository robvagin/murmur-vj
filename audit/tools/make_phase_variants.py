#!/usr/bin/env python3
"""Write experimental variants of audio-core.js's phase correction (for node_scenarios.mjs CORE=...).
Usage: python3 audit/tools/make_phase_variants.py <out_dir>
  orig  as shipped: every onset pulls the phase 10 % toward the nearest whole beat
  gate  only onsets within a quarter beat of a whole beat correct
  bass  only onsets with the bass band above 0.6 correct
  both  bass and gate together
  rise  only onsets where the bass band rose by > 0.2 since the last frame
  slow  only onsets where the bass band is 0.15 above its slow envelope
These are measurements for the owner, not shipped fixes.
"""
import os, sys
here = os.path.dirname(os.path.abspath(__file__))
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
s = open(os.path.join(here, '..', '..', 'audio-core.js')).read()
old = """        if (onsetNow && override == null) {
          var err = phase - Math.round(phase);
          phase -= .1 * err;
        }"""
assert old in s
def v(cond, body='phase -= .1 * err;'):
    return s.replace(old, "        if (onsetNow && override == null%s) {\n          var err = phase - Math.round(phase);\n          %s\n        }" % (cond, body))
open(os.path.join(out, 'orig.js'), 'w').write(s)
open(os.path.join(out, 'gate.js'), 'w').write(v('', 'if (Math.abs(err) < .25) phase -= .1 * err;'))
open(os.path.join(out, 'bass.js'), 'w').write(v(' && bd.bass > .6'))
open(os.path.join(out, 'both.js'), 'w').write(v(' && bd.bass > .6', 'if (Math.abs(err) < .25) phase -= .1 * err;'))
decl = "var lastOnset = -1, onsetEnv = 0, prevFlux = 0, dtEMA = 1 / 60;"
r = v(' && bd.bass - prevBassN > .2').replace(decl, decl + "\n    var prevBassN = 0;").replace("      features.rms = rms;", "      prevBassN = bd.bass;\n      features.rms = rms;")
open(os.path.join(out, 'rise.js'), 'w').write(r)
open(os.path.join(out, 'slow.js'), 'w').write(v(' && bd.bass - e.bassSlow > .15'))
print('variants in', out)
