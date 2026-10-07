"""Bake the preset sculptures (Hunyuan3D GLBs in raw/sculptures/glb) into the
sand density grids the game stamps into its sculpture voxels.

For each model: find which side faced the camera in its source image (so that
side becomes the front, +Z), voxelize it, keep the main piece, turn the
occupancy into a smooth signed-distance density, crop it so the base sits at
y = 0 and write public/assets/sculptures/<id>.sand (gzip: b'SCU1', nx, ny, nz
as uint16, then nx*ny*nz bytes, x fastest) plus src/world/sculpt-models.json.
"""
import gzip
import json
import struct
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'raw' / 'sculptures'
OUT = ROOT / 'public' / 'assets' / 'sculptures'
RES = 128  # cells along the longest side

# id, name, size of the longest side in world units (1 unit ≈ 30 cm)
MODELS = [
    ('dolphin', '海豚', 5.5),
    ('queen', '女王頭像', 5.0),
    ('castle', '城堡', 6.0),
    ('cat', '趴著的貓', 5.5),
    ('mermaid', '美人魚', 5.0),
    ('turtle', '海龜', 5.0),
    ('octopus', '章魚', 5.0),
    ('crab', '螃蟹', 4.5),
    ('seahorse', '海馬', 5.0),
    ('lion', '睡獅', 6.0),
    ('dinosaur', '恐龍', 6.0),
    ('ship', '海盜船', 6.0),
]


def silhouette(mask):
    ys, xs = np.nonzero(mask)
    crop = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    return np.asarray(Image.fromarray((crop * 255).astype(np.uint8)).resize((96, 96), Image.BILINEAR)) > 127


def image_silhouette(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.int16)
    return silhouette(a.min(axis=2) < 232)


def views(occ):
    """Silhouettes seen from +Z, -Z, +X, -X (occ is [z, y, x], rows top-down)."""
    fz = occ.any(axis=0)[::-1]          # [y, x], right = +X
    fx = occ.any(axis=2)[:, ::-1].T     # [y, z]
    return {
        '+Z': fz,
        '-Z': fz[:, ::-1],
        '+X': fx[::-1, ::-1],           # right = -Z
        '-X': fx[::-1],                 # right = +Z
    }


def voxelize(mesh, pitch):
    vg = mesh.voxelized(pitch).fill()
    m = vg.matrix  # [x, y, z]
    return np.transpose(m, (2, 1, 0)).copy()  # -> [z, y, x]


def iou(a, b):
    return (a & b).sum() / max(1, (a | b).sum())


def bake(mid, name, size):
    mesh = trimesh.load(RAW / 'glb' / f'{mid}.glb', force='mesh')
    mesh.apply_translation(-mesh.bounds.mean(axis=0))
    ref = image_silhouette(RAW / f'{mid}.png')
    # orientation: which side did the source image look at?
    coarse = voxelize(mesh, mesh.extents.max() / 64)
    scores = {k: iou(silhouette(v), ref) for k, v in views(coarse).items()}
    best = max(scores, key=scores.get)
    turn = {'+Z': 0.0, '-Z': np.pi, '+X': -np.pi / 2, '-X': np.pi / 2}[best]
    mesh.apply_transform(trimesh.transformations.rotation_matrix(turn, [0, 1, 0]))

    occ = voxelize(mesh, mesh.extents.max() / (RES - 1))
    lab, n = ndimage.label(occ)
    if n > 1:
        sizes = ndimage.sum(occ, lab, range(1, n + 1))
        occ = lab == (1 + int(np.argmax(sizes)))
    occ = ndimage.binary_closing(occ, iterations=1)
    occ = ndimage.binary_fill_holes(occ)
    zs, ys, xs = np.nonzero(occ)
    occ = occ[zs.min():zs.max() + 1, ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    occ = np.pad(occ, ((2, 2), (0, 2), (2, 2)))  # base stays at y = 0

    # smooth signed distance (cells, + outside) -> density with a soft edge
    out = ndimage.distance_transform_edt(~occ)
    inn = ndimage.distance_transform_edt(occ)
    sd = np.where(occ, -(inn - 0.5), out - 0.5)
    sd = ndimage.gaussian_filter(sd, 0.7)
    dens = np.clip(0.5 - sd / 1.5, 0, 1)
    dens[:, 0, :] = np.maximum(dens[:, 0, :], dens[:, 1, :])  # a flat, full base
    data = (dens * 255 + 0.5).astype(np.uint8)
    nz, ny, nx = data.shape

    OUT.mkdir(parents=True, exist_ok=True)
    blob = b'SCU1' + struct.pack('<3H', nx, ny, nz) + data.tobytes()
    (OUT / f'{mid}.sand').write_bytes(gzip.compress(blob, 9))
    print(f'{mid:9s} seen from {best} ({scores[best]:.2f}; others {", ".join(f"{k} {v:.2f}" for k, v in scores.items() if k != best)}) '
          f'grid {nx}x{ny}x{nz}  {(OUT / f"{mid}.sand").stat().st_size // 1024} KB')
    return {'id': mid, 'name': name, 'size': size, 'thumb': f'assets/sculptures/thumbs/{mid}.png'}, data


def preview(results, path):
    """Front (from +Z), side (from +X) and top views, shaded by depth."""
    tiles = []
    for _, data in results:
        occ = data >= 128
        nz, ny, nx = occ.shape

        def depth(axis, flip):
            o = occ if not flip else np.flip(occ, axis)
            first = np.argmax(o, axis=axis).astype(float)
            hit = o.any(axis=axis)
            n = o.shape[axis]
            return np.where(hit, 1 - first / n * 0.8, 0)

        front = depth(0, True)[::-1]              # [y, x] from +Z
        side = depth(2, True)[::-1]               # [y, z] from +X
        top = depth(1, True)                      # [z, x] from +Y
        row = []
        for img in (front, side, top):
            im = Image.fromarray((img * 255).astype(np.uint8)).resize((160, 160))
            row.append(im)
        tile = Image.new('L', (480, 160))
        for k, im in enumerate(row):
            tile.paste(im, (k * 160, 0))
        tiles.append(tile)
    cols = 2
    sheet = Image.new('L', (480 * cols, 160 * ((len(tiles) + 1) // cols)), 40)
    for k, t in enumerate(tiles):
        sheet.paste(t, ((k % cols) * 480, (k // cols) * 160))
    sheet.save(path)


if __name__ == '__main__':
    import sys
    only = set(sys.argv[1:-1]) if len(sys.argv) > 2 else None
    results = []
    for mid, name, size in MODELS:
        if (RAW / 'glb' / f'{mid}.glb').exists() and (not only or mid in only):
            results.append(bake(mid, name, size))
    manifest = [r[0] for r in results]
    if not only:
        (ROOT / 'src' / 'world' / 'sculpt-models.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    preview(results, sys.argv[-1] if len(sys.argv) > 1 else 'sculpt_preview.png')
