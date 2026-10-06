# 밝은 분위기 괴물 모델을 게임용 .glb 로 묶는다 (2026-10-06 — docs/밝은-분위기-개편-계획.md 2장).
#
#   python tools/pack-cute.py            # 모두
#   python tools/pack-cute.py slime bee  # 몇 개만 (아래 CUTE 의 이름)
#
# 입력: art-src/cute-monsters/{Big,Blob,Flying}/<모델>.gltf — Quaternius "Ultimate Monsters"(CC0). 저장소에 올리지 않는다.
#       (공식 구글 드라이브: https://drive.google.com/drive/folders/18m4KpzpEzhC9wl7jzr6dUc0N8Jozr79C — 각 폴더의 glTF)
# 출력: public/assets3d/monsters/cute_<이름>.glb
#
# 받은 파일은 버퍼 · 텍스처(9 KB 색 팔레트)가 파일 안(data URI)에 들어 있고 면도 적다(1천~6천) — 실사 모델처럼 줄일 것이 없다.
# 그래서 하는 일은 둘뿐: ① 쓰는 동작만 남긴다(14개 중 다섯) ② 쓰지 않게 된 데이터를 버퍼에서 지우고 .glb 하나로 묶는다.
# 필요한 것: Python 3 (표준 라이브러리만).

import base64
import json
import os
import struct
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'art-src', 'cute-monsters')
OUT = os.path.join(ROOT, 'public', 'assets3d', 'monsters')

# 동작 묶음 (모델 꼴마다 이름이 다르다)
BIG = ['Idle', 'Walk', 'Run', 'Punch', 'Weapon', 'HitReact', 'Death']
BLOB = ['Idle', 'Walk', 'Bite_Front', 'HitRecieve', 'Death']
FLY = ['Flying_Idle', 'Fast_Flying', 'Headbutt', 'Punch', 'HitReact', 'Death']

# 게임 파일 이름 → (원본 폴더/파일, 남길 동작)
CUTE = {
    'slime': ('Blob/PinkBlob', BLOB),  # 0 구울 → 말랑 슬라임
    'cactus': ('Big/Cactoro', BIG),  # 1 해골 궁수 → 가시 선인장
    'puffer': ('Flying/Glub', FLY),  # 2 부푼 시체 → 빵빵 복어
    'mushking': ('Big/MushroomKing', BIG),  # 3 도살자 → 술래 버섯왕
    'bunny': ('Big/Bunny', BIG),  # 4 보물 고블린 → 보물 토끼
    'dino': ('Big/Dino', BIG),  # 5 늑대 → 꼬마 공룡
    'bee': ('Flying/Armabee', FLY),  # 6 독거미 → 꿀벌
    'mushnub': ('Blob/Mushnub', BLOB),  # 7 버섯 주술사 → 치유 버섯
    'queenbee': ('Flying/Armabee_Evolved', FLY),  # 8 거미 여왕 → 여왕벌
    'ninja': ('Big/Ninja', BIG),  # 9 방패병 → 분홍 진행요원
    'wizard': ('Blob/Wizard', BLOB),  # 10 강령술사 → 꼬마 마법사
    'squid': ('Flying/Squidle', FLY),  # 11 산성 토사꾼 → 먹물 오징어
    'yeti': ('Big/Yeti', BIG),  # 12 관리인 → 진행요원 반장
    'ghost': ('Flying/Ghost', FLY),  # 13 그림자 → 장난꾸러기 유령
    'imp': ('Big/BlueDemon', BIG),  # 14 포격 악마 → 폭죽 꼬마 도깨비
    'dragon': ('Flying/Dragon_Evolved', FLY),  # 15 심연의 군주 → 파티 드래곤
}


