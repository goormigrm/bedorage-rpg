# 면 줄이기 (2026-09-23 — 최적화: "4명이 해도 렉이 없게"). pack-monsters.py 가 부른다.
#
# 실사 괴물은 화면에서 60~200px 인데 한 마리 2~3만 면이었다(구울 1.95만 · 군주 3만). 107마리를 그리면
# RTX 4060 에서도 괴물에만 16ms(그림자 패스 포함 삼각형 380만 개). 3천 면 안팎이면 그 크기에서 차이가 거의 안 보인다.
#
# 방법: QEM(면 평면의 이차 오차) **반쪽 모서리 접기** — 점 p 를 이웃 점 q 로 접는다. 새 점을 만들지 않으므로
# 남는 정점은 모두 원래 정점이다 → 뼈 번호 · 가중치 · UV · 모양 키를 그대로 들고 가면 동작이 깨지지 않는다.
# - 같은 자리의 정점(텍스처 이음매 · 딱딱한 모서리)은 "점" 하나로 묶어 모양을 보고, 정점("쐐기")은 따로 옮긴다.
#   이음매 위의 점은 이음매를 따라서만 접힌다(짝 쐐기가 없으면 접지 않는다) → 텍스처가 찢어지지 않는다.
# - 뚫린 가장자리는 가장자리를 따라서만 접고, 가장자리에 수직인 평면을 더해 모양을 지킨다.
# - 면이 뒤집히거나, 두 점의 공통 이웃이 모서리 양옆 말고 더 있으면(모양이 꼬인다) 접지 않는다.
import heapq
import math


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _plane_q(n, d, w):
    """평면 n·x + d = 0 의 이차 오차 (대칭 4x4 의 10 칸)"""
    a, b, c = n
    return [w * a * a, w * a * b, w * a * c, w * a * d, w * b * b, w * b * c, w * b * d, w * c * c, w * c * d, w * d * d]


def _qadd(q, k):
    for i in range(10):
        q[i] += k[i]


def _qeval(q1, q2, v):
    x, y, z = v
    s = [q1[i] + q2[i] for i in range(10)]
    return (s[0] * x * x + 2 * s[1] * x * y + 2 * s[2] * x * z + 2 * s[3] * x
            + s[4] * y * y + 2 * s[5] * y * z + 2 * s[6] * y + s[7] * z * z + 2 * s[8] * z + s[9])


