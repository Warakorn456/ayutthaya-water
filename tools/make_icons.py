"""สร้างไอคอนแอป (หยดน้ำบนพื้นสีน้ำทะเล) ไม่ต้องใช้ไลบรารีเพิ่ม
รัน: python tools/make_icons.py
"""
import math
import os
import struct
import zlib

BG = (11, 110, 138)      # --accent
DROP = (255, 255, 255)
WAVE = (47, 127, 208)    # --water
SS = 4                   # supersampling


def inside_drop(x, y):
    # หยดน้ำ: วงกลมด้านล่าง + ปลายแหลมด้านบน (พิกัด 0..1)
    cx, cy, r = 0.5, 0.60, 0.25
    if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
        return True
    tip = 0.14
    if tip <= y <= cy:
        # ขอบตรงแตะวงกลม
        half = r * (y - tip) / (cy - tip) * 1.02
        return abs(x - cx) <= half
    return False


def inside_wave(x, y):
    # คลื่นน้ำในครึ่งล่างของหยด
    return y > 0.64 + 0.025 * math.sin((x - 0.25) * math.pi * 4)


def render(size, pad=0.0):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    x = (px + (sx + .5) / SS) / size
                    y = (py + (sy + .5) / SS) / size
                    # maskable: ย่อหยดให้อยู่ใน safe zone
                    u = (x - .5) / (1 - pad) + .5
                    v = (y - .5) / (1 - pad) + .5
                    c = BG
                    if inside_drop(u, v):
                        c = WAVE if inside_wave(u, v) else DROP
                    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]
            n = SS * SS
            row += bytes((acc[0] // n, acc[1] // n, acc[2] // n))
        rows.append(bytes(row))
    raw = b''.join(rows)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


if __name__ == '__main__':
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
    os.makedirs(out, exist_ok=True)
    for name, size, pad in [('icon-192.png', 192, .1), ('icon-512.png', 512, .1), ('apple-touch-icon.png', 180, .05)]:
        with open(os.path.join(out, name), 'wb') as f:
            f.write(render(size, pad))
        print('wrote', name)
