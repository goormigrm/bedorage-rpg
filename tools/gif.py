# 공지용 GIF 조립기. 개발 서버의 POST /__shot {dir:'frames'} 로 떨어진 .frames/<장면>/NNN.png 를 모아
# docs/img/gif_<장면>.gif 로 만든다. 한 장당 20MB 를 넘지 않도록(사용자 요청) 크기·프레임을 자동으로 줄인다.
#
#   python tools/gif.py scope            # .frames/scope → docs/img/gif_scope.gif
#   python tools/gif.py scope --fps 12 --scale 0.75 --max-mb 20
#
# 필요: pip install pillow  (유료 서비스 아님)
import argparse, glob, io, os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(tag):
    files = sorted(glob.glob(os.path.join(ROOT, '.frames', tag, '*.png')))
    if not files:
        sys.exit('프레임이 없습니다: .frames/%s' % tag)
    return [Image.open(f).convert('RGB') for f in files]


def resample(frames, src_fps, dst_fps):
    """fps 를 낮출 때 시간 간격이 고르게 남도록 프레임을 고른다 (반으로 뚝 자르지 않는다)"""
    if dst_fps >= src_fps:
        return frames
    n = max(2, int(len(frames) * dst_fps / src_fps))
    return [frames[min(len(frames) - 1, round(i * (len(frames) - 1) / (n - 1)))] for i in range(n)]


def encode(frames, fps, scale, dither, colors=256):
    w, h = frames[0].size
    if scale != 1:
        size = (round(w * scale / 2) * 2, round(h * scale / 2) * 2)
        frames = [f.resize(size, Image.LANCZOS) for f in frames]
    d = Image.Dither.FLOYDSTEINBERG if dither else Image.Dither.NONE
    pal = [f.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=d) for f in frames]
    buf = io.BytesIO()
    pal[0].save(buf, format='GIF', save_all=True, append_images=pal[1:], duration=round(1000 / fps), loop=0,
                optimize=False, disposal=1)
    return buf.getvalue(), frames[0].size if scale == 1 else size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('tag')
    ap.add_argument('--fps', type=float, default=12)
    ap.add_argument('--scale', type=float, default=1.0)
    ap.add_argument('--max-mb', type=float, default=19)  # 20MB 제한에 여유
    ap.add_argument('--dither', action='store_true', help='디더링 (부드럽지만 파일이 커진다)')
    ap.add_argument('--colors', type=int, default=256, help='팔레트 색 수 (적을수록 작다, 128 정도까지는 티가 덜 난다)')
    ap.add_argument('--min-fps', type=float, default=8, help='줄일 때 fps 하한')
    ap.add_argument('--min-scale', type=float, default=None, help='줄일 때 크기 하한 (기본: 시작 scale 의 0.6배)')
    ap.add_argument('--out', default=None)
    ap.add_argument('--from', dest='start', type=int, default=0, help='이 번호 프레임부터')
    ap.add_argument('--to', dest='end', type=int, default=None, help='이 번호 프레임까지(포함)')
    a = ap.parse_args()

    frames = load(a.tag)[a.start:(a.end + 1 if a.end is not None else None)]
    limit = a.max_mb * 1024 * 1024
    # 넘치면 fps 를 조금(-2) → 크기를 조금(-5%) 번갈아 줄인다. 반으로 뚝 자르면 뚝뚝 끊겨 보인다.
    scale, fps, cur = a.scale, a.fps, frames
    min_scale = a.min_scale if a.min_scale is not None else round(a.scale * 0.6, 2)
    turn = 0
    while True:
        cur = resample(frames, a.fps, fps)
        data, size = encode(cur, fps, scale, a.dither, a.colors)
        mb = len(data) / 1024 / 1024
        print('%s: %d frames %dx%d %.1ffps %d색 -> %.2fMB' % (a.tag, len(cur), size[0], size[1], fps, a.colors, mb))
        if len(data) <= limit:
            break
        if turn % 2 == 0 and fps - 2 >= a.min_fps:
            fps -= 2
        elif scale - 0.05 >= min_scale:
            scale = round(scale - 0.05, 2)
        elif fps - 2 >= 4:
            fps -= 2
        else:
            print('더 못 줄인다 — 이대로 저장')
            break
        turn += 1
    out = a.out or os.path.join(ROOT, 'docs', 'img', 'gif_%s.gif' % a.tag)
    with open(out, 'wb') as f:
        f.write(data)
    print('->', os.path.relpath(out, ROOT), '%.1fMB' % mb)


if __name__ == '__main__':
    main()