def pack(name: str) -> None:
    src, keep = CUTE[name]
    j = json.load(open(os.path.join(SRC, src + '.gltf'), encoding='utf-8'))
    uri = j['buffers'][0]['uri']
    raw = base64.b64decode(uri.split(',', 1)[1])

    # ① 동작: 남길 것만 (모델에 없는 이름은 건너뛴다)
    j['animations'] = [a for a in j.get('animations', []) if a['name'] in keep]

    # ② 쓰는 accessor 모으기
    used_acc = set()
    for m in j['meshes']:
        for p in m['primitives']:
            used_acc.update(p['attributes'].values())
            if 'indices' in p:
                used_acc.add(p['indices'])
            for t in p.get('targets', []):
                used_acc.update(t.values())
    for s in j.get('skins', []):
        if 'inverseBindMatrices' in s:
            used_acc.add(s['inverseBindMatrices'])
    for a in j['animations']:
        for sm in a['samplers']:
            used_acc.add(sm['input'])
            used_acc.add(sm['output'])
    used_views = {j['accessors'][i]['bufferView'] for i in used_acc if 'bufferView' in j['accessors'][i]}
    used_views.update(img['bufferView'] for img in j.get('images', []) if 'bufferView' in img)

    # ③ 새 버퍼: 쓰는 bufferView 만 차례로 (4바이트 정렬)
    out = bytearray()
    view_map = {}
    new_views = []
    for vi, v in enumerate(j['bufferViews']):
        if vi not in used_views:
            continue
        off = v.get('byteOffset', 0)
        data = raw[off:off + v['byteLength']]
        while len(out) % 4:
            out.append(0)
        nv = dict(v)
        nv['buffer'] = 0
        nv['byteOffset'] = len(out)
        out.extend(data)
        view_map[vi] = len(new_views)
        new_views.append(nv)
    while len(out) % 4:
        out.append(0)

    # ④ accessor 를 쓰는 것만 남기고 번호를 다시 매긴다
    acc_map = {}
    new_acc = []
    for ai, a in enumerate(j['accessors']):
        if ai not in used_acc:
            continue
        na = dict(a)
        if 'bufferView' in na:
            na['bufferView'] = view_map[na['bufferView']]
        acc_map[ai] = len(new_acc)
        new_acc.append(na)
    for m in j['meshes']:
        for p in m['primitives']:
            p['attributes'] = {k: acc_map[v] for k, v in p['attributes'].items()}
            if 'indices' in p:
                p['indices'] = acc_map[p['indices']]
            if 'targets' in p:
                p['targets'] = [{k: acc_map[v] for k, v in t.items()} for t in p['targets']]
    for s in j.get('skins', []):
        if 'inverseBindMatrices' in s:
            s['inverseBindMatrices'] = acc_map[s['inverseBindMatrices']]
    for a in j['animations']:
        for sm in a['samplers']:
            sm['input'] = acc_map[sm['input']]
            sm['output'] = acc_map[sm['output']]
    for img in j.get('images', []):
        if 'bufferView' in img:
            img['bufferView'] = view_map[img['bufferView']]
    j['accessors'] = new_acc
    j['bufferViews'] = new_views
    j['buffers'] = [{'byteLength': len(out)}]
    j['asset']['generator'] = 'Quaternius Ultimate Monsters (CC0) · bedorage-rpg tools/pack-cute.py'

    # ⑤ .glb (JSON 덩어리 + BIN 덩어리)
    js = json.dumps(j, separators=(',', ':')).encode('utf-8')
    while len(js) % 4:
        js += b' '
    glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out))
    glb += struct.pack('<II', len(js), 0x4E4F534A) + js
    glb += struct.pack('<II', len(out), 0x004E4942) + bytes(out)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'cute_{name}.glb')
    open(path, 'wb').write(glb)
    names = [a['name'] for a in j['animations']]
    print(f'{name:9s} ← {src:24s} {len(glb) / 1024:6.0f} KB · 동작 {", ".join(names)}')


if __name__ == '__main__':
    for n in sys.argv[1:] or list(CUTE):
        pack(n)
