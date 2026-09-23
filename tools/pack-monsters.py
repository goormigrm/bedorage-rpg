# 실사 괴물 모델을 게임용 .glb 로 줄인다 (2026-09-19).
#
#   python tools/pack-monsters.py            # 모두
#   python tools/pack-monsters.py ghoul wolf # 몇 종류만
#
# 입력: art-src/monsters/<종류>/src/scene.gltf (Sketchfab 에서 받은 원본을 푼 것 — 저장소에 올리지 않는다)
# 출력: public/assets3d/monsters/<종류>.glb (게임이 그 괴물을 처음 만날 때 받는다)
#
# 서버 없는 게임이라 접속 용량을 아낀다 (사용자 2026-09-19):
# - 텍스처는 512 로 줄여 JPEG 으로. 괴물은 화면에서 60~200px 이다.
# - 금속성·거칠기·가림(AO)·반사 텍스처는 뺀다 — 게임은 Lambert 재질로 그린다. 노멀 맵은 보스만(256).
# - 쓰지 않는 동작 · 모양 키는 뺀다. 동작 키프레임은 초당 15장까지만, 움직이지 않는 뼈의 채널은 키 하나로
#   (게임이 불러올 때 30장 안팎으로 굽는다).
# - 정점: 탄젠트 · 여분 UV 는 뺀다. 인덱스 16비트 · 뼈 번호 8비트 · 뼈 가중치 8비트 · UV 16비트(glTF 기본 규격 안).
#   모양 키는 위치만.
# - 어디서도 쓰지 않게 된 데이터는 버퍼에서 지운다.
# - 면: tris 개로 줄인다(tools/simplify.py — 원래 정점만 남기는 모서리 접기라 뼈 · UV · 모양 키가 그대로 간다).
# 필요한 것: Python 3 + Pillow.

import io
import json
import os
import struct
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from simplify import simplify  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'art-src', 'monsters')
OUT = os.path.join(ROOT, 'public', 'assets3d', 'monsters')

# 종류마다: 텍스처 한 변 · 남길 면 수(tris — tools/simplify.py, 2026-09-23 최적화) · 노멀 맵을 둘지 · 남길 동작 · 남길 모양 키(메시 번호 → 모양 키 번호들)
SPECS = {
    # 구울 · 부푼 시체(같은 파일에 "살찐 몸" 모양 키를 켜서 굽는다)
    'ghoul': dict(tex=512, tris=3200, normal=False, anims=['Attack1.001', 'Idle', 'Walk1'], morph={0: [0, 2], 2: [9, 10]}),
    # 해골: 받은 동작(Take 001)은 쓰지 않는다 — 대기 · 걷기 · 공격 · 맞음 · 죽음 모두 옮겨 붙인 UAL_ 동작 (2026-09-19)
    'archer': dict(tex=512, tris=3000, normal=False, anims=[], morph={}),
    'wolf': dict(tex=512, tris=3000, normal=False, anims=None, morph={}),
    'spider': dict(tex=512, tris=2600, normal=False, anims=['Wolf Spider Armature|Spider walking', 'Wolf Spider Armature|Spider running'], morph={}),
    'queen': dict(tex=512, tris=5000, normal=True, normal_tex=256, anims=['Basic Idle', 'Walk Cycle', 'Leap', 'Take Damage'], morph={}),
    # 도살자 — Pig Demon (2026-09-23). 받은 동작(Take 001)은 쓰지 않는다 — 모두 옮겨 붙인 UAL_ 동작
    'butcher': dict(tex=512, tris=5000, normal=True, normal_tex=256, anims=[], morph={}),
    # 관리인 — Overlord (2026-09-23). 받은 동작(allanimations 50초 한 줄)은 쓰지 않는다 — 모두 UAL_
    'warden': dict(tex=512, tris=4500, normal=True, normal_tex=256, anims=[], morph={}),
    # 심연의 군주 — balrog demon rig (2026-09-23). 네 발 짐승이라 사람형 UAL 은 못 옮긴다 — 받은 동작 하나로
    'lord': dict(tex=512, tris=6000, normal=False, anims=['Armature|ArmatureAction'], morph={}),
}
FPS = 15

