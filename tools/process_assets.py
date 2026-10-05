"""Turn the raw Higgsfield renders in /raw into game-ready assets in /public/assets."""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
OUT = ROOT / "public" / "assets"


def save_jpg(src, dst, width, quality=86):
    im = Image.open(RAW / src).convert("RGB")
    h = round(im.height * width / im.width)
    im.resize((width, h), Image.LANCZOS).save(OUT / dst, quality=quality, optimize=True, progressive=True)


def cut_sheet(src, names, folder, cols=4, rows=2, size=256):
    sheet = Image.open(RAW / src).convert("RGB")
    cw, ch = sheet.width / cols, sheet.height / rows
    (OUT / folder).mkdir(parents=True, exist_ok=True)
    for i, name in enumerate(names):
        cx, cy = i % cols, i // cols
        cell = sheet.crop((round(cx * cw), round(cy * ch), round((cx + 1) * cw), round((cy + 1) * ch)))
        # Flood the white backdrop from the borders with a key colour, so white
        # highlights inside the object stay opaque.
        key = (255, 0, 255)
        work = cell.copy()
        w, h = work.size
        for x in range(0, w, 8):
            for y in (0, h - 1):
                if work.getpixel((x, y)) != key and min(work.getpixel((x, y))) > 228:
                    ImageDraw.floodfill(work, (x, y), key, thresh=34)
        for y in range(0, h, 8):
            for x in (0, w - 1):
                if work.getpixel((x, y)) != key and min(work.getpixel((x, y))) > 228:
                    ImageDraw.floodfill(work, (x, y), key, thresh=34)
        arr = np.asarray(work).astype(np.int16)
        bg = (arr[..., 0] == 255) & (arr[..., 1] == 0) & (arr[..., 2] == 255)
        alpha = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8))
        alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
        a = np.asarray(alpha).astype(np.float32) / 255.0
        rgb = np.asarray(cell).astype(np.float32)
        # Remove the white fringe left by anti-aliasing against the backdrop.
        safe = np.maximum(a, 0.05)[..., None]
        rgb = np.clip((rgb - (1 - a[..., None]) * 255.0) / safe, 0, 255)
        rgba = np.dstack([rgb, a * 255]).astype(np.uint8)
        img = Image.fromarray(rgba, "RGBA")
        bbox = img.getchannel("A").point(lambda v: 255 if v > 10 else 0).getbbox()
        img = img.crop(bbox)
        side = max(img.width, img.height)
        pad = round(side * 0.06)
        canvas = Image.new("RGBA", (side + pad * 2, side + pad * 2), (0, 0, 0, 0))
        canvas.paste(img, ((canvas.width - img.width) // 2, (canvas.height - img.height) // 2))
        canvas.resize((size, size), Image.LANCZOS).save(OUT / folder / f"{name}.png", optimize=True)


def make_tileable_sand():
    im = Image.open(RAW / "sand.png").convert("RGB").resize((1024, 1024), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    n = a.shape[0]
    rolled = np.roll(np.roll(a, n // 2, axis=0), n // 2, axis=1)
    t = np.linspace(0, 1, n)
    edge = np.minimum(t, 1 - t) * 2  # 0 at the borders, 1 at the centre
    w1 = np.clip((edge - 0.08) / 0.5, 0, 1)
    w1 = w1 * w1 * (3 - 2 * w1)
    w = np.minimum(w1[:, None], w1[None, :])[..., None]
    out = a * w + rolled * (1 - w)
    # Normalise brightness so lighting, not the photo, drives the shading.
    mean = out.reshape(-1, 3).mean(0)
    target = np.array([226, 196, 146], dtype=np.float32)
    out = np.clip(out / mean * target, 0, 255)
    Image.fromarray(out.astype(np.uint8)).save(OUT / "img" / "sand_albedo.jpg", quality=90)

    # Normal map from luminance, sampled with wrap so it tiles as well.
    lum = (out @ np.array([0.3, 0.59, 0.11], dtype=np.float32)) / 255.0
    lum = np.asarray(Image.fromarray((lum * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32) / 255
    dx = (np.roll(lum, -1, axis=1) - np.roll(lum, 1, axis=1)) * 3.0
    dy = (np.roll(lum, -1, axis=0) - np.roll(lum, 1, axis=0)) * 3.0
    nz = np.ones_like(lum)
    nrm = np.dstack([-dx, dy, nz])
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    Image.fromarray(((nrm * 0.5 + 0.5) * 255).astype(np.uint8)).save(OUT / "img" / "sand_normal.png", optimize=True)


if __name__ == "__main__":
    (OUT / "img").mkdir(parents=True, exist_ok=True)
    save_jpg("keyart.png", "img/keyart.jpg", 1920)
    save_jpg("ending.png", "img/ending.jpg", 1920)
    for i in range(1, 6):
        save_jpg(f"level{i}.png", f"img/level{i}.jpg", 960, quality=84)
    cut_sheet("icons.png", ["raise", "dig", "smooth", "flatten", "tower", "wall", "decor", "flag"], "icons")
    cut_sheet("treasures.png", ["coin", "bottle", "pearl", "compass", "key", "ring", "seaglass", "fossil"], "treasures")
    make_tileable_sand()
    print("done")


def make_water_normal(size=512, seed=7):
    """Tileable ripple normal map from a filtered random spectrum."""
    rng = np.random.default_rng(seed)
    f = np.fft.fftfreq(size) * size
    kx, ky = np.meshgrid(f, f)
    k = np.sqrt(kx ** 2 + ky ** 2)
    k[0, 0] = 1
    # slightly anisotropic: ripples prefer to travel along +y
    ang = np.arctan2(ky, kx)
    aniso = 0.55 + 0.45 * np.abs(np.sin(ang))
    spec = (rng.normal(size=(size, size)) + 1j * rng.normal(size=(size, size))) / k ** 2.0 * aniso
    spec[k < 3] = 0
    spec[k > size / 4] = 0
    h = np.real(np.fft.ifft2(spec))
    h /= h.std()
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    s = 0.55 / np.sqrt((dx ** 2 + dy ** 2).mean())
    n = np.dstack([-dx * s, -dy * s, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(OUT / "img" / "water_normal.png", optimize=True)


if __name__ == "__main__":
    make_water_normal()
    png = OUT / "img" / "sand_normal.png"
    if png.exists():
        Image.open(png).convert("RGB").save(OUT / "img" / "sand_normal.jpg", quality=92)
        png.unlink()
    print("water normal done")
    cut_sheet("icons2.png", ["channel", "wave", "chest", "emblem"], "icons", cols=4, rows=1)
