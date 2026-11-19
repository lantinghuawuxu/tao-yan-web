"""把照片扫描的岩石材质烘焙成洮河石三色贴图。

为什么需要这一步
----------------
直接拿岩石扫描贴图当洮河石用是不行的：色相对不上，而简单地把图降成灰度
再乘一个绿色，得到的是「磨砂塑料」——纹理再细也不是石头。
真实石头的关键是**不同区域颜色不同**（绿中带黄斑、暗处偏墨）。

所以这里做的是色度向量混合：
  · 明暗结构 100% 取自原扫描 —— 层理、劈理、颗粒全部保留
  · 色度方向向洮河石本色拉 60~75%，剩余留给原图的冷暖杂质
  · 低频（大块明暗）压掉一部分，细节层抬起来，避免看成「抛光玉雕」

源材质按岩石成因挑选，不是按颜色：
  Rock020 细粒板岩（纵向劈理、丝绢光泽）→ 鹦哥绿（洮河石本就是水云母质板岩）
  Rock041 细粒粉砂岩（均匀致密、带矿物黄斑）→ 黄膘石
  Rock035 细粒黑色页岩（致密含铁）→ 紫石（羊肝红）

用法
----
1. 从 ambientCG（CC0）下载三个材质的 2K-JPG 包并解压：
   https://ambientcg.com/get?file=Rock020_2K-JPG.zip
   https://ambientcg.com/get?file=Rock041_2K-JPG.zip
   https://ambientcg.com/get?file=Rock035_2K-JPG.zip
2. 把解压目录填到 SRC（需要 _Color.jpg / _NormalGL.jpg / _Roughness.jpg）
3. python tools/bake_stone.py

产物写入 public/textures/inkstone/，命名与 useGreenStoneTexture.ts 的
SOURCES 一致，前端无需改动。

想调整某个石料的色感，只改 JOBS 里的 albedo（RGB）和 keep（原图色相保留比例）。
"""
import os
import numpy as np
from PIL import Image, ImageFilter

SRC = os.environ.get('STONE_SRC', os.path.expanduser('~/Downloads/ambientcg'))
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'textures', 'inkstone')
os.makedirs(OUT, exist_ok=True)

# variant -> (源材质, 洮河石本色 RGB, 原图色度保留比例)
JOBS = {
    'green': ('Rock020', (58, 96, 80), 0.30),
    'yellow': ('Rock041', (152, 125, 66), 0.34),
    'purple': ('Rock035', (104, 62, 74), 0.26),
}


def bake(variant: str, src: str, albedo, keep: float) -> str:
    im = Image.open(os.path.join(SRC, f'{src}_2K-JPG_Color.jpg')).convert('RGB')
    if im.size != (2048, 2048):
        im = im.resize((2048, 2048), Image.LANCZOS)
    rgb = np.asarray(im, dtype=np.float32) / 255.0

    target = np.array(albedo, dtype=np.float32) / 255.0
    target_len = float(np.linalg.norm(target))

    lum = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
    lo, hi = np.percentile(lum, 1.0), np.percentile(lum, 99.0)
    t = np.clip((lum - lo) / max(hi - lo, 1e-4), 0.0, 1.0)

    # 频段重分配：原扫描的大块明暗不均会让人看成"青玉"，
    # 压掉一部分低频、把细节层抬起来，才是砚石那种致密的颗粒感
    low = np.asarray(
        Image.fromarray((t * 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(26)),
        dtype=np.float32,
    ) / 255.0
    t = np.clip(0.5 + (t - 0.5) * 0.60 + (t - low) * 0.95, 0.0, 1.0)

    # 原图色度方向（单位向量），再拉回与目标同亮度
    v = rgb / np.maximum(np.linalg.norm(rgb, axis=-1, keepdims=True), 1e-3)
    direction = (1.0 - keep) * target[None, None, :] + keep * v * target_len

    out = np.clip(direction * (0.50 + 0.98 * t)[..., None], 0.0, 1.0)
    dst = os.path.join(OUT, f'{variant}_color.jpg')
    Image.fromarray((out * 255).astype(np.uint8)).save(
        dst, quality=80, subsampling=1, optimize=True
    )
    return dst


for variant, (src, albedo, keep) in JOBS.items():
    print(f'[{variant}] {src}')
    bake(variant, src, albedo, keep)
    Image.open(os.path.join(SRC, f'{src}_2K-JPG_NormalGL.jpg')).convert('RGB').resize(
        (1024, 1024), Image.LANCZOS
    ).save(os.path.join(OUT, f'{variant}_normal.jpg'), quality=82, subsampling=0, optimize=True)
    Image.open(os.path.join(SRC, f'{src}_2K-JPG_Roughness.jpg')).convert('L').resize(
        (512, 512), Image.LANCZOS
    ).save(os.path.join(OUT, f'{variant}_rough.jpg'), quality=74, optimize=True)

print('done ->', os.path.abspath(OUT))
