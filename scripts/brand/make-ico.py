"""Packs PNG files into one .ico (PNG-compressed entries, supported by every current browser).
Usage: make-ico.py out.ico a.png b.png ..."""
import struct
import sys


def size_of(png: bytes) -> tuple[int, int]:
    return struct.unpack(">II", png[16:24])  # IHDR width, height


out, *paths = sys.argv[1:]
images = [open(p, "rb").read() for p in paths]
header = struct.pack("<HHH", 0, 1, len(images))
offset = 6 + 16 * len(images)
entries, blobs = b"", b""
for png in images:
    w, h = size_of(png)
    entries += struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(png), offset + len(blobs))
    blobs += png
open(out, "wb").write(header + entries + blobs)
