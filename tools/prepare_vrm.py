"""Slim a VRoid VRM for the web: drop normal/specular maps and the thumbnail
(the game renders toon-shaded and never uses them), repacking the binary chunk.
usage: python3 tools/prepare_vrm.py in.vrm out.vrm"""
import json, struct, sys, io
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
b = open(src, 'rb').read()
jl = struct.unpack('<I', b[12:16])[0]
j = json.loads(b[20:20 + jl])
binoff = 20 + jl + 8
data = b[binoff:]

def tiny_png():
    out = io.BytesIO(); Image.new('RGBA', (4, 4), (128, 128, 255, 255)).save(out, 'PNG'); return out.getvalue()

drop = set()
for i, im in enumerate(j['images']):
    n = (im.get('name') or '').lower()
    if n.endswith('_nml') or n.endswith('_spe') or n == 'thumbnail':
        drop.add(im['bufferView'])
# remove normal maps from materials too
for m in j['materials']:
    m.pop('normalTexture', None)
    mt = m.get('extensions', {}).get('VRMC_materials_mtoon')
    if mt:
        for k in ['rimMultiplyTexture', 'matcapTexture']: mt.pop(k, None)

newbin = bytearray()
for k, bv in enumerate(j['bufferViews']):
    start = bv.get('byteOffset', 0); chunk = data[start:start + bv['byteLength']]
    if k in drop: chunk = tiny_png()
    while len(newbin) % 4: newbin += b'\0'
    bv['byteOffset'] = len(newbin); bv['byteLength'] = len(chunk)
    newbin += chunk
while len(newbin) % 4: newbin += b'\0'
j['buffers'][0]['byteLength'] = len(newbin)
js = json.dumps(j, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(newbin))
out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(newbin), 0x004E4942) + newbin
open(dst, 'wb').write(out)
print(f'{len(b)/1e6:.1f} MB -> {len(out)/1e6:.1f} MB')