COMP = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def pack(kind: str) -> None:
    spec = SPECS[kind]
    d = os.path.join(SRC, kind, 'src')
    j = json.load(open(os.path.join(d, 'scene.gltf'), encoding='utf-8'))
    bin_ = open(os.path.join(d, j['buffers'][0]['uri']), 'rb').read()
    acc = j['accessors']
    bvs = j['bufferViews']

    def read_floats(ai):
        a = acc[ai]
        n = NCOMP[a['type']]
        if a['bufferView'] < 0:  # 여기서 새로 만든 데이터 (빈틈 없이 붙어 있다)
            data = new_views[-a['bufferView'] - 1]
            return [struct.unpack_from('<%df' % n, data, i * 4 * n) for i in range(a['count'])]
        v = bvs[a['bufferView']]
        off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        st = v.get('byteStride', 4 * n)
        return [struct.unpack_from('<%df' % n, bin_, off + i * st) for i in range(a['count'])]

    new_views = []  # 새로 만든 데이터 (accessor 의 bufferView 가 음수 -k 면 new_views[k-1])

    def read_any(ai):
        a = acc[ai]
        v = bvs[a['bufferView']]
        n = NCOMP[a['type']]
        c = COMP[a['componentType']]
        size = struct.calcsize('<' + c)
        off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        st = v.get('byteStride', n * size)
        return [struct.unpack_from('<%d%s' % (n, c), bin_, off + i * st) for i in range(a['count'])]

    def add_raw(data, count, typ, ctype, normalized=False, mins=None, maxs=None):
        new_views.append(data)
        a = {'bufferView': -len(new_views), 'componentType': ctype, 'count': count, 'type': typ}
        if normalized:
            a['normalized'] = True
        if mins is not None:
            a['min'] = mins
            a['max'] = maxs
        acc.append(a)
        return len(acc) - 1

    def add_floats(rows, n, typ):
        data = b''.join(struct.pack('<%df' % n, *r) for r in rows)
        new_views.append(data)
        ai = len(acc)
        mins = [min(r[k] for r in rows) for k in range(n)]
        maxs = [max(r[k] for r in rows) for k in range(n)]
        acc.append({'bufferView': -len(new_views), 'componentType': 5126, 'count': len(rows), 'type': typ, 'min': mins, 'max': maxs})
        return ai

    # 1) 동작: 남길 것만, 키프레임은 초당 FPS 장까지
    if spec['anims'] is not None:
        names = [a.get('name') for a in j.get('animations', [])]
        miss = [n for n in spec['anims'] if n not in names]
        assert not miss, (kind, 'no anim', miss, names)
        j['animations'] = [a for a in j.get('animations', []) if a.get('name') in spec['anims']]
    # 1.5) 옮겨 붙인 동작 (tools/retarget.mjs — UAL CC0): "UAL_<동작>" 으로 덧붙인다
    rt_file = os.path.join(SRC, kind, 'retarget.json')
    if os.path.exists(rt_file):
        rt = json.load(open(rt_file, encoding='utf-8'))
        for clip in rt['clips']:
            if spec.get('ual') is not None and clip['name'] not in spec['ual']:
                continue
            t_in = add_floats([(t,) for t in clip['times']], 1, 'SCALAR')
            an = {'name': clip['name'], 'samplers': [], 'channels': []}
            for tr in clip['tracks']:
                for p, typ in (('rotation', 'VEC4'), ('translation', 'VEC3'), ('scale', 'VEC3')):
                    if p not in tr:
                        continue
                    an['samplers'].append({'input': t_in, 'output': add_floats(tr[p], NCOMP[typ], typ), 'interpolation': 'LINEAR'})
                    an['channels'].append({'sampler': len(an['samplers']) - 1, 'target': {'node': tr['node'], 'path': p}})
            j.setdefault('animations', []).append(an)
    one_key = {}
    one_val = {}
    for an in j.get('animations', []):
        for s in an['samplers']:
            if s.get('interpolation', 'LINEAR') != 'LINEAR':
                continue
            times = [t[0] for t in read_floats(s['input'])]
            if len(times) < 2:
                continue
            out = read_floats(s['output'])
            typ = acc[s['output']]['type']
            if all(max(abs(a - b) for a, b in zip(o, out[0])) < 1e-4 for o in out):
                # 움직이지 않는 뼈 — 키 하나로 (시간 키는 같이 쓴다)
                if times[0] not in one_key:
                    one_key[times[0]] = add_floats([(times[0],)], 1, 'SCALAR')
                s['input'] = one_key[times[0]]
                # 값도 같으면 같이 쓴다 (옮겨 붙인 동작마다 묶음 자세 값이 되풀이된다)
                vk = (typ, tuple(round(x, 5) for x in out[0]))
                if vk not in one_val:
                    one_val[vk] = add_floats([out[0]], NCOMP[typ], typ)
                s['output'] = one_val[vk]
                continue
            if len(times) < 3:
                continue
            keep = [0]
            for i in range(1, len(times) - 1):
                if times[i] - times[keep[-1]] >= 1 / FPS - 1e-6:
                    keep.append(i)
            keep.append(len(times) - 1)
            if len(keep) >= len(times):
                continue
            s['input'] = add_floats([(times[i],) for i in keep], 1, 'SCALAR')
            s['output'] = add_floats([out[i] for i in keep], NCOMP[acc[s['output']]['type']], acc[s['output']]['type'])

    # 2) 모양 키: 남길 것만
    for mi, me in enumerate(j['meshes']):
        keep = spec['morph'].get(mi, [])
        for p in me['primitives']:
            if 'targets' in p:
                p['targets'] = [p['targets'][k] for k in keep if k < len(p['targets'])]
                if not p['targets']:
                    del p['targets']
        me.pop('weights', None)
        if me.get('extras', {}).get('targetNames'):
            me['extras']['targetNames'] = [me['extras']['targetNames'][k] for k in keep]

    # 2.5) 정점: 필요한 것만 · 작은 형식으로 (같은 accessor 는 한 번만 바꾼다)
    conv = {}

    def small(name, ai):
        key = (name, ai)
        if key in conv:
            return conv[key]
        a = acc[ai]
        rows = read_any(ai)
        out = ai
        if name == 'TEXCOORD_0' and a['componentType'] == 5126 and all(0 <= x <= 1 for r in rows for x in r):
            out = add_raw(b''.join(struct.pack('<2H', *(round(x * 65535) for x in r)) for r in rows), len(rows), 'VEC2', 5123, True)
        elif name == 'WEIGHTS_0' and a['componentType'] == 5126:
            data = bytearray()
            for r in rows:
                q = [round(max(0.0, x) * 255) for x in r]
                q[q.index(max(q))] += 255 - sum(q)  # 합이 정확히 1 이 되게
                data += bytes(q)
            out = add_raw(bytes(data), len(rows), 'VEC4', 5121, True)
        elif name == 'JOINTS_0' and a['componentType'] != 5121 and max(max(r) for r in rows) < 256:
            out = add_raw(b''.join(bytes(r) for r in rows), len(rows), 'VEC4', 5121)
        elif name == 'indices' and a['componentType'] == 5125 and max(r[0] for r in rows) < 65536:
            out = add_raw(struct.pack('<%dH' % len(rows), *(r[0] for r in rows)), len(rows), 'SCALAR', 5123)
        conv[key] = out
        return out
    for me in j['meshes']:
        for p in me['primitives']:
            at = p['attributes']
            p['attributes'] = {k: small(k, v) for k, v in at.items() if k in ('POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0')}
            if 'indices' in p:
                p['indices'] = small('indices', p['indices'])
            if 'targets' in p:
                p['targets'] = [{'POSITION': t['POSITION']} for t in p['targets'] if 'POSITION' in t]

    # 2.7) 면 줄이기 (2026-09-23 — 최적화). 원래 정점의 부분집합만 남으므로 모든 정점 속성을 같은 번호로 골라 담는다
    def rows_of(ai):
        a = acc[ai]
        n = NCOMP[a['type']]
        c = COMP[a['componentType']]
        size = struct.calcsize('<' + c)
        if 'bufferView' in a:
            if a['bufferView'] < 0:
                data = new_views[-a['bufferView'] - 1]
                rows = [struct.unpack_from('<%d%s' % (n, c), data, i * n * size) for i in range(a['count'])]
            else:
                v = bvs[a['bufferView']]
                off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
                st = v.get('byteStride', n * size)
                rows = [struct.unpack_from('<%d%s' % (n, c), bin_, off + i * st) for i in range(a['count'])]
        else:
            rows = [tuple([0] * n) for _ in range(a['count'])]
        sp = a.get('sparse')
        if sp:
            rows = list(rows)
            iv = sp['indices']
            ic = COMP[iv['componentType']]
            iview = bvs[iv['bufferView']]
            ioff = iview.get('byteOffset', 0) + iv.get('byteOffset', 0)
            idx = struct.unpack_from('<%d%s' % (sp['count'], ic), bin_, ioff)
            vv = sp['values']
            vview = bvs[vv['bufferView']]
            voff = vview.get('byteOffset', 0) + vv.get('byteOffset', 0)
            for k, i in enumerate(idx):
                rows[i] = struct.unpack_from('<%d%s' % (n, c), bin_, voff + k * n * size)
        return rows

    def subset(ai, keep):
        a = acc[ai]
        n = NCOMP[a['type']]
        c = COMP[a['componentType']]
        rows = rows_of(ai)
        sel = [rows[i] for i in keep]
        data = b''.join(struct.pack('<%d%s' % (n, c), *r) for r in sel)
        mins = maxs = None
        if a['componentType'] == 5126:
            mins = [min(r[k] for r in sel) for k in range(n)]
            maxs = [max(r[k] for r in sel) for k in range(n)]
        return add_raw(data, len(sel), a['type'], a['componentType'], a.get('normalized', False), mins, maxs)

    if spec.get('tris'):
        prims = [p for me in j['meshes'] for p in me['primitives'] if p.get('mode', 4) == 4 and 'indices' in p]
        count = {id(p): acc[p['indices']]['count'] // 3 for p in prims}
        total = sum(count.values())
        before = total
        after = 0
        for p in prims:
            t_i = count[id(p)]
            if t_i < 300 or total <= spec['tris']:
                after += t_i
                continue
            want = max(150, round(spec['tris'] * t_i / total))
            pos = [r for r in rows_of(p['attributes']['POSITION'])]
            flat = [r[0] for r in rows_of(p['indices'])]
            tris = [flat[i:i + 3] for i in range(0, len(flat), 3)]
            out = simplify(pos, tris, want)
            keep = sorted({w for f in out for w in f})
            newi = {w: k for k, w in enumerate(keep)}
            p['attributes'] = {k: subset(ai, keep) for k, ai in p['attributes'].items()}
            if 'targets' in p:
                p['targets'] = [{k: subset(ai, keep) for k, ai in t.items()} for t in p['targets']]
            idx = [newi[w] for f in out for w in f]
            if len(keep) < 65536:
                p['indices'] = add_raw(struct.pack('<%dH' % len(idx), *idx), len(idx), 'SCALAR', 5123)
            else:
                p['indices'] = add_raw(struct.pack('<%dI' % len(idx), *idx), len(idx), 'SCALAR', 5125)
            after += len(out)
        print(f'{kind:8s} 면 {before} → {after}')

    # 3) 재질: 색 텍스처(+보스는 노멀)만
    for m in j.get('materials', []):
        pb = m.setdefault('pbrMetallicRoughness', {})
        sg = m.get('extensions', {}).get('KHR_materials_pbrSpecularGlossiness')
        if sg:
            # 옛 스펙-광택 재질(늑대): 확산색 텍스처를 기본 색 텍스처로
            if 'diffuseTexture' in sg:
                pb['baseColorTexture'] = sg['diffuseTexture']
            if 'diffuseFactor' in sg:
                pb['baseColorFactor'] = sg['diffuseFactor']
        pb.pop('metallicRoughnessTexture', None)
        pb['metallicFactor'] = 0
        pb['roughnessFactor'] = 1
        m.pop('occlusionTexture', None)
        m.pop('extensions', None)
        if not spec['normal']:
            m.pop('normalTexture', None)
    j.pop('extensionsUsed', None)
    j.pop('extensionsRequired', None)

    # 4) 텍스처: 쓰는 것만, 줄여서 JPEG
    tex_use = {}  # 텍스처 번호 → 'color' | 'normal' | 'emissive'
    for m in j.get('materials', []):
        pb = m.get('pbrMetallicRoughness', {})
        if 'baseColorTexture' in pb:
            tex_use[pb['baseColorTexture']['index']] = 'color'
        if 'normalTexture' in m:
            tex_use[m['normalTexture']['index']] = 'normal'
        if 'emissiveTexture' in m:
            tex_use[m['emissiveTexture']['index']] = 'emissive'
    tex_map = {}
    new_textures = []
    new_images = []
    for ti in sorted(tex_use):
        t = j['textures'][ti]
        img = j['images'][t['source']]
        im = Image.open(os.path.join(d, img['uri']))
        side = spec['tex'] if tex_use[ti] != 'normal' else spec.get('normal_tex', spec['tex'])
        if max(im.size) > side:
            k = side / max(im.size)
            im = im.resize((max(1, round(im.size[0] * k)), max(1, round(im.size[1] * k))), Image.LANCZOS)
        buf = io.BytesIO()
        im.convert('RGB').save(buf, 'JPEG', quality=82 if tex_use[ti] == 'color' else 90, optimize=True)
        new_views.append(buf.getvalue())
        new_images.append({'bufferView': -len(new_views), 'mimeType': 'image/jpeg', 'name': os.path.basename(img['uri'])})
        tex_map[ti] = len(new_textures)
        new_textures.append({'source': len(new_images) - 1, **({'sampler': t['sampler']} if 'sampler' in t else {})})
    for m in j.get('materials', []):
        for holder in (m.get('pbrMetallicRoughness', {}), m):
            for key in ('baseColorTexture', 'normalTexture', 'emissiveTexture'):
                if key in holder:
                    holder[key]['index'] = tex_map[holder[key]['index']]
    j['textures'] = new_textures
    j['images'] = new_images
    if not new_textures:
        for k in ('textures', 'images', 'samplers'):
            j.pop(k, None)

    # 5) 쓰는 accessor 만 남기고 버퍼를 다시 짠다
    used = set()

    def use(ai):
        if ai is not None:
            used.add(ai)
    for me in j['meshes']:
        for p in me['primitives']:
            for ai in p['attributes'].values():
                use(ai)
            use(p.get('indices'))
            for t in p.get('targets', []):
                for ai in t.values():
                    use(ai)
    for s in j.get('skins', []):
        use(s.get('inverseBindMatrices'))
    for an in j.get('animations', []):
        for s in an['samplers']:
            use(s['input'])
            use(s['output'])
    order = sorted(used)
    acc_map = {old: new for new, old in enumerate(order)}
    blobs = []
    new_acc = []
    for old in order:
        a = dict(acc[old])
        if a['bufferView'] < 0:
            data = new_views[-a['bufferView'] - 1]
            data = data[:NCOMP[a['type']] * struct.calcsize('<' + COMP[a['componentType']]) * a['count']]
        else:
            v = bvs[a['bufferView']]
            n = NCOMP[a['type']]
            size = struct.calcsize('<' + COMP[a['componentType']])
            elem = n * size
            st = v.get('byteStride', elem)
            off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
            if st == elem:
                data = bin_[off:off + elem * a['count']]
            else:
                data = b''.join(bin_[off + i * st: off + i * st + elem] for i in range(a['count']))
        a.pop('byteOffset', None)
        a['bufferView'] = len(blobs)
        blobs.append((data, None))
        new_acc.append(a)
    for img in j.get('images', []):
        data = new_views[-img['bufferView'] - 1]
        img['bufferView'] = len(blobs)
        blobs.append((data, None))

    def remap(ai):
        return acc_map[ai]
    for me in j['meshes']:
        for p in me['primitives']:
            p['attributes'] = {k: remap(v) for k, v in p['attributes'].items()}
            if 'indices' in p:
                p['indices'] = remap(p['indices'])
            if 'targets' in p:
                p['targets'] = [{k: remap(v) for k, v in t.items()} for t in p['targets']]
    for s in j.get('skins', []):
        if 'inverseBindMatrices' in s:
            s['inverseBindMatrices'] = remap(s['inverseBindMatrices'])
    for an in j.get('animations', []):
        for s in an['samplers']:
            s['input'] = remap(s['input'])
            s['output'] = remap(s['output'])
    j['accessors'] = new_acc

    body = bytearray()
    views = []
    for data, _ in blobs:
        while len(body) % 4:
            body.append(0)
        views.append({'buffer': 0, 'byteOffset': len(body), 'byteLength': len(data)})
        body += data
    while len(body) % 4:
        body.append(0)
    j['bufferViews'] = views
    j['buffers'] = [{'byteLength': len(body)}]
    j.setdefault('asset', {})['generator'] = 'bedorage-rpg tools/pack-monsters.py'

    js = json.dumps(j, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    while len(js) % 4:
        js += b' '
    glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(body))
    glb += struct.pack('<II', len(js), 0x4E4F534A) + js
    glb += struct.pack('<II', len(body), 0x004E4942) + bytes(body)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, kind + '.glb')
    open(path, 'wb').write(glb)
    print(f'{kind:8s} {len(glb) / 1024:8.0f} KB  (텍스처 {len(new_images)} · 동작 {len(j.get("animations", []))})')


if __name__ == '__main__':
    kinds = sys.argv[1:] or list(SPECS)
    for k in kinds:
        pack(k)
