#!/usr/bin/env python3
"""Hostile input files for the Murmur audit.
Usage: python3 audit/tools/make_fixtures.py [out_dir]
"""
import json, os, struct, sys, zlib

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'fixtures')
os.makedirs(out, exist_ok=True)
w = lambda name, data: open(os.path.join(out, name), 'wb').write(data if isinstance(data, bytes) else data.encode())

# --- SVG that tries to run code
w('xss_script.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>window.parent.__xss="script";window.__xss="script"</script><rect width="100" height="100" fill="red"/></svg>')
w('xss_onload.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" onload="window.__xss=\'onload\'"><rect width="100" height="100" fill="lime"/></svg>')
w('xss_foreign.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><foreignObject width="200" height="200"><div xmlns="http://www.w3.org/1999/xhtml" style="background:blue;width:200px;height:200px"><img src="x" onerror="window.__xss=\'foreign\'"/><iframe src="javascript:parent.__xss=\'iframe\'"></iframe></div></foreignObject></svg>')
w('xss_href.svg', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100"><a xlink:href="javascript:window.__xss=\'href\'"><rect width="100" height="100"/></a><image href="https://example.com/x.png" width="10" height="10"/></svg>')
w('nosize.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>')
w('huge_dims.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="200000" height="200000" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>')
# --- broken image: right name and type, wrong bytes
w('broken.png', b'\x89PNG\r\n\x1a\n' + os.urandom(2048))
w('empty.png', b'')

def png(width, height, path):
    raw = b''.join(b'\x00' + b'\x80' * (width * 3) for _ in range(height))
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)

png(12000, 12000, os.path.join(out, 'huge_12000.png'))   # ~576 MB once decoded

# --- scene JSON files
good_layer = {"prog": "pat-burst", "count": 300, "look": {"size": 30}, "phys": {}, "cam": {}, "params": {}, "rows": []}
scenes = {
    'scene_not_json.json': 'hello, this is not json',
    'scene_null.json': 'null',
    'scene_array.json': '[1,2,3]',
    'scene_number.json': '42',
    'scene_foreign.json': json.dumps({"name": "some other app", "version": 3, "tracks": [1, 2]}),
    'scene_unknown_prog.json': json.dumps({"v": 2, "layers": [{"prog": "does-not-exist"}]}),
    'scene_count_string.json': json.dumps({"v": 2, "layers": [dict(good_layer, count="abc")]}),
    'scene_count_huge.json': json.dumps({"v": 2, "layers": [dict(good_layer, count=1000000)]}),
    'scene_damp_negative.json': json.dumps({"v": 2, "layers": [dict(good_layer, phys={"damp": -1})]}),
    'scene_look_strings.json': json.dumps({"v": 2, "layers": [dict(good_layer, look={"size": "big", "scale": None, "varSize": "x"})]}),
    'scene_bad_stops.json': json.dumps({"v": 2, "stops": [{"c": "red", "p": "x"}, {"c": 5, "p": None}]}),
    'scene_v99.json': json.dumps({"v": 99, "layers": [good_layer], "echo": {"amount": 7, "decay": 5}, "kaleido": {"sectors": 400}}),
    'scene_huge.json': json.dumps({"v": 2, "layers": [good_layer], "padding": ["x" * 1000] * 60000}),  # ~60 MB
}
for k, v in scenes.items():
    w(k, v)
print('fixtures in', os.path.abspath(out))