def simplify(pos, tris, target, lock=None):
    """pos: 쐐기(정점)마다 (x,y,z) · tris: 면마다 (쐐기 셋) · target: 남길 면 수.
    돌려준다: 남은 면 목록(원래 쐐기 번호)."""
    V = len(pos)
    # 점: 같은 자리 쐐기를 묶는다
    lo = [min(p[k] for p in pos) for k in range(3)]
    span = max(max(p[k] for p in pos) - lo[k] for k in range(3)) or 1.0
    key = {}
    wpt = [0] * V
    for i, p in enumerate(pos):
        k = tuple(round((p[j] - lo[j]) / span * 1e6) for j in range(3))
        wpt[i] = key.setdefault(k, len(key))
    P = len(key)
    ppos = [None] * P
    for i in range(V):
        ppos[wpt[i]] = tuple(pos[i])

    faces = [list(t) for t in tris]
    alive = [True] * len(faces)
    pf = [set() for _ in range(P)]  # 점 → 면
    live = 0
    for fi, f in enumerate(faces):
        a, b, c = wpt[f[0]], wpt[f[1]], wpt[f[2]]
        if a == b or b == c or a == c:
            alive[fi] = False
            continue
        live += 1
        for p in (a, b, c):
            pf[p].add(fi)
    if live <= target:
        return [f for f, al in zip(faces, alive) if al]

    def fpts(fi):
        f = faces[fi]
        return wpt[f[0]], wpt[f[1]], wpt[f[2]]

    # 이차 오차 (면 넓이만큼)
    Q = [[0.0] * 10 for _ in range(P)]
    for fi in range(len(faces)):
        if not alive[fi]:
            continue
        a, b, c = fpts(fi)
        n = _cross(_sub(ppos[b], ppos[a]), _sub(ppos[c], ppos[a]))
        ar = math.sqrt(_dot(n, n))
        if ar < 1e-20:
            continue
        n = (n[0] / ar, n[1] / ar, n[2] / ar)
        K = _plane_q(n, -_dot(n, ppos[a]), ar)
        _qadd(Q[a], K)
        _qadd(Q[b], K)
        _qadd(Q[c], K)

    def edge_faces(p, qq):
        return [fi for fi in pf[p] if fi in pf[qq]]

    border = [False] * P
    locked = [False] * P
    if lock is not None:
        for w in lock:
            locked[wpt[w]] = True
    seen = set()
    for fi in range(len(faces)):
        if not alive[fi]:
            continue
        pts = fpts(fi)
        for k in range(3):
            a, b = pts[k], pts[(k + 1) % 3]
            e = (min(a, b), max(a, b))
            if e in seen:
                continue
            seen.add(e)
            ef = edge_faces(a, b)
            if len(ef) == 1:
                border[a] = border[b] = True
                # 가장자리에 수직인 평면 (뚫린 가장자리 모양을 지킨다)
                a0, b0, c0 = fpts(ef[0])
                n = _cross(_sub(ppos[b0], ppos[a0]), _sub(ppos[c0], ppos[a0]))
                d = _sub(ppos[b], ppos[a])
                m = _cross(d, n)
                lm = math.sqrt(_dot(m, m))
                if lm > 1e-20:
                    m = (m[0] / lm, m[1] / lm, m[2] / lm)
                    K = _plane_q(m, -_dot(m, ppos[a]), _dot(d, d) * 10.0)
                    _qadd(Q[a], K)
                    _qadd(Q[b], K)
            elif len(ef) > 2:
                locked[a] = locked[b] = True  # 꼬인 모서리는 건드리지 않는다

    ver = [0] * P
    heap = []

    def cost(p, qq):
        return _qeval(Q[p], Q[qq], ppos[qq])

    def neighbors(p):
        s = set()
        for fi in pf[p]:
            s.update(fpts(fi))
        s.discard(p)
        return s

    def push_point(p):
        if locked[p]:
            return
        for qq in neighbors(p):
            heapq.heappush(heap, (cost(p, qq), p, qq, ver[p], ver[qq]))

    for p in range(P):
        if pf[p]:
            push_point(p)

    def try_collapse(p, qq):
        nonlocal live
        ef = edge_faces(p, qq)
        if not ef:
            return False
        if border[p] and len(ef) != 1:
            return False  # 가장자리 점은 가장자리를 따라서만
        # 공통 이웃 = 모서리 양옆의 점뿐이어야 한다 (아니면 모양이 꼬인다)
        opp = set()
        for fi in ef:
            opp.update(fpts(fi))
        opp.discard(p)
        opp.discard(qq)
        if (neighbors(p) & neighbors(qq)) - opp:
            return False
        # 쐐기 짝: p 의 쐐기 → 같은 면에 있는 q 의 쐐기
        mate = {}
        for fi in ef:
            f = faces[fi]
            wp = next(w for w in f if wpt[w] == p)
            wq = next(w for w in f if wpt[w] == qq)
            if mate.setdefault(wp, wq) != wq:
                return False
        for fi in pf[p]:
            for w in faces[fi]:
                if wpt[w] == p and w not in mate:
                    return False  # 이음매 밖으로 접으면 텍스처가 찢어진다
        # 면 뒤집힘 · 납작해짐
        Pq = ppos[qq]
        for fi in pf[p]:
            if fi in ef:
                continue
            a, b, c = fpts(fi)
            A, B, C = ppos[a], ppos[b], ppos[c]
            n0 = _cross(_sub(B, A), _sub(C, A))
            A2 = Pq if a == p else A
            B2 = Pq if b == p else B
            C2 = Pq if c == p else C
            n1 = _cross(_sub(B2, A2), _sub(C2, A2))
            l0 = math.sqrt(_dot(n0, n0))
            l1 = math.sqrt(_dot(n1, n1))
            if l1 < 1e-12 * max(1.0, l0) or _dot(n0, n1) < 0.2 * l0 * l1:
                return False
        # 접기
        for fi in ef:
            alive[fi] = False
            live -= 1
            for pt in fpts(fi):
                if pt != p:
                    pf[pt].discard(fi)
        for fi in list(pf[p]):
            if not alive[fi]:
                continue
            faces[fi] = [mate[w] if wpt[w] == p else w for w in faces[fi]]
            pf[qq].add(fi)
        pf[p] = set()
        _qadd(Q[qq], Q[p])
        if border[p]:
            border[qq] = True
        # q 의 오차가 바뀌었다 → q 에서 나가는 · q 로 들어오는 모서리만 다시 잰다 (다른 모서리의 값은 그대로)
        ver[qq] += 1
        ver[p] += 1
        push_point(qq)
        for n in neighbors(qq):
            if not locked[n]:
                heapq.heappush(heap, (cost(n, qq), n, qq, ver[n], ver[qq]))
        return True

    while live > target and heap:
        c, p, qq, vp, vq = heapq.heappop(heap)
        if vp != ver[p] or vq != ver[qq] or not pf[p] or not pf[qq]:
            continue
        try_collapse(p, qq)

    return [f for f, al in zip(faces, alive) if al]


if __name__ == '__main__':
    # 시험: 물결 판 (가장자리 모양 유지)
    import time
    n = 60
    pts = [(x, y, math.sin(x * 0.3) * 0.2) for y in range(n) for x in range(n)]
    tr = []
    for y in range(n - 1):
        for x in range(n - 1):
            i = y * n + x
            tr += [(i, i + 1, i + n), (i + 1, i + n + 1, i + n)]
    t = time.time()
    out = simplify(pts, tr, 700)
    print(len(tr), '->', len(out), f'{time.time() - t:.2f}s')
