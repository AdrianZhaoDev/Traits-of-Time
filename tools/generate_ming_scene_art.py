#!/usr/bin/env python3
# SPDX-License-Identifier: CC0-1.0
"""Original, offline Ming-end presentation illustrations.

Run from any directory:
  local/agent-sprite-forge-venv/bin/python tools/generate_ming_scene_art.py
Dependencies: Pillow 13 and NumPy 2 (no network requests, models, or asset downloads).

The drawing source and its generated artwork are dedicated to the public domain
under CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/ . No third-party
images, fonts, photographs, trademarks, or historical portraits are incorporated.
People are anonymous illustrative types, not named or reconstructed individuals.
The category pictures are atmosphere, not depictions of particular game outcomes.
All randomness and Cocos asset UUIDs are deterministic. The default output is
limited to scenes/, events/, identity/, and people/ under art/ming_end/.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
from pathlib import Path
import random
import uuid

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "assets/resources/art/ming_end"
SCALE = 2
INK = "#091421"
DEEP = "#102632"
TEAL = "#37656b"
MIST = "#6e9390"
GOLD = "#c5a36a"
LIGHT = "#e2c792"
RUST = "#935d4d"
NAMESPACE = uuid.UUID("7752ea31-58db-5d1d-a28c-0613de296bb5")
LICENSE = "CC0-1.0"


def rgb(value):
    if isinstance(value, str):
        value = value.lstrip("#")
        return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))
    return tuple(value[:3])


def rgba(value, alpha=255):
    return (*rgb(value), alpha)


def blend(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(rgb(a), rgb(b)))


def seeded(name):
    return random.Random(int.from_bytes(hashlib.sha256(name.encode()).digest()[:8], "big"))


class Canvas:
    """Small supersampled illustration surface; all drawing coordinates are logical."""
    def __init__(self, width=1000.0, height=600.0, transparent=False):
        self.w, self.h = width, height
        self.image = Image.new("RGBA", (round(width * SCALE), round(height * SCALE)),
                               (0, 0, 0, 0) if transparent else rgba(INK))
        self.draw = ImageDraw.Draw(self.image)

    def points(self, points):
        return [(round(x * SCALE), round(y * SCALE)) for x, y in points]

    def poly(self, points, fill, stroke=None, width=1.0):
        pts = self.points(points)
        if fill is not None:
            self.draw.polygon(pts, fill=rgba(fill))
            # Quiet directional gouache shading gives substantial forms volume.
            # Small marks remain crisp ink; large areas retain their own palette.
            left, top = min(x for x, _ in pts), min(y for _, y in pts)
            right, bottom = max(x for x, _ in pts), max(y for _, y in pts)
            area = abs(sum(pts[i][0]*pts[(i+1)%len(pts)][1] - pts[(i+1)%len(pts)][0]*pts[i][1]
                           for i in range(len(pts)))) / 2
            if right-left > 35*SCALE and bottom-top > 22*SCALE and area > 1400*SCALE*SCALE:
                w, h = right-left+1, bottom-top+1
                yy = np.arange(h, dtype=np.float32)[:, None]
                xx = np.arange(w, dtype=np.float32)[None, :]
                tone = 1.075 - .07*xx/w - .16*yy/h + .012*np.sin(xx/31+yy/47)
                tile = Image.fromarray(np.uint8(np.clip(np.array(rgb(fill), dtype=np.float32)*tone[..., None], 0, 255)))
                mask = Image.new("L", (w, h))
                ImageDraw.Draw(mask).polygon([(x-left, y-top) for x, y in pts], fill=255)
                self.image.paste(tile, (left, top), mask)
        if stroke:
            self.draw.line(pts + [pts[0]], fill=rgba(stroke), width=max(1, round(width * SCALE)), joint="curve")

    def line(self, points, fill, width=1.0):
        self.draw.line(self.points(points), fill=rgba(fill), width=max(1, round(width * SCALE)), joint="curve")

    def ellipse(self, box, fill=None, stroke=None, width=1.0):
        self.draw.ellipse(tuple(round(p * SCALE) for p in box), fill=rgba(fill) if fill else None,
                          outline=rgba(stroke) if stroke else None, width=max(1, round(width * SCALE)))

    def rect(self, box, fill, stroke=None, width=1.0):
        self.draw.rectangle(tuple(round(p * SCALE) for p in box), fill=rgba(fill),
                            outline=rgba(stroke) if stroke else None, width=max(1, round(width * SCALE)))

    def path(self, commands, fill=None, stroke=None, width=1.0):
        pts = []
        current = (0, 0)
        for command in commands:
            if command[0] in ("M", "L"):
                current = (command[1], command[2])
                pts.append(current)
            elif command[0] == "C":
                a = current
                b, cc, d = (command[1:3], command[3:5], command[5:7])
                steps = max(12, round((math.dist(a, b) + math.dist(b, cc) + math.dist(cc, d)) / 6))
                for i in range(1, steps + 1):
                    t = i / steps
                    q = 1 - t
                    pts.append((q**3*a[0] + 3*q*q*t*b[0] + 3*q*t*t*cc[0] + t**3*d[0],
                                q**3*a[1] + 3*q*q*t*b[1] + 3*q*t*t*cc[1] + t**3*d[1]))
                current = tuple(d)
            elif command[0] == "Z" and pts:
                pts.append(pts[0])
        if fill:
            self.poly(pts, fill)
        if stroke:
            self.line(pts, stroke, width)

    def glow(self, x, y, rx, ry, color, opacity=70, blur=18.0):
        layer = Image.new("RGBA", self.image.size)
        d = ImageDraw.Draw(layer)
        d.ellipse(tuple(round(v * SCALE) for v in (x-rx, y-ry, x+rx, y+ry)), fill=rgba(color, opacity))
        layer = layer.filter(ImageFilter.GaussianBlur(blur * SCALE))
        self.image.alpha_composite(layer)
        self.draw = ImageDraw.Draw(self.image)

    def gradient(self, top, bottom, glow=None):
        w, h = self.image.size
        yy = np.arange(h, dtype=np.float32)[:, None]
        xx = np.arange(w, dtype=np.float32)[None, :]
        t = (yy / h)[..., None]
        pixels = np.asarray(rgb(top), dtype=np.float32) * (1-t) + np.asarray(rgb(bottom), dtype=np.float32) * t
        pixels = np.broadcast_to(pixels, (h, w, 3)).copy()
        if glow:
            x, y, rx, ry, color, strength = glow
            distance = ((xx / SCALE-x) / rx)**2 + ((yy / SCALE-y) / ry)**2
            a = (np.exp(-distance * 1.9) * strength)[..., None]
            pixels *= 1-a
            pixels += np.asarray(rgb(color), dtype=np.float32) * a
        self.image.close()
        self.image = Image.fromarray(np.uint8(np.clip(pixels, 0, 255)), "RGB").convert("RGBA")
        self.draw = ImageDraw.Draw(self.image)

    def finish(self, size, quiet=True):
        image = self.image.resize(size, Image.Resampling.LANCZOS)
        self.image.close()
        a = np.asarray(image).copy()
        h, w = a.shape[:2]
        yy = np.arange(h, dtype=np.float32)[:, None]
        xx = np.arange(w, dtype=np.float32)[None, :]
        shade = np.ones((h, w), dtype=np.float32)
        if quiet:
            # Soft edge shading keeps artwork subordinate to the UI, not hidden.
            edge = np.clip(abs(xx/w-.5)*1.65, 0, 1)**2
            foot = np.clip((yy/h-.78)/.22, 0, 1)
            shade -= edge*.12 + foot*.20
        # Fine, deterministic print fibres, with no noisy photographic texture.
        fibre = .48*np.sin(yy*1.87 + np.sin(xx*.043)*2) + .25*np.sin(xx*1.21+yy*.67)
        a[:, :, :3] = np.uint8(np.clip(np.rint(a[:, :, :3]*shade[..., None] + fibre[..., None]), 0, 255))
        a[a[:, :, 3] == 0, :3] = 0
        return Image.fromarray(a, "RGBA")


def clouds(c, y, seed, color="#416369", count=8):
    r = seeded(seed)
    for _ in range(count):
        x, w = r.uniform(-100, c.w), r.uniform(80, 230)
        h = r.uniform(8, 24)
        c.path([("M", x, y), ("C", x+w*.2, y-h, x+w*.45, y+h*.25, x+w*.62, y-h*.3),
                ("C", x+w*.8, y-h*.9, x+w*.9, y+h*.5, x+w, y+h*.3)], stroke=color, width=.7)
        y += r.uniform(-12, 16)


def mountains(c, baseline, height, seed, fill, line=None):
    r = seeded(seed)
    ridge = [(x, baseline - r.uniform(.1, 1)*height) for x in range(-80, int(c.w)+100, 65)]
    c.poly(ridge + [(c.w+80, c.h), (-80, c.h)], fill)
    if line:
        c.line(ridge, line, .8)
        for i in range(1, len(ridge)-1):
            x, y = ridge[i]
            c.path([("M", x, y+8), ("C", x-15, y+height*.28, x+28, baseline-4, x+11, baseline+20)],
                   stroke=blend(fill, line, .3), width=.65)


def water(c, box, seed, fill="#17343f", shine="#567b7c", amount=100):
    x0, y0, x1, y1 = box
    c.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], fill)
    r = seeded(seed)
    for _ in range(amount):
        y = r.uniform(y0, y1)
        x = r.uniform(x0, x1)
        length = r.uniform(5, 45) * (.35 + .7*(y-y0)/(y1-y0))
        c.line([(x, y), (min(x+length, x1), y-.3)], blend(fill, shine, r.uniform(.2, .75)), r.choice([.5, .7, 1]))


def roof(c, x, y, width, rise, color="#142b35", edge: str | tuple[int, ...]="#9b9270", tiles=True):
    left, right = x-width/2, x+width/2
    c.path([("M", left-8, y-10), ("C", left+width*.10, y+5, x-width*.18, y-rise+8, x, y-rise),
            ("C", x+width*.18, y-rise+8, right-width*.10, y+5, right+8, y-10),
            ("L", right, y+5), ("C", x+width*.2, y+12, x-width*.2, y+12, left, y+5), ("Z",)],
           color, edge, 1)
    c.path([("M", left-8, y-10), ("C", left+width*.11, y+5, x-width*.2, y-rise+7, x, y-rise),
            ("C", x+width*.2, y-rise+7, right-width*.11, y+5, right+8, y-10)], stroke=blend(edge, LIGHT, .25), width=1.3)
    c.path([("M", left, y+4), ("C", x-width*.15, y+10, x+width*.15, y+10, right, y+4)], stroke=blend(edge, color, .2), width=1.4)
    if tiles:
        for i in range(1, 19):
            t = i/19
            topx = x + (t-.5)*width*.45
            endx = left+t*width
            topy = y-rise+abs(t-.5)*rise*.65+5
            c.path([("M", topx, topy), ("C", topx, topy+rise*.35, endx, y-2, endx, y+5)],
                   stroke=blend(color, edge, .28), width=.65)
        for j in range(1, 4):
            yy = y-rise+rise*j/4
            ww = width*(.42 + j*.14)
            c.path([("M", x-ww/2, yy), ("C", x-ww*.15, yy+6, x+ww*.15, yy+6, x+ww/2, yy)],
                   stroke=blend(color, edge, .19), width=.5)


def lattice(c, x, y, w, h, lit=False):
    c.rect((x, y, x+w, y+h), "#9a8256" if lit else "#0a1b28", "#8c886d", .7)
    for xx in np.arange(x+w*.2, x+w, w*.2):
        c.line([(xx, y+1), (xx, y+h-1)], "#2b3e3c", .8)
    for yy in np.arange(y+h*.25, y+h, h*.25):
        c.line([(x+1, yy), (x+w-1, yy)], "#2b3e3c", .8)


def house(c, x, base, w, h, wall="#65716a", roof_color="#142b35", lit=False, detail=True):
    left, right, top = x-w/2, x+w/2, base-h
    c.poly([(left, top), (right, top+2), (right, base), (left, base)], wall)
    c.poly([(right, top+2), (right+w*.16, top+h*.16), (right+w*.16, base-h*.05), (right, base)], blend(wall, INK, .37))
    c.line([(left, base), (right+w*.14, base-h*.05)], blend(wall, LIGHT, .15), 1.1)
    roof(c, x, top+2, w*1.23, h*.44, roof_color, blend(wall, GOLD, .25), detail)
    c.poly([(left, top+11), (right, top+11), (right, top+18), (left, top+18)], blend(wall, INK, .28))
    doorw = w*.18
    c.rect((x-doorw/2, base-h*.57, x+doorw/2, base), "#172c31")
    c.line([(x-doorw/2, base-h*.57), (x+doorw/2, base-h*.57)], "#b3a07a", .8)
    if detail:
        lattice(c, left+w*.10, base-h*.52, w*.19, h*.27, lit)
        lattice(c, right-w*.29, base-h*.52, w*.19, h*.27, lit)
        for side in (left+w*.04, right-w*.04):
            c.line([(side, top+9), (side, base)], blend(wall, INK, .4), 2)
        for k in range(2):
            c.line([(left+3, base-h*.12-k*3), (right-3, base-h*.12-k*3)], blend(wall, INK, .2), .6)
        for row in range(3):
            yy = base-h*.10+row*h*.035
            c.line([(left+2, yy), (right-2, yy)], blend(wall, LIGHT, .12), .55)
            for j in range(7):
                xx = left+w*(j+(row%2)*.5)/7
                c.line([(xx, yy), (xx, yy+h*.035)], blend(wall, INK, .2), .5)
        c.line([(x-doorw*.35, base-h*.53), (x-doorw*.35, base-3)], "#71806b", .6)
        c.line([(x+doorw*.35, base-h*.53), (x+doorw*.35, base-3)], "#4c655b", .6)
        if lit:
            c.glow(x, base-h*.3, w*.38, h*.2, GOLD, 12, 8)


def lantern(c, x, y, size=16, color=RUST, lit=True):
    if lit:
        c.glow(x, y, size*.85, size*1.15, "#d9a85e", 70, size*.75)
    c.line([(x, y-size*1.7), (x, y-size*.8)], GOLD, .8)
    c.ellipse((x-size*.64, y-size*.85, x+size*.64, y+size*.85), color, "#a78a63", 1)
    for dx in (-.32, 0, .32):
        c.path([("M", x+dx*size*.6, y-size*.8), ("C", x+dx*size*1.8, y-size*.2, x+dx*size*1.8, y+size*.2, x+dx*size*.6, y+size*.8)],
               stroke="#c7a16a" if lit else "#6d6d5b", width=.7)
    c.rect((x-size*.4, y-size*.9, x+size*.4, y-size*.76), "#3b3e34", GOLD, .5)
    c.rect((x-size*.4, y+size*.76, x+size*.4, y+size*.9), "#3b3e34", GOLD, .5)
    c.line([(x, y+size*.9), (x, y+size*1.45)], "#b77953", 1.5)


def pine(c, x, y, size, color="#0c2630"):
    c.path([("M", x, y), ("C", x-size*.07, y-size*.5, x+size*.05, y-size*.6, x+size*.04, y-size)],
           stroke=color, width=size*.035)
    for j in range(5):
        yy = y-size*(.25+j*.15)
        ww = size*(.42-j*.055)
        c.line([(x, yy+size*.06), (x-ww, yy-size*.01)], color, size*.025)
        for sign in (-1, 1):
            for k in range(5):
                bx = x+sign*ww*(k+1)/5
                by = yy-size*.03*(k+1)/5
                c.poly([(bx-ww*.25, by+size*.025), (bx, by-size*.08), (bx+ww*.22, by+size*.04)], color)
                c.line([(bx-ww*.12, by-size*.008), (bx+ww*.14, by+size*.01)], blend(color, TEAL, .4), .6)


def willow(c, x, y, size, color="#183e42"):
    c.path([("M", x, y), ("C", x-size*.1, y-size*.45, x+size*.02, y-size*.75, x-size*.06, y-size)],
           stroke="#3f5148", width=size*.04)
    r = seeded(f"willow-{x}-{y}")
    for k in range(14):
        dx = (k/13-.5)*size*1.4
        anchor = y-size*(.85+.15*r.random())
        endy = y-size*(.10+.35*r.random())
        c.path([("M", x, y-size*.75), ("C", x+dx*.4, anchor-size*.22, x+dx, anchor, x+dx, endy)],
               stroke=color, width=1.2)
        for j in range(10):
            yy = anchor+(endy-anchor)*(j+1)/11
            xx = x+dx*(.65+.35*(j+1)/11)
            c.line([(xx-4, yy-4), (xx, yy+5)], blend(color, MIST, r.uniform(.1, .35)), 1.8)


def dry_tree(c, x, y, size, color="#1b3034"):
    branches = [((0, 0), (-.06, -.46), (.02, -.72), (-.02, -1)),
                ((-.04, -.34), (-.27, -.46), (-.35, -.72), (-.48, -.77)),
                ((-.01, -.5), (.21, -.62), (.28, -.87), (.38, -.9)),
                ((-.05, -.67), (-.18, -.8), (-.15, -.97), (-.22, -1.06)),
                ((.13, -.62), (.35, -.64), (.38, -.75), (.5, -.77))]
    for i, pts in enumerate(branches):
        p = [(x+u*size, y+v*size) for u, v in pts]
        c.path([("M", *p[0]), ("C", *p[1], *p[2], *p[3])], stroke=color, width=size*(.035 if i == 0 else .018))
        c.path([("M", p[0][0]+2, p[0][1]), ("C", p[1][0]+2, p[1][1], p[2][0]+2, p[2][1], p[3][0], p[3][1])],
               stroke=blend(color, GOLD, .23), width=.75)


def grass(c, x, y, size=35, color=GOLD, grain=False):
    for i in range(5):
        dx = (i-2)*size*.17
        tipy = y-size*(.7+.25*math.sin(i+1))
        c.path([("M", x, y), ("C", x+dx*.25, y-size*.4, x+dx, tipy+size*.3, x+dx, tipy)],
               stroke=color, width=.8)
        if grain:
            for j in range(5):
                yy = tipy+j*size*.07
                c.ellipse((x+dx-2, yy-2, x+dx+1, yy+2), blend(color, LIGHT, .25))
                c.ellipse((x+dx+1, yy-1, x+dx+4, yy+3), color)


def distant_person(c, x, y, s=30, robe="#172c33", hat=False, facing=1):
    c.ellipse((x-s*.08, y-s, x+s*.08, y-s*.82), "#ae9270")
    c.poly([(x-s*.12, y-s*.82), (x+s*.11, y-s*.82), (x+s*.19, y-s*.25),
            (x+s*.03, y-s*.17), (x-s*.16, y-s*.25)], robe)
    c.line([(x-s*.06, y-s*.25), (x-s*.08, y), (x-s*.2, y)], "#10222c", s*.05)
    c.line([(x+s*.07, y-s*.25), (x+s*.13, y), (x+s*.23, y)], "#10222c", s*.05)
    c.line([(x+facing*s*.08, y-s*.72), (x+facing*s*.25, y-s*.48)], blend(robe, GOLD, .2), s*.05)
    if hat:
        c.poly([(x-s*.22, y-s*.88), (x, y-s*1.11), (x+s*.22, y-s*.88)], "#9b8a61", "#c4ac73", .6)


def stone_path(c, topx, topy, left, right, bottom, fill="#4a5148", seed="path"):
    c.path([("M", topx-10, topy), ("C", topx-45, topy+60, left+80, bottom-70, left, bottom),
            ("L", right, bottom), ("C", right-70, bottom-70, topx+25, topy+60, topx+10, topy), ("Z",)], fill)
    r = seeded(seed)
    for i in range(22):
        t = (i+1)/23
        yy = topy+(bottom-topy)*t
        xx = topx+(left+right-2*topx)/2*t
        ww = 8+(right-left)*t*.40
        c.path([("M", xx-ww, yy), ("C", xx-ww*.2, yy+3, xx+ww*.25, yy-2, xx+ww, yy+1)],
               stroke=blend(fill, GOLD, .18+r.random()*.10), width=.5+t*.7)


def bowl(c, x, y, w, h, color="#677d75", contents=False):
    c.path([("M", x-w/2, y-h*.7), ("C", x-w*.42, y+h*.1, x-w*.23, y+h*.38, x, y+h*.4),
            ("C", x+w*.23, y+h*.38, x+w*.42, y+h*.1, x+w/2, y-h*.7), ("Z",)], color, GOLD, 1)
    c.ellipse((x-w/2, y-h, x+w/2, y-h*.4), blend(color, INK, .6), blend(color, LIGHT, .65), 1)
    if contents:
        c.ellipse((x-w*.42, y-h*.88, x+w*.42, y-h*.49), "#87724b")
    c.line([(x-w*.16, y+h*.41), (x+w*.16, y+h*.41)], blend(color, GOLD, .5), 2)


def book(c, x, y, w, h, angle=0):
    skew = angle
    c.poly([(x, y), (x+w, y+skew), (x+w, y+h+skew), (x, y+h)], "#b1a17d", "#d1bb8b", 1)
    c.poly([(x, y), (x+w, y+skew), (x+w, y+h*.22+skew), (x, y+h*.22)], "#33545a", "#a89162", .8)
    for i in range(1, 5):
        yy = y+h*.23+i*h*.14
        c.line([(x+3, yy), (x+w-2, yy+skew)], "#6d715d", .7)
    for i in range(3):
        xx = x+7+i*5
        c.line([(xx, y+3), (xx, y+h*.21)], "#d2b67f", .7)


def home_scene():
    c = Canvas(750, 1200)
    c.gradient("#081221", "#193842", (390, 565, 400, 490, "#3f7374", .65))
    r = seeded("home-stars")
    for _ in range(95):
        x, y = r.uniform(30, 720), r.uniform(55, 680)
        c.ellipse((x, y, x+r.uniform(.5, 1.6), y+1.1), r.choice(["#577b86", "#8aadaf", "#385b6d"]))
    clouds(c, 360, "home-clouds", "#31575f")
    mountains(c, 770, 180, "home-far", "#23434c", "#41666b")
    mountains(c, 850, 150, "home-mid", "#19353e", "#426367")
    # A substantial open, machined portal; no pseudo-lettering or UI baked in.
    px, py, rx, ry = 308, 535, 194, 256
    c.glow(px, py, rx*.75, ry*.8, "#76c6c7", 28, 65)
    c.ellipse((px-rx-18, py-ry-18, px+rx+18, py+ry+18), "#132b3a", "#467580", 1.6)
    c.ellipse((px-rx-9, py-ry-9, px+rx+9, py+ry+9), "#193f4c", "#c4a776", 2.4)
    c.ellipse((px-rx+4, py-ry+5, px+rx-4, py+ry-5), "#0b2132", "#73c6c7", 3)
    for i in range(7):
        inset = 20+i*14
        c.ellipse((px-rx+inset, py-ry+inset*1.25, px+rx-inset, py+ry-inset*1.25),
                  None, blend("#437c88", "#142f46", i/7), 1)
    c.glow(px+18, py+28, 55, 100, "#83b9cf", 48, 35)
    c.path([("M", px-60, py-177), ("C", px+135, py-125, px-151, py+35, px+81, py+128)],
           stroke="#3f8999", width=2)
    c.path([("M", px-35, py-160), ("C", px+116, py-87, px-112, py+49, px+69, py+147)],
           stroke="#a1caca", width=.8)
    for i in range(44):
        a = 2*math.pi*i/44
        x, y = px+math.cos(a)*(rx+13), py+math.sin(a)*(ry+13)
        ex, ey = px+math.cos(a)*(rx+21), py+math.sin(a)*(ry+21)
        c.line([(x, y), (ex, ey)], "#a9b3a1" if i%4 == 0 else "#466e75", 2.5 if i%4 == 0 else 1)
    for a in (-2.4, -.72, .62, 2.35):
        x, y = px+math.cos(a)*(rx+12), py+math.sin(a)*(ry+12)
        c.ellipse((x-9, y-9, x+9, y+9), "#17343e", "#9bb8ab", 1)
        c.ellipse((x-3, y-3, x+3, y+3), "#a3e1d5")
    for sector in range(12):
        angle = sector*math.pi/6+.06
        points = []
        for j in range(7):
            aa = angle+j*.047
            points.append((px+math.cos(aa)*(rx+25), py+math.sin(aa)*(ry+25)))
        for j in range(6, -1, -1):
            aa = angle+j*.047
            points.append((px+math.cos(aa)*(rx+17), py+math.sin(aa)*(ry+17)))
        c.poly(points, "#385a63", "#758d83", .6)
    for i in range(38):
        angle = i*2.39996
        distance = 10+math.sqrt(i/38)*110
        xx, yy = px+math.cos(angle)*distance, py+math.sin(angle)*distance*1.25
        c.line([(xx, yy), (xx+2, yy-5)], "#406e80", .6)
    c.glow(px+19, py+28, 19, 48, "#a1d6db", 29, 22)
    # Earthen village and tiled roofs anchor the historical side of the threshold.
    c.poly([(0, 842), (145, 781), (356, 827), (540, 771), (750, 817), (750, 1200), (0, 1200)], "#142e34")
    stone_path(c, 375, 786, 105, 578, 1200, "#334c48", "home-road")
    house(c, 558, 854, 154, 111, "#71765f", lit=True)
    house(c, 682, 825, 103, 78, "#536a61", lit=True)
    house(c, 505, 924, 123, 100, "#687165", lit=True)
    house(c, 672, 952, 185, 132, "#667a6c", lit=True)
    lantern(c, 571, 879, 13)
    c.line([(593, 847), (596, 911)], "#a29365", 2)
    c.path([("M", 526, 742), ("C", 508, 712, 548, 705, 533, 670)], stroke="#527073", width=2)
    pine(c, 70, 941, 225, "#102931")
    pine(c, 742, 1044, 190, "#0d2930")
    for i in range(12):
        grass(c, 30+i*37, 1117+(i%3)*22, 38+(i%4)*8, "#4f6553", i%4 == 0)
    for i in range(12):
        x, y = r.uniform(95, 520), r.uniform(400, 815)
        c.line([(x, y), (x+3, y-7)], "#8dc8c4", .9)
    # Calm lower field for the opening actions, keeping all village detail above it.
    c.glow(380, 1145, 450, 110, "#071421", 160, 80)
    return c.finish((900, 1440))


def shanbei_scene():
    c = Canvas(1000, 312.5)
    c.gradient("#132633", "#5c6657", (640, 96, 440, 195, "#9c8d61", .36))
    c.ellipse((774, 42, 816, 84), "#a2926a")
    clouds(c, 63, "shanbei-wind", "#6e7764", 6)
    mountains(c, 173, 63, "shanbei-loess-far", "#3a514e", "#6b7966")
    # Sculpted loess escarpments, terrace contours, and arched cave dwellings.
    c.path([("M", -20, 183), ("C", 120, 101, 196, 161, 281, 133), ("C", 402, 101, 461, 211, 550, 173),
            ("C", 670, 133, 814, 149, 1040, 188), ("L", 1040, 313), ("L", -20, 313), ("Z",)], "#6f7258")
    for offset in (0, 16, 34, 54):
        c.path([("M", -20, 192+offset), ("C", 134, 146+offset, 197, 190+offset, 284, 161+offset),
                ("C", 412, 138+offset, 455, 216+offset, 560, 201+offset)], stroke="#8f8a65", width=1)
    for x, w in ((80, 39), (143, 47), (215, 42), (636, 44), (700, 40)):
        base = 229 if x < 300 else 216
        c.path([("M", x-w/2, base), ("L", x-w/2, base-28), ("C", x-w/2, base-57, x+w/2, base-57, x+w/2, base-28),
                ("L", x+w/2, base), ("Z",)], "#1d3538", "#a0946c", 2)
        c.line([(x, base-37), (x, base)], "#827e60", 1)
        c.line([(x-w*.3, base-26), (x+w*.3, base-26)], "#635f4b", 1)
    house(c, 468, 237, 132, 62, "#969077", "#253c3d", True)
    house(c, 568, 223, 78, 45, "#827f65", "#263c3c", False)
    c.poly([(0, 270), (218, 236), (379, 263), (510, 246), (696, 238), (1000, 271), (1000, 313), (0, 313)], "#3e5147")
    stone_path(c, 462, 234, 268, 544, 313, "#817b58", "shanbei-track")
    dry_tree(c, 865, 290, 142, "#2a403f")
    dry_tree(c, 29, 300, 73, "#2a403b")
    for i in range(13):
        grass(c, 28+i*80, 304+(i%2)*6, 14+(i%3)*4, "#8b835d")
    distant_person(c, 408, 263, 24, "#344940", True)
    c.line([(423, 244), (434, 265)], "#9f976e", 1)
    return c.finish((1280, 400))


def capital_scene():
    c = Canvas(1000, 312.5)
    c.gradient("#102534", "#5c7772", (590, 115, 400, 170, "#8e9a81", .28))
    clouds(c, 54, "capital-cloud", "#557d7f", 7)
    mountains(c, 178, 33, "capital-distant", "#36585e")
    for i in range(13):
        house(c, 16+i*86, 225+(i%2)*4, 85, 41+(i%3)*6, "#516864", "#1d3e47", False, False)
    # Wide stone city wall and a two-tier gate tower, without imperial insignia.
    c.rect((0, 205, 1000, 272), "#394e4c")
    c.rect((0, 202, 1000, 210), "#73816a")
    for x in range(0, 1000, 32):
        c.rect((x, 192, x+18, 205), "#52655b", "#7a846b", .7)
    for row in range(5):
        yy = 217+row*11
        c.line([(0, yy), (1000, yy)], "#54645b", .6)
        for x in range(-20, 1020, 56):
            c.line([(x+(row%2)*28, yy), (x+(row%2)*28, yy+11)], "#283d3e", .6)
    gx = 600
    c.path([("M", gx-49, 272), ("L", gx-49, 230), ("C", gx-49, 168, gx+49, 168, gx+49, 230),
            ("L", gx+49, 272), ("Z",)], "#122934", "#899072", 2)
    c.path([("M", gx-31, 272), ("L", gx-31, 233), ("C", gx-31, 192, gx+31, 192, gx+31, 233),
            ("L", gx+31, 272)], fill="#a48655")
    c.rect((gx-82, 144, gx+82, 195), "#8a8261")
    for xx in (gx-65, gx-23, gx+23, gx+65):
        c.line([(xx, 143), (xx, 195)], "#4f4c3d", 4)
    roof(c, gx, 143, 222, 55, "#17333e", "#b7a16f")
    c.rect((gx-60, 104, gx+60, 128), "#7c7859")
    lattice(c, gx-35, 108, 70, 18, False)
    roof(c, gx, 100, 174, 42, "#183740", "#c0a774")
    c.line([(gx, 57), (gx, 44)], "#a49874", 1.5)
    c.ellipse((gx-3, 44, gx+3, 49), GOLD)
    for x in (100, 318, 855):
        c.rect((x-23, 172, x+23, 202), "#7a7f64")
        roof(c, x, 172, 68, 28, "#1d3a42", "#a29971", False)
    stone_path(c, gx, 263, 407, 786, 313, "#576153", "capital-road")
    for x in (gx-64, gx+64):
        lantern(c, x, 238, 10)
    distant_person(c, 524, 292, 23, "#243b42")
    distant_person(c, 704, 280, 18, "#504e3f", True)
    # Close eaves frame the edges while the skyline remains readable at banner size.
    roof(c, 32, 75, 214, 80, "#102a35", "#637771")
    pine(c, 962, 313, 154, "#12323c")
    return c.finish((1280, 400))


def jiangnan_scene():
    c = Canvas(1000, 312.5)
    c.gradient("#18303b", "#73918a", (640, 101, 370, 180, "#a5b09a", .25))
    mountains(c, 166, 30, "jiangnan-far", "#476a6c")
    clouds(c, 54, "jiangnan-cloud", "#799790", 6)
    water(c, (0, 175, 1000, 313), "jiangnan-water", "#2d535b", "#a6b0a0", 150)
    c.poly([(0, 201), (345, 172), (421, 205), (282, 313), (0, 313)], "#4d6660")
    c.poly([(690, 169), (1000, 189), (1000, 313), (807, 313), (647, 205)], "#3b5d59")
    for i, (x, y, w, h) in enumerate(((80, 214, 146, 72), (228, 190, 123, 67), (351, 179, 86, 45),
                                    (737, 190, 116, 63), (863, 216, 156, 83), (979, 231, 119, 85))):
        house(c, x, y, w, h, "#a2aa91" if i%2 == 0 else "#859c8a", "#183d45", i == 4)
        c.line([(x-w*.48, y+6), (x+w*.48, y+6)], "#a2a88a", 2)
    # A low, single-arch stone bridge is distinct from the northern city gate.
    c.path([("M", 351, 219), ("C", 439, 132, 571, 132, 672, 213), ("L", 672, 239),
            ("C", 566, 183, 454, 182, 351, 243), ("Z",)], "#8b9982", "#b6b596", 1.4)
    c.path([("M", 353, 218), ("C", 449, 140, 565, 141, 670, 214)], stroke="#c0b894", width=2.5)
    for j in range(16):
        t = j/15
        x = 360+t*301
        y = 217-57*math.sin(t*math.pi)
        c.line([(x, y), (x, y-13)], "#b9b393", 2)
    c.path([("M", 360, 204), ("C", 459, 129, 568, 130, 662, 202)], stroke="#a8ad91", width=1.2)
    willow(c, 925, 279, 224, "#284f4a")
    # Boat and reflected gold are restrained so water remains a quiet text-adjacent zone.
    c.path([("M", 441, 276), ("C", 480, 288, 557, 288, 586, 268), ("L", 567, 289),
            ("C", 522, 298, 474, 297, 453, 289), ("Z",)], "#263e3c", "#b29d71", 1)
    c.path([("M", 478, 277), ("C", 480, 243, 533, 240, 542, 278)], fill="#7d8062", stroke="#b4a97c", width=1)
    for j in range(6):
        c.path([("M", 481+j*9, 276), ("C", 482+j*8, 254, 493+j*7, 250, 497+j*8, 277)], stroke="#515e4d", width=.6)
    distant_person(c, 562, 276, 24, "#213a3e", True)
    c.line([(572, 255), (609, 306)], "#b1a47c", 1.5)
    distant_person(c, 505, 167, 20, "#3d5149")
    for i in range(9):
        c.line([(813-i*3, 232+i*7), (836+i*5, 232+i*7)], "#7d8d70", .7)
    return c.finish((1280, 400))


def natural_ending():
    c = Canvas()
    c.gradient("#142b34", "#3e5855", (700, 257, 450, 360, "#bcad7a", .5))
    # The empty chair and evening landscape are contemplative, not a literal death.
    c.ellipse((544, 54, 901, 411), "#829787", "#a59f78", 3)
    c.ellipse((661, 140, 724, 203), "#d0bb82")
    mountains(c, 328, 76, "natural-distant", "#5e7d74", "#9da68d")
    mountains(c, 378, 61, "natural-near", "#375c5a", "#6f8b7b")
    water(c, (0, 368, 1000, 600), "natural-river", "#294c50", "#94a491", 90)
    # Surround the circular opening with a wall, preserving an actual round aperture.
    wall = Image.new("RGBA", c.image.size, rgba("#152f38"))
    mask = Image.new("L", c.image.size, 255)
    ImageDraw.Draw(mask).ellipse(tuple(round(v*SCALE) for v in (544, 54, 901, 411)), fill=0)
    wall.putalpha(mask)
    c.image.alpha_composite(wall)
    c.draw = ImageDraw.Draw(c.image)
    c.ellipse((540, 50, 905, 415), None, "#aa9670", 3)
    c.ellipse((552, 62, 893, 403), None, "#476c68", 2)
    c.line([(715, 55), (715, 410)], "#33544e", 5)
    c.line([(550, 249), (896, 249)], "#33544e", 5)
    # Old wooden chair; no bodies, religious assertion, or epitaph.
    c.path([("M", 181, 522), ("L", 160, 302), ("C", 201, 280, 287, 281, 326, 299),
            ("L", 320, 520)], stroke="#9a8057", width=9)
    c.path([("M", 170, 314), ("C", 214, 302, 280, 305, 318, 314)], stroke="#c1a26c", width=3)
    for x in (192, 226, 260, 294):
        c.path([("M", x, 313), ("C", x+5, 362, x-4, 396, x+4, 444)], stroke="#7e704e", width=3)
    c.poly([(154, 451), (318, 449), (352, 484), (180, 491)], "#655e44", "#b29763", 2)
    c.line([(182, 491), (172, 581)], "#8b7752", 7)
    c.line([(340, 483), (352, 574)], "#8b7752", 7)
    c.line([(145, 404), (140, 457), (181, 462)], "#a48b5d", 5)
    c.line([(331, 401), (347, 451), (316, 456)], "#a48b5d", 5)
    # A small tea table, folded cloth, and mature plant imply ordinary lived time.
    c.ellipse((377, 434, 611, 475), "#6d6b4e", "#b3a06f", 1.5)
    c.line([(406, 465), (396, 563)], "#6a6a4f", 5)
    c.line([(585, 466), (596, 561)], "#6a6a4f", 5)
    bowl(c, 480, 442, 53, 17, "#8b9d87", True)
    c.ellipse((519, 418, 562, 451), "#5d7a71", "#bdac7e", 1)
    c.path([("M", 552, 425), ("C", 578, 412, 584, 449, 556, 445)], stroke="#a79f74", width=3)
    c.path([("M", 528, 423), ("C", 502, 425, 508, 411, 494, 410)], stroke="#8c9e85", width=5)
    c.ellipse((527, 416, 556, 423), "#627c6d", "#b0ad81", 1)
    c.ellipse((539, 412, 544, 418), GOLD)
    c.poly([(812, 507), (877, 507), (867, 565), (825, 565)], "#4f6157", "#9f9470", 1)
    c.path([("M", 845, 513), ("C", 855, 455, 827, 423, 861, 367)], stroke="#788d6a", width=2)
    for j in range(8):
        x, y = 849+(j%2)*14, 401+j*13
        c.poly([(x, y), (x-35, y-20), (x-16, y+5)], "#7c8e69", "#a09b6c", .5)
        c.poly([(x, y+4), (x+33, y-18), (x+21, y+9)], "#697f63", "#a09b6c", .5)
    c.path([("M", 0, 538), ("C", 350, 518, 671, 537, 1000, 513)], stroke="#4a6258", width=1)
    return c.finish((1200, 720))


def hard_ending():
    c = Canvas()
    c.gradient("#0b1a28", "#3e5559", (570, 256, 400, 300, "#587b7b", .3))
    clouds(c, 80, "hard-storm", "#2c484f", 15)
    mountains(c, 345, 134, "hard-far", "#243f49", "#42626b")
    mountains(c, 403, 75, "hard-near", "#1b3540", "#3f5960")
    c.poly([(0, 427), (166, 382), (353, 442), (596, 385), (1000, 418), (1000, 600), (0, 600)], "#1b333b")
    stone_path(c, 601, 380, 329, 729, 600, "#3f5353", "hard-road")
    dry_tree(c, 204, 546, 368, "#132c34")
    pine(c, 945, 479, 180, "#142f39")
    # Closed travel bundle and sheltered lantern, with neither corpse nor graphic damage.
    c.poly([(646, 505), (662, 479), (732, 472), (775, 500), (758, 536), (686, 541)], "#59635d", "#9c9473", 1.2)
    c.path([("M", 660, 489), ("C", 697, 508, 739, 488, 764, 508)], stroke="#b19e76", width=2)
    c.line([(703, 480), (714, 534)], "#364d4b", 3)
    c.line([(729, 477), (723, 537)], "#364d4b", 3)
    c.poly([(532, 481), (585, 481), (599, 551), (521, 551)], "#20373b", "#7e8068", 1)
    c.line([(528, 481), (593, 481)], "#989273", 3)
    c.ellipse((544, 467, 574, 489), None, "#8d8a6d", 2)
    c.path([("M", 538, 497), ("L", 545, 534), ("L", 579, 534), ("L", 585, 497)], fill="#6c6b51", stroke="#9b9270", width=.7)
    c.rect((552, 505, 574, 531), "#827449")
    c.glow(563, 520, 18, 18, "#b48d4d", 25, 20)
    # Rain is an atmospheric veil, not a depicted cause of any specific ending.
    r = seeded("hard-rain")
    for _ in range(210):
        x, y = r.uniform(-20, 1030), r.uniform(0, 600)
        length = r.uniform(8, 24)
        c.line([(x, y), (x-5, y+length)], "#385661" if y < 400 else "#506a6c", .5)
    for i in range(22):
        x, y = r.uniform(320, 890), r.uniform(480, 594)
        c.ellipse((x-8, y-1, x+8, y+2), None, "#567171", .5)
    grass(c, 89, 597, 39, "#45605c")
    grass(c, 869, 591, 55, "#45605c")
    return c.finish((1200, 720))


def career_ending():
    c = Canvas()
    c.gradient("#102733", "#355554", (680, 241, 430, 310, "#c4ad73", .5))
    # Open workshop/study looking toward sunrise; not a claim of rank or office.
    c.rect((508, 65, 910, 361), "#7f9685", "#aa9c73", 3)
    c.ellipse((672, 145, 750, 223), "#d7c28c")
    mountains(c, 296, 65, "career-distant", "#567a75", "#8e9c83")
    for x, w, h in ((569, 114, 45), (704, 126, 57), (843, 123, 50)):
        house(c, x, 345, w, h, "#7f8c74", "#25464b", False)
    # Reapply architectural frame over the distant scene.
    c.rect((0, 0, 506, 404), "#142f39")
    c.rect((910, 0, 1000, 405), "#152e36")
    c.rect((500, 0, 914, 65), "#15313a")
    c.line([(511, 69), (511, 359), (909, 359), (909, 69)], "#af9d72", 2)
    for x in (604, 807):
        c.line([(x, 69), (x, 355)], "#35564f", 4)
    c.line([(510, 113), (909, 113)], "#35564f", 4)
    # A finished workbench combines study, husbandry, and craft without choosing a career.
    c.poly([(119, 398), (831, 398), (925, 476), (70, 476)], "#69664a", "#aa986b", 2)
    c.poly([(70, 476), (925, 476), (925, 494), (70, 494)], "#424e40", "#a38f62", 1)
    c.line([(139, 494), (119, 600)], "#586047", 13)
    c.line([(843, 494), (865, 600)], "#586047", 13)
    for j in range(7):
        c.line([(122+j*96, 402), (81+j*118, 473)], "#7f7651", .7)
    book(c, 186, 414, 164, 34, -5)
    book(c, 198, 391, 147, 28, -5)
    c.poly([(365, 419), (468, 402), (572, 425), (476, 452)], "#b2a580", "#d0bc8a", 1)
    c.line([(470, 404), (476, 449)], "#827d5c", .8)
    for i in range(4):
        c.line([(384+i*5, 420+i*5), (447+i*4, 408+i*5)], "#888164", .6)
        c.line([(488+i*3, 410+i*5), (551-i*5, 426+i*5)], "#888164", .6)
    c.ellipse((588, 426, 641, 445), "#263f40", "#9c916a", 1)
    c.line([(613, 434), (644, 351)], "#9a875f", 3)
    c.path([("M", 644, 351), ("L", 649, 334), ("L", 642, 345), ("Z",)], "#e3cca0")
    c.poly([(665, 436), (716, 394), (762, 438), (751, 442), (715, 412), (679, 442)], "#9a885d", "#cab07a", 1)
    c.ellipse((711, 391, 721, 401), "#c3ab73")
    lantern(c, 205, 220, 51, "#8a6447")
    c.line([(205, 125), (205, 100)], "#c1a16b", 2)
    c.poly([(766, 434), (810, 434), (802, 469), (775, 469)], "#4c6b5e", "#a39567", .8)
    for i in range(3):
        grass(c, 787, 436, 91+i*6, "#b1a465", True)
    return c.finish((1200, 720))


def farming_event():
    c = Canvas()
    c.gradient("#142f3c", "#648078", (672, 175, 400, 290, "#c4b57b", .35))
    c.ellipse((716, 90, 775, 149), "#c6b67d")
    mountains(c, 301, 90, "farm-far", "#3b6266", "#5e8280")
    for x in (588, 686, 799):
        house(c, x, 305, 92, 49, "#7f8d74", "#24434a", False, False)
    c.poly([(0, 300), (1000, 283), (1000, 600), (0, 600)], "#3b5b4b")
    # Curving irrigated plots lead toward the village, not a generic green rectangle.
    for j in range(6):
        yy = 317+j*47
        c.path([("M", -20, yy+34), ("C", 274, yy-34, 594, yy+39, 1020, yy-23)], stroke="#9c9b63", width=7)
        c.path([("M", -20, yy+43), ("C", 274, yy-25, 594, yy+48, 1020, yy-14)], stroke="#244c4c", width=10)
        for k in range(13):
            x = k*83+((j%2)*24)
            y = yy+18+22*math.sin(x/230)
            grass(c, x, y, 17+j*2, "#89985f")
    c.path([("M", 801, 288), ("C", 654, 373, 725, 443, 436, 600)], stroke="#8e9162", width=23)
    c.path([("M", 806, 289), ("C", 659, 374, 730, 444, 441, 600)], stroke="#668277", width=12)
    distant_person(c, 644, 396, 59, "#5d7054", True)
    c.line([(663, 364), (701, 415)], "#bfac76", 2)
    for i in range(9):
        grass(c, 62+i*29, 601-(i%3)*9, 95+(i%3)*13, "#b5a96b", True)
    c.poly([(835, 491), (915, 491), (905, 579), (844, 579)], "#5b6450", "#c0a875", 1.5)
    for i in range(7):
        c.line([(842+i*10, 499), (848+i*8, 573)], "#9a8b5f", 1)
    for j in range(7):
        c.line([(839, 503+j*10), (910, 503+j*10)], "#9a8b5f", 1)
    c.path([("M", 844, 501), ("C", 824, 449, 921, 449, 907, 501)], stroke="#b9a36f", width=4)
    return c.finish((960, 576))


def health_event():
    c = Canvas()
    c.gradient("#102b35", "#38504c", (650, 235, 450, 300, "#a3996b", .35))
    c.rect((78, 83, 435, 304), "#25464b", "#7c8b70", 2)
    for x in (167, 257, 346):
        c.line([(x, 85), (x, 302)], "#65806c", 3)
    for y in (154, 227):
        c.line([(80, y), (433, y)], "#65806c", 3)
    # Botanical silhouettes behind the lattice and a tied, drying herb spray.
    c.path([("M", 112, 291), ("C", 155, 248, 101, 198, 150, 113)], stroke="#426762", width=1.8)
    for j in range(10):
        x, y = 126+(j%3)*7, 126+j*15
        c.path([("M", x, y), ("C", x-24, y-21, x-35, y-12, x-32, y-1),
                ("C", x-24, y+6, x-8, y+3, x, y)], fill="#45695f", stroke="#66816c", width=.4)
    c.line([(337, 108), (337, 148)], "#a39068", 1)
    for j in range(8):
        x = 322+j*4
        c.path([("M", 337, 148), ("C", x, 165, x-8, 192, x-5, 216+j%3*8)], stroke="#8d9164", width=.8)
        for k in range(4):
            y = 171+k*11
            c.path([("M", x-2, y), ("C", x-14, y-12, x-18, y-2, x-6, y+6)], fill="#7d8b61")
    c.line([(327, 150), (347, 150)], "#bcaa77", 2)
    # A herb cupboard with unlabelled ceramic jars.
    c.rect((550, 83, 923, 323), "#1a3439", "#7c7b5d", 3)
    for row in range(2):
        yy = 193+row*106
        c.line([(553, yy), (920, yy)], "#8b815b", 4)
        for j in range(5):
            x = 582+j*69
            c.path([("M", x-20, yy-7), ("L", x-24, yy-47), ("C", x-25, yy-61, x+24, yy-61, x+23, yy-47),
                    ("L", x+20, yy-7), ("Z",)], "#567264" if (j+row)%2 else "#807c5c", "#ab9b6d", 1)
            c.ellipse((x-18, yy-67, x+18, yy-57), "#294440", "#aa9568", 1)
            c.ellipse((x-5, yy-72, x+5, yy-65), "#a58c61")
            c.path([("M", x-13, yy-48), ("C", x-17, yy-35, x-14, yy-22, x-13, yy-13)],
                   stroke="#a4a07a" if (j+row)%2 else "#b3a175", width=1.2)
            c.line([(x+17, yy-43), (x+14, yy-13)], "#3f5c4f", .7)
    c.poly([(0, 371), (1000, 347), (1000, 600), (0, 600)], "#5e6049", "#8f845c", 2)
    for y in (426, 494, 562):
        c.line([(0, y), (1000, y-17)], "#747150", 1)
    for j in range(13):
        x, y = 34+j*77, 397+(j%4)*39
        c.path([("M", x, y), ("C", x+17, y-5, x+36, y+4, x+58, y-2)], stroke="#7b7653", width=.55)
    c.ellipse((287, 498, 468, 513), "#424e3d")
    c.ellipse((652, 483, 777, 495), "#424e3d")
    # Mortar, wrapped clean bandage, preparation bowls: no efficacy claim or cross symbol.
    bowl(c, 380, 459, 186, 73, "#667a68", True)
    c.path([("M", 397, 415), ("L", 451, 320), ("C", 457, 311, 480, 319, 475, 330),
            ("L", 425, 426)], fill="#9c936e", stroke="#d0bd89", width=1)
    c.line([(409, 411), (466, 326)], "#736f50", 1)
    bowl(c, 713, 465, 138, 43, "#435e58", True)
    c.poly([(70, 466), (191, 443), (246, 485), (130, 514)], "#c0b594", "#e0cda6", 1)
    c.poly([(123, 461), (163, 455), (209, 495), (170, 504)], "#d8cba8", "#a79b78", 1)
    c.ellipse((122, 451, 164, 478), "#ddd1ae", "#a79b78", 1)
    c.ellipse((132, 458, 154, 471), "#b1a986", "#e6d4ac", 1)
    c.path([("M", 498, 554), ("C", 557, 515, 551, 480, 631, 477)], stroke="#9d9e6d", width=2)
    for j in range(9):
        x, y = 519+j*11, 542-j*7
        c.poly([(x, y), (x-17, y-26), (x+2, y-15)], "#8b9666", "#a5a574", .5)
        c.poly([(x+3, y-3), (x+22, y-15), (x+13, y+1)], "#788c62", "#a5a574", .5)
    c.path([("M", 656, 401), ("C", 633, 369, 681, 354, 655, 321),
            ("C", 642, 297, 673, 284, 671, 267)], stroke="#91aaa0", width=1.5)
    c.path([("M", 694, 402), ("C", 718, 366, 685, 342, 708, 321)], stroke="#6c8c84", width=1)
    lantern(c, 467, 186, 29, "#8f694d")
    return c.finish((960, 576))


def workshop_event():
    c = Canvas()
    c.gradient("#0e2732", "#3d5049", (728, 275, 400, 330, "#bd9a61", .40))
    # Timber frame, tool wall, and a small furnace are all drawn, not a photo texture.
    for x in (75, 503, 920):
        c.rect((x, 0, x+17, 400), "#475345", "#817752", 1)
    c.rect((0, 70, 1000, 91), "#465143", "#8c7d55", 1)
    c.rect((113, 121, 457, 307), "#1c363b", "#728068", 1)
    c.line([(135, 153), (436, 153)], "#91815a", 3)
    for x, length in ((160, 92), (223, 115), (286, 86), (361, 121), (414, 96)):
        c.line([(x, 154), (x, 154+length)], "#ae9767", 5)
    c.poly([(147, 229), (174, 229), (183, 246), (141, 246)], "#788e82", "#b3b18b", 1)
    c.poly([(209, 244), (237, 244), (237, 278), (209, 278)], "#7f968a", "#b3b18b", 1)
    c.poly([(274, 222), (314, 222), (302, 243), (274, 247)], "#799186", "#b3b18b", 1)
    c.line([(344, 267), (380, 267)], "#728d85", 13)
    c.path([("M", 638, 339), ("L", 638, 236), ("C", 638, 139, 856, 139, 856, 236),
            ("L", 856, 339), ("Z",)], fill="#525949", stroke="#918363", width=2)
    c.path([("M", 678, 334), ("L", 678, 248), ("C", 678, 181, 817, 181, 817, 248),
            ("L", 817, 334), ("Z",)], fill="#2c3831", stroke="#ad986b", width=1.5)
    c.glow(747, 297, 65, 56, "#d4a362", 90, 35)
    c.path([("M", 691, 332), ("C", 708, 312, 707, 299, 722, 276),
            ("C", 726, 309, 745, 292, 749, 255), ("C", 783, 298, 775, 308, 803, 331), ("Z",)], "#af8951")
    c.path([("M", 714, 332), ("C", 741, 297, 751, 326, 764, 293), ("L", 785, 332), ("Z",)], "#e0b371")
    c.poly([(0, 376), (909, 364), (1000, 466), (0, 494)], "#727050", "#ad9766", 2)
    c.poly([(0, 494), (1000, 466), (1000, 489), (0, 519)], "#3e4c3d", "#a28b5b", 1)
    c.line([(118, 511), (91, 600)], "#566044", 14)
    c.line([(869, 493), (888, 600)], "#566044", 14)
    for j in range(6):
        c.line([(83+j*125, 377), (163+j*125, 489)], "#91815a", .8)
    # A recognisable wooden hand plane and square, with material joinery.
    c.poly([(298, 431), (491, 416), (548, 450), (352, 468)], "#9b8152", "#c8ac75", 1.5)
    c.poly([(352, 468), (548, 450), (548, 469), (352, 488)], "#5f6548", "#b29d66", 1)
    c.poly([(390, 440), (422, 438), (411, 366), (394, 372)], "#718b82", "#c1b68b", 1)
    c.path([("M", 441, 430), ("C", 429, 393, 483, 390, 488, 423)], stroke="#c0a16b", width=10)
    c.poly([(596, 416), (613, 411), (672, 468), (660, 476)], "#c1a36d", "#e0bd80", .8)
    c.poly([(660, 476), (734, 425), (742, 435), (672, 488)], "#c1a36d", "#e0bd80", .8)
    for i in range(9):
        c.line([(686+i*5, 449-i*3.5), (689+i*5, 452-i*3.5)], "#5d6750", 1)
    for j in range(9):
        x, y = 206+j*42, 527+(j%3)*15
        c.path([("M", x, y), ("C", x-19, y-22, x+25, y-23, x+16, y-1),
                ("C", x+8, y+10, x+34, y+8, x+34, y-9)], stroke="#b8a36d", width=2)
    return c.finish((960, 576))


def night_event():
    c = Canvas()
    c.gradient("#081624", "#2e535d", (647, 178, 390, 290, "#6c9392", .35))
    c.ellipse((656, 68, 727, 139), "#b6c2aa")
    c.ellipse((674, 57, 738, 122), "#183541")
    r = seeded("night-stars")
    for _ in range(70):
        x, y = r.uniform(30, 960), r.uniform(20, 290)
        c.ellipse((x, y, x+1, y+1.4), "#65858c")
    clouds(c, 178, "night-cloud", "#365b65", 8)
    house(c, 612, 344, 215, 112, "#3e5e5e", "#102b39", False)
    c.path([("M", 567, 344), ("L", 567, 309), ("C", 567, 257, 654, 257, 654, 309),
            ("L", 654, 344), ("Z",)], "#102936", "#75816e", 1)
    stone_path(c, 610, 335, 87, 960, 600, "#344c4e", "night-paving")
    house(c, 73, 466, 236, 209, "#2c4a50", "#102734", False)
    house(c, 919, 468, 254, 218, "#345255", "#102733", False)
    for x, y, sz in ((146, 351, 18), (858, 349, 16), (713, 309, 9)):
        lantern(c, x, y, sz)
    # Anonymous watch keeper, viewed from behind, taking up a real part of the scene.
    distant_person(c, 474, 522, 155, "#263f48", False)
    c.path([("M", 450, 392), ("C", 467, 380, 485, 379, 496, 396)], stroke="#63786d", width=7)
    c.line([(493, 408), (544, 430)], "#738477", 8)
    c.line([(545, 427), (563, 472)], "#b4a375", 2)
    lantern(c, 563, 489, 25, "#a4774b")
    c.glow(549, 528, 66, 26, "#bc9c5d", 32, 21)
    c.line([(441, 416), (408, 541)], "#9f9469", 4)
    for i in range(12):
        c.line([(484-i*11, 550+i*3), (588+i*6, 550+i*3)], "#576458", .6)
    pine(c, 770, 355, 120, "#12303c")
    return c.finish((960, 576))


def market_event():
    c = Canvas()
    c.gradient("#142d37", "#5c7467", (515, 189, 430, 320, "#b3a477", .40))
    clouds(c, 75, "market-cloud", "#557774", 6)
    for x, w, h in ((181, 242, 147), (459, 210, 122), (739, 225, 155), (945, 196, 155)):
        house(c, x, 309, w, h, "#7d8b76", "#24424a", True)
    stone_path(c, 521, 306, 201, 905, 600, "#66705c", "market-street")
    # Two different cloth canopies and substantive wares, all without labels or signs.
    for x, width, top, fill in ((190, 325, 246, "#8c6550"), (802, 320, 240, "#596f5b")):
        for sign in (-1, 1):
            c.line([(x+sign*width*.44, top+12), (x+sign*width*.44, 516)], "#a09265", 5)
        c.poly([(x-width*.47, top), (x+width*.47, top), (x+width*.58, top+97), (x-width*.58, top+97)], fill, "#b19b6d", 1)
        for j in range(8):
            xx = x-width*.47+j*width*.134
            c.line([(xx, top), (x-width*.58+j*width*.166, top+96)], blend(fill, LIGHT, .25), 1)
        for j in range(7):
            xx = x-width*.58+j*width*.166
            c.path([("M", xx, top+97), ("C", xx+9, top+112, xx+26, top+112, xx+width*.166, top+97)],
                   fill=fill, stroke="#b29a6b", width=.8)
        c.poly([(x-width*.5, 455), (x+width*.5, 448), (x+width*.54, 480), (x-width*.54, 490)], "#6f704f", "#ab9566", 1)
        c.poly([(x-width*.54, 490), (x+width*.54, 480), (x+width*.5, 531), (x-width*.5, 537)], "#3f5648", "#9a8a5f", 1)
    for x, size in ((95, 48), (181, 64), (274, 50)):
        bowl(c, x, 462, size, size*.42, "#81947b", x != 181)
    for x, w, fill in ((719, 46, "#998260"), (786, 51, "#6a8d79"), (856, 49, "#b29a71")):
        c.path([("M", x-w*.4, 454), ("C", x-w*.8, 408, x-w*.15, 401, x-w*.18, 386),
                ("L", x+w*.18, 386), ("C", x+w*.15, 401, x+w*.8, 408, x+w*.4, 454), ("Z",)], fill, "#c5b381", 1)
        c.ellipse((x-w*.2, 382, x+w*.2, 390), "#314d43", "#c5b381", 1)
    for x, y, s in ((434, 482, 94), (570, 471, 85), (485, 367, 44)):
        distant_person(c, x, y, s, "#38594e" if x < 500 else "#715e4c", x != 570)
    c.line([(453, 424), (497, 427)], "#b1a078", 5)
    c.line([(554, 420), (514, 427)], "#b1a078", 5)
    lantern(c, 400, 230, 26)
    lantern(c, 618, 225, 26)
    c.path([("M", 347, 164), ("C", 415, 186, 591, 189, 669, 161)], stroke="#ac996f", width=1)
    for i in range(9):
        grass(c, 43+i*10, 582, 40+i%3*7, "#a99e66", True)
    return c.finish((960, 576))


def war_event():
    c = Canvas()
    c.gradient("#142835", "#5b665c", (719, 209, 450, 320, "#a18d65", .28))
    clouds(c, 100, "war-cloud", "#455b61", 12)
    mountains(c, 330, 122, "war-far", "#314c54", "#566b69")
    mountains(c, 389, 94, "war-near", "#273f48", "#53645d")
    c.path([("M", 459, 312), ("L", 1000, 284), ("L", 1000, 391), ("L", 459, 408), ("Z",)], "#566055", "#919077", 1)
    for x in range(470, 1000, 37):
        c.poly([(x, 312-(x-459)*.052), (x+21, 311-(x-459)*.052), (x+21, 292-(x-459)*.052), (x, 293-(x-459)*.052)], "#66705e")
    for i in range(6):
        yy = 326+i*12
        c.line([(461, yy), (1000, yy-26)], "#727664", .6)
    c.rect((738, 245, 823, 308), "#7b785d")
    roof(c, 780, 247, 134, 54, "#203942", "#aa976c")
    c.path([("M", 659, 393), ("L", 659, 359), ("C", 659, 305, 726, 305, 726, 359),
            ("L", 726, 393), ("Z",)], "#1f3540", "#969477", 1)
    c.poly([(0, 421), (322, 373), (552, 427), (1000, 401), (1000, 600), (0, 600)], "#273e40")
    stone_path(c, 691, 389, 513, 821, 600, "#62614e", "war-road")
    # Banners carry no emblem, ethnicity, faction, inscription, or real person's crest.
    for x, y, h, fill in ((150, 177, 322, "#77594c"), (334, 220, 252, "#5c6b5d"), (893, 258, 186, "#6c554b")):
        c.line([(x, y-18), (x, y+h)], "#ac9d76", 3)
        c.poly([(x+3, y), (x+98, y+14), (x+79, y+53), (x+98, y+83), (x+3, y+72)], fill, "#a39069", .8)
        c.path([("M", x+4, y+20), ("C", x+35, y+12, x+63, y+34, x+89, y+27)], stroke=blend(fill, GOLD, .35), width=.8)
    # Back-view armoured sentry and upright shields; no battle, injury, or bodies.
    c.ellipse((248, 306, 313, 369), "#516a6c", "#a19a76", 1.3)
    c.path([("M", 244, 350), ("C", 246, 294, 309, 291, 317, 350)], stroke="#9e9a77", width=2)
    c.ellipse((275, 297, 286, 312), "#9b8e69")
    c.poly([(246, 365), (309, 365), (332, 487), (224, 487)], "#3a5457", "#939372", 1.2)
    for row in range(6):
        yy = 380+row*15
        c.line([(240-row*2, yy), (315+row*2, yy)], "#82917e", 1)
        for j in range(5):
            xx = 241+j*17
            c.line([(xx+(row%2)*8, yy), (xx+(row%2)*8, yy+12)], "#5e7875", .7)
    c.line([(251, 483), (244, 576)], "#283e42", 12)
    c.line([(300, 483), (310, 576)], "#283e42", 12)
    c.line([(334, 394), (357, 574)], "#8b805e", 4)
    c.poly([(352, 365), (359, 336), (364, 366)], "#9caf9b", "#c3c0a1", .8)
    for x in (87, 420):
        c.path([("M", x, 476), ("C", x-32, 477, x-42, 499, x-33, 536),
                ("C", x-26, 567, x-6, 584, x, 590), ("C", x+29, 570, x+42, 542, x+35, 507),
                ("C", x+33, 483, x+17, 477, x, 476), ("Z",)], "#4c6058", "#a7976c", 1.5)
        c.line([(x, 485), (x, 575)], "#9d936a", 2)
    return c.finish((960, 576))


def generic_event():
    c = Canvas()
    c.gradient("#16303c", "#6c8476", (638, 183, 450, 300, "#b2ac7a", .33))
    clouds(c, 89, "generic-cloud", "#5d7f7b", 7)
    mountains(c, 336, 128, "generic-far", "#3b6267", "#678580")
    mountains(c, 395, 73, "generic-near", "#2e5458", "#58766d")
    water(c, (431, 378, 1000, 600), "generic-river", "#365d60", "#a5b39a", 110)
    c.poly([(0, 377), (315, 343), (591, 448), (632, 600), (0, 600)], "#3d5a4a")
    stone_path(c, 492, 360, 93, 499, 600, "#8c8961", "generic-fork")
    c.path([("M", 403, 429), ("C", 274, 398, 158, 402, 0, 447), ("L", 0, 480),
            ("C", 136, 431, 305, 431, 391, 455), ("Z",)], "#7d7e57")
    house(c, 796, 382, 142, 75, "#829179", "#29464b", True)
    house(c, 936, 383, 109, 63, "#718a76", "#28474e", False)
    # An old tree and blank roadside stone create an everyday threshold, not a quest marker.
    c.path([("M", 193, 543), ("C", 163, 444, 208, 329, 161, 199)], stroke="#3b5147", width=21)
    c.path([("M", 180, 356), ("C", 89, 314, 64, 233, 5, 198)], stroke="#3b5147", width=12)
    c.path([("M", 176, 282), ("C", 235, 256, 275, 191, 353, 192)], stroke="#3b5147", width=9)
    r = seeded("generic-leaves")
    for _ in range(150):
        x, y = r.uniform(-40, 384), r.uniform(91, 268)
        if ((x-165)/225)**2+((y-180)/96)**2 < 1:
            c.path([("M", x-14, y+4), ("C", x-7, y-13, x+12, y-11, x+18, y+3), ("Z",)],
                   r.choice(["#3d634f", "#55765b", "#6f805d", "#526e51"]), None)
    c.path([("M", 177, 354), ("C", 156, 412, 173, 484, 183, 521)], stroke="#8a8b62", width=1.5)
    c.path([("M", 326, 474), ("L", 330, 417), ("C", 330, 395, 373, 396, 377, 417),
            ("L", 385, 474), ("Z",)], "#73816a", "#b5ad82", 1.5)
    c.line([(338, 424), (345, 459)], "#8c9273", .6)
    distant_person(c, 489, 404, 40, "#4d6856", True)
    for i in range(14):
        grass(c, 23+i*42, 576+(i%3)*11, 35+(i%4)*8, "#8d9967", i%5 == 0)
    return c.finish((960, 576))


def medallion_base():
    c = Canvas(400, 400, True)
    c.ellipse((30, 30, 370, 370), "#132d38", "#9e8b61", 2)
    c.ellipse((39, 39, 361, 361), "#193944", "#3c6d70", 1)
    c.ellipse((52, 52, 348, 348), None, "#6e806e", .7)
    for i in range(32):
        a = 2*math.pi*i/32
        c.line([(200+math.cos(a)*174, 200+math.sin(a)*174),
                (200+math.cos(a)*179, 200+math.sin(a)*179)], "#8e8c6d", 1)
    for x, y in ((200, 29), (371, 200), (200, 371), (29, 200)):
        c.poly([(x, y-5), (x+5, y), (x, y+5), (x-5, y)], "#b8a170")
    return c


def refugee_sign():
    c = medallion_base()
    # Practical travel belongings, respectfully depicted rather than a caricature.
    c.path([("M", 114, 283), ("C", 128, 208, 101, 145, 139, 87)], stroke="#9f966c", width=8)
    c.path([("M", 138, 88), ("C", 144, 73, 165, 86, 153, 101)], stroke="#c2ab77", width=4)
    c.poly([(135, 199), (194, 148), (274, 178), (297, 242), (273, 285), (179, 294)], "#777f65", "#c3b07c", 1.5)
    c.path([("M", 149, 216), ("C", 209, 235, 235, 198, 284, 210)], stroke="#c5af7a", width=3)
    c.path([("M", 194, 151), ("C", 216, 194, 188, 246, 209, 289)], stroke="#344e4c", width=4)
    c.poly([(205, 159), (215, 131), (238, 140), (235, 162)], "#9b9d78", "#d5c18c", 1)
    c.path([("M", 202, 168), ("C", 221, 153, 225, 151, 236, 165)], stroke="#d0b783", width=2)
    bowl(c, 260, 287, 74, 27, "#5a7d72")
    c.path([("M", 98, 312), ("C", 148, 296, 236, 329, 306, 307)], stroke="#728573", width=1)
    grass(c, 96, 312, 42, "#9a9a6a")
    return c.finish((384, 384), False)


def soldier_sign():
    c = medallion_base()
    # Ming-style rounded iron helmet and simple lamellar neck protection.
    c.line([(95, 301), (129, 85)], "#a99b70", 5)
    c.poly([(125, 88), (138, 61), (139, 95)], "#abc1af", "#cfca9d", 1)
    c.path([("M", 153, 202), ("C", 153, 105, 281, 105, 284, 202), ("Z",)], "#527579", "#bdad7f", 2)
    c.path([("M", 160, 192), ("C", 176, 122, 263, 121, 277, 192)], stroke="#aab29a", width=1)
    c.path([("M", 218, 126), ("C", 209, 141, 209, 172, 213, 198)], stroke="#c5b98a", width=3)
    c.ellipse((207, 109, 230, 132), "#9b9670", "#d4bd85", 1)
    c.poly([(144, 195), (288, 195), (298, 214), (135, 214)], "#2d4e55", "#c0b17f", 1)
    c.poly([(158, 215), (278, 215), (294, 295), (144, 295)], "#3a6066", "#9f9f7c", 1)
    for row in range(5):
        yy = 226+row*13
        c.line([(156-row*2, yy), (279+row*2, yy)], "#9aa58b", 1)
        for j in range(6):
            x = 161+j*21+(row%2)*9
            c.line([(x, yy), (x-2, yy+11)], "#728e81", .8)
    c.ellipse((174, 181, 180, 187), "#d3bc82")
    c.ellipse((255, 181, 261, 187), "#d3bc82")
    c.path([("M", 92, 316), ("C", 156, 306, 237, 324, 311, 310)], stroke="#6b8375", width=1)
    return c.finish((384, 384), False)


def gentry_sign():
    c = medallion_base()
    c.poly([(91, 200), (187, 180), (298, 205), (206, 248)], "#b1a582", "#ddc995", 1.5)
    c.poly([(91, 200), (206, 235), (206, 265), (91, 229)], "#5c6c5b", "#a9a077", 1)
    c.poly([(206, 235), (298, 205), (298, 233), (206, 265)], "#9a9676", "#d2be8b", 1)
    c.line([(188, 184), (206, 235)], "#747f65", 1.5)
    # Geometric page ruling is binding detail, never rows of fake characters.
    for j in range(4):
        c.line([(96, 211+j*5), (203, 243+j*5)], "#8b9576", .7)
        c.line([(209, 244+j*5), (294, 215+j*5)], "#666f59", .7)
    book(c, 110, 275, 155, 29, -6)
    c.ellipse((259, 272, 318, 291), "#142e36", "#afa171", 1)
    c.ellipse((268, 276, 307, 285), "#0b1e28")
    c.line([(277, 267), (292, 121)], "#ae9461", 7)
    c.line([(278, 266), (294, 120)], "#d6bd83", 1)
    c.path([("M", 289, 125), ("C", 279, 102, 297, 86, 300, 68),
            ("C", 307, 95, 313, 107, 300, 124), ("Z",)], "#d7c69e", "#7e8b77", .8)
    c.path([("M", 97, 307), ("C", 148, 314, 254, 323, 316, 302)], stroke="#5e8172", width=1)
    return c.finish((384, 384), False)


def portrait_base():
    c = Canvas(480, 600, True)
    # Transparent outside the etched arch and figure; dark negative space inside.
    c.path([("M", 36, 523), ("L", 36, 230), ("C", 36, 38, 444, 38, 444, 230),
            ("L", 444, 523), ("Z",)], "#16313b", "#887e5a", 1.2)
    c.path([("M", 45, 508), ("L", 45, 230), ("C", 45, 51, 435, 51, 435, 230),
            ("L", 435, 508)], stroke="#386269", width=1)
    c.ellipse((98, 109, 382, 393), "#1e4149", "#4b7170", .7)
    for x, y in ((67, 202), (408, 202), (71, 406), (403, 406)):
        c.poly([(x, y-6), (x+3, y), (x, y+6), (x-3, y)], "#928963")
    return c


def face(c, x=240, y=233, w=81, h=113, older=False, skin="#b39570", beard=False):
    # Quiet, natural facial proportions, never based on an existing portrait.
    c.ellipse((x-w*.64, y-h*.18, x-w*.39, y+h*.12), skin, "#786d56", .8)
    c.ellipse((x+w*.39, y-h*.18, x+w*.64, y+h*.12), blend(skin, INK, .16), "#786d56", .8)
    c.path([("M", x-w*.48, y-h*.52), ("C", x-w*.49, y+h*.03, x-w*.35, y+h*.47, x, y+h*.51),
            ("C", x+w*.37, y+h*.49, x+w*.51, y+h*.02, x+w*.47, y-h*.52), ("Z",)], skin, "#776d54", 1)
    c.path([("M", x+w*.32, y-h*.49), ("C", x+w*.56, y-h*.03, x+w*.28, y+h*.42, x, y+h*.48),
            ("C", x+w*.20, y+h*.16, x+w*.13, y-h*.21, x+w*.32, y-h*.49), ("Z",)], blend(skin, INK, .13))
    for sign in (-1, 1):
        xx = x+sign*w*.23
        c.path([("M", xx-w*.115, y-h*.13), ("C", xx-w*.04, y-h*.18, xx+w*.06, y-h*.17, xx+w*.115, y-h*.12)], stroke="#4c4d40", width=2)
        c.path([("M", xx-w*.09, y-h*.058), ("C", xx-w*.03, y-h*.08, xx+w*.04, y-h*.08, xx+w*.095, y-h*.055)], stroke="#45483c", width=1.3)
        c.ellipse((xx-1.7, y-h*.072, xx+1.2, y-h*.044), "#253538")
    c.path([("M", x+1, y-h*.055), ("C", x-2, y+h*.025, x-8, y+h*.11, x-3, y+h*.145),
            ("C", x+1, y+h*.17, x+7, y+h*.155, x+10, y+h*.13)], stroke="#806e54", width=1)
    c.path([("M", x-w*.15, y+h*.29), ("C", x-w*.04, y+h*.31, x+w*.06, y+h*.32, x+w*.17, y+h*.275)], stroke="#755849", width=1.2)
    c.path([("M", x-w*.10, y+h*.34), ("C", x, y+h*.37, x+w*.10, y+h*.35, x+w*.12, y+h*.33)], stroke=blend(skin, LIGHT, .25), width=.8)
    if older:
        for sign in (-1, 1):
            xx = x+sign*w*.34
            c.line([(xx, y-h*.01), (xx+sign*7, y+h*.025)], "#8c785b", .7)
            c.path([("M", xx, y+h*.11), ("C", xx-sign*5, y+h*.17, xx-sign*7, y+h*.23, xx-sign*4, y+h*.28)], stroke="#9a815e", width=.7)
        c.path([("M", x-18, y-h*.31), ("C", x-3, y-h*.34, x+10, y-h*.33, x+23, y-h*.30)], stroke="#927e60", width=.7)
    if beard:
        c.path([("M", x-21, y+h*.31), ("C", x-13, y+h*.49, x-9, y+h*.57, x+2, y+h*.60),
                ("C", x+17, y+h*.51, x+23, y+h*.40, x+22, y+h*.28)], fill="#43504a")
        for i in range(8):
            c.line([(x-17+i*5, y+h*.34), (x-11+i*3, y+h*.53)], "#878a70", .6)


def robe(c, color="#536d61", collar="#9f9c7a", apron=False):
    c.path([("M", 180, 296), ("C", 139, 310, 107, 326, 91, 362), ("L", 55, 529),
            ("C", 131, 559, 346, 559, 427, 528), ("L", 394, 359),
            ("C", 380, 325, 339, 310, 301, 297), ("Z",)], color, "#87937a", 1.3)
    c.path([("M", 180, 299), ("C", 197, 324, 236, 346, 282, 369), ("L", 270, 384),
            ("C", 224, 359, 187, 334, 169, 311), ("Z",)], collar, "#b8ac80", .7)
    c.path([("M", 298, 299), ("C", 283, 323, 245, 345, 202, 366), ("L", 213, 383),
            ("C", 252, 365, 292, 338, 309, 311), ("Z",)], collar, "#b8ac80", .7)
    c.path([("M", 203, 370), ("C", 231, 392, 253, 432, 276, 530)], stroke=blend(color, INK, .35), width=2)
    for points in (((133, 344), (156, 392), (121, 485)), ((359, 341), (331, 394), (365, 502)),
                   ((166, 394), (181, 460), (167, 534)), ((310, 397), (303, 476), (318, 537))):
        c.path([("M", *points[0]), ("C", points[1][0], points[1][1]-20, *points[1], *points[2])],
               stroke=blend(color, LIGHT, .18), width=1.3)
    if apron:
        c.poly([(170, 369), (313, 369), (335, 542), (147, 542)], "#555c48", "#a39167", 1)
        c.path([("M", 170, 371), ("C", 176, 334, 171, 323, 193, 305)], stroke="#b0a17a", width=5)
        c.path([("M", 312, 371), ("C", 304, 339, 304, 321, 287, 305)], stroke="#b0a17a", width=5)
        c.rect((191, 445, 296, 496), "#4b5745", "#8d8c63", .8)


def hand(c, x, y, size=29, fill="#ad9471", tilt=1):
    c.path([("M", x-size*.6, y+size*.25), ("C", x-size*.7, y-size*.4, x-size*.3, y-size*.65, x+size*.08, y-size*.38),
            ("C", x+size*.15, y-size*.7, x+size*.35, y-size*.66, x+size*.42, y-size*.32),
            ("C", x+size*.83, y-size*.3, x+size*.76, y+size*.25, x+size*.37, y+size*.35),
            ("L", x-size*.6, y+size*.25), ("Z",)], fill, "#776f55", .8)
    for i in range(3):
        c.line([(x-size*.15+i*size*.18, y-size*.25), (x-size*.1+i*size*.18, y+size*.11)], "#8f7c5e", .6)


def farmer_portrait():
    c = portrait_base()
    # Field tools, mature weathered face, straw hat and crossed-collar work clothes.
    c.line([(100, 537), (129, 139)], "#9c9365", 9)
    c.line([(103, 532), (131, 144)], "#c7b581", 1.2)
    c.poly([(127, 137), (188, 146), (173, 171), (125, 158)], "#6c8982", "#b9bea0", 1.3)
    robe(c, "#6b7d65", "#b0a781")
    c.poly([(213, 278), (274, 276), (280, 302), (244, 321), (205, 302)], "#ac8f6b")
    face(c, y=232, older=True, skin="#b49a74")
    c.path([("M", 155, 205), ("C", 174, 139, 301, 130, 325, 204), ("Z",)], "#545f4f")
    c.path([("M", 113, 204), ("C", 163, 177, 204, 112, 244, 119),
            ("C", 282, 119, 331, 179, 370, 206), ("C", 301, 224, 184, 225, 113, 204), ("Z",)], "#9e9365", "#d0bc83", 1.2)
    for i in range(19):
        x = 121+i*13.2
        c.line([(242, 124), (x, 206+10*math.sin((x-121)/250*math.pi))], "#b8a571" if i%2 else "#807e57", .7)
    c.path([("M", 127, 207), ("C", 184, 217, 300, 218, 356, 207)], stroke="#dbbf80", width=2)
    c.path([("M", 171, 216), ("C", 173, 274, 199, 305, 235, 323)], stroke="#8e8c67", width=1)
    c.path([("M", 312, 216), ("C", 309, 273, 283, 308, 244, 326)], stroke="#8e8c67", width=1)
    hand(c, 115, 430, 31, "#b39a73")
    for i in range(6):
        grass(c, 364+i*5, 552, 124+(i%3)*17, "#baa66a", True)
    hand(c, 350, 480, 31, "#b39a73")
    c.path([("M", 37, 554), ("C", 161, 571, 317, 570, 446, 549)], stroke="#9b936a", width=1)
    return c.finish((480, 600), False)


def artisan_portrait():
    c = portrait_base()
    # Woodworker's square frames the right shoulder; no specific invented named artisan.
    c.poly([(354, 190), (389, 190), (389, 402), (367, 402), (367, 217), (313, 217), (313, 190)], "#a48c59", "#ceb47d", 1)
    for j in range(13):
        c.line([(374, 228+j*12), (384, 228+j*12)], "#4e6254", .8)
    robe(c, "#587b75", "#aeb397", True)
    c.poly([(210, 274), (271, 272), (278, 301), (241, 319), (206, 302)], "#bc9e7a")
    face(c, y=230, skin="#bea17b")
    c.path([("M", 191, 203), ("C", 180, 148, 206, 142, 248, 142),
            ("C", 289, 143, 303, 160, 289, 204), ("C", 271, 184, 214, 181, 191, 203), ("Z",)], "#344e55", "#8ca18d", 1)
    c.path([("M", 184, 187), ("C", 213, 169, 267, 170, 297, 189), ("L", 292, 209),
            ("C", 264, 190, 213, 191, 188, 209), ("Z",)], "#54716f", "#a6ad8d", .8)
    for j in range(3):
        c.path([("M", 187, 189+j*5), ("C", 218, 176+j*5, 265, 178+j*5, 294, 191+j*5)], stroke="#7c9586", width=.6)
    c.path([("M", 291, 189), ("C", 318, 196, 315, 223, 336, 226), ("L", 322, 236), ("C", 296, 227, 300, 210, 286, 205)], fill="#48656a", stroke="#879b83", width=.8)
    # Carried hand plane, iron blade and shaped wooden handle.
    c.poly([(134, 465), (295, 449), (344, 480), (180, 499)], "#9e8556", "#cfb47d", 1.5)
    c.poly([(180, 499), (344, 480), (344, 501), (180, 520)], "#576448", "#b59f6b", 1)
    c.poly([(221, 469), (244, 466), (236, 412), (218, 416)], "#81998c", "#c8c29a", 1)
    c.path([("M", 263, 459), ("C", 251, 423, 299, 426, 303, 455)], stroke="#c5a36a", width=8)
    hand(c, 152, 480, 28, "#ba9d77")
    hand(c, 331, 480, 28, "#ba9d77")
    for x, y in ((94, 541), (364, 550), (285, 558)):
        c.path([("M", x, y), ("C", x-20, y-17, x+18, y-25, x+20, y-6),
                ("C", x+22, y+9, x+40, y+4, x+33, y-6)], stroke="#a99765", width=1.5)
    return c.finish((480, 600), False)


def merchant_portrait():
    c = portrait_base()
    robe(c, "#665f50", "#b0a782")
    c.poly([(209, 274), (272, 273), (278, 301), (242, 319), (205, 301)], "#b89b77")
    face(c, y=226, older=True, skin="#b89d79", beard=True)
    # Simple fitted Ming cloth cap, explicitly no Qing queue or official rank badge.
    c.path([("M", 184, 197), ("C", 177, 142, 191, 124, 239, 124),
            ("C", 289, 123, 303, 149, 296, 197), ("L", 184, 197), ("Z",)], "#263f46", "#a29e78", 1.2)
    c.path([("M", 184, 191), ("C", 213, 184, 265, 184, 296, 191), ("L", 296, 209),
            ("C", 264, 200, 213, 201, 184, 209), ("Z",)], "#3b5658", "#a9a17c", .8)
    for xx in (208, 240, 272):
        c.path([("M", xx, 130), ("C", xx-7, 147, xx-6, 165, xx, 188)], stroke="#526d69", width=.8)
    c.ellipse((232, 188, 248, 204), "#718e7d", "#c0ad78", 1)
    # Abacus: material rails and actual bead structure, no monetary claims or lettering.
    c.poly([(123, 430), (325, 416), (354, 503), (145, 521)], "#866f4a", "#cfb37b", 2)
    c.poly([(137, 439), (314, 427), (337, 494), (156, 508)], "#173c3e", "#b09b6b", 1)
    c.line([(146, 462), (324, 450)], "#c8aa71", 4)
    for j in range(9):
        x = 151+j*19
        c.line([(x, 439-j*1.3), (x+18, 505-j*1.5)], "#a9976e", 1.2)
        for row in range(5):
            yy = 447-j*1.3+(row*11 if row else 0)
            xx = x+(yy-(439-j*1.3))*.27
            c.ellipse((xx-6, yy-3, xx+6, yy+3), "#b29866" if row < 2 else "#847b52", "#d0b27b", .6)
    hand(c, 136, 472, 28, "#b49a74")
    hand(c, 344, 469, 28, "#b49a74")
    book(c, 290, 531, 112, 22, -5)
    c.path([("M", 77, 540), ("C", 119, 558, 188, 552, 224, 558)], stroke="#8d8e66", width=1)
    return c.finish((480, 600), False)


DRAWINGS = {
    "scenes/home": (home_scene, "A machined teal time portal beside a tiled Ming village; quiet top and foot."),
    "scenes/shanbei": (shanbei_scene, "Dry loess terraces, cave dwellings, a settlement and a weathered tree."),
    "scenes/capital": (capital_scene, "Northern city wall and double-roofed gate tower with restrained lantern light."),
    "scenes/jiangnan": (jiangnan_scene, "Canal town, white plaster houses, a single-arch bridge, willow and covered boat."),
    "scenes/ending-natural": (natural_ending, "Empty wooden chair and tea table beside a circular evening window; contemplative."),
    "scenes/ending-hard": (hard_ending, "Rain over an empty mountain road, a closed travel bundle and sheltered lantern; no body."),
    "scenes/ending-career": (career_ending, "Sunrise over a study/workbench with books, brush, square and grain; no rank insignia."),
    "events/farming": (farming_event, "Irrigated curved fields, seedlings, a worker and woven harvest basket."),
    "events/health": (health_event, "Herb preparation table, mortar, unlabelled ceramic jars and a clean bandage."),
    "events/workshop": (workshop_event, "Timber workshop, hanging hand tools, a small furnace and detailed wooden plane."),
    "events/night": (night_event, "An anonymous lantern-carrying watch keeper on a moonlit stone lane."),
    "events/market": (market_event, "Cloth-canopy stalls with pottery, bowls and anonymous everyday shoppers."),
    "events/war": (war_event, "Distant fort, plain banners, back-view armoured sentry and upright shields; no combat or gore."),
    "events/generic": (generic_event, "A branching rural path beneath an old tree, blank roadside stone and river settlement."),
    "identity/refugee": (refugee_sign, "Respectful travel-bundle, walking-stick and bowl medallion."),
    "identity/soldier": (soldier_sign, "Rounded iron helmet, lamellar protection and upright spear medallion."),
    "identity/gentry": (gentry_sign, "Bound books, inkstone and brush medallion, without written characters."),
    "people/farmer": (farmer_portrait, "Anonymous mature farmer in straw hat and crossed-collar work clothes, hoe and grain."),
    "people/artisan": (artisan_portrait, "Anonymous woodworker with cloth headwrap, apron, square and carried wooden hand plane."),
    "people/merchant": (merchant_portrait, "Anonymous merchant with fitted cloth cap, crossed-collar robe, bound book and real abacus structure."),
}


def asset_uuid(relative):
    return str(uuid.uuid5(NAMESPACE, "ming-end-original-scene-art/" + relative))


def write_meta(path, relative, image):
    image_uuid = asset_uuid(relative)
    texture_uuid = image_uuid + "@6c48a"
    sprite_uuid = image_uuid + "@f9941"
    w, h = image.size
    # Sprite import, not texture-only import: resources.load('.../spriteFrame') works.
    meta = {
        "ver": "1.0.27", "importer": "image", "imported": True,
        "uuid": image_uuid, "files": [".json", ".png"],
        "subMetas": {
            "6c48a": {
                "importer": "texture", "uuid": texture_uuid, "displayName": path.stem,
                "id": "6c48a", "name": "texture", "ver": "1.0.22", "imported": True,
                "files": [".json"], "subMetas": {},
                "userData": {"wrapModeS": "clamp-to-edge", "wrapModeT": "clamp-to-edge",
                             "minfilter": "linear", "magfilter": "linear", "mipfilter": "none",
                             "anisotropy": 0, "isUuid": True,
                             "imageUuidOrDatabaseUri": image_uuid, "visible": False},
            },
            "f9941": {
                "importer": "sprite-frame", "uuid": sprite_uuid, "displayName": path.stem,
                "id": "f9941", "name": "spriteFrame", "ver": "1.0.12", "imported": True,
                "files": [".json"], "subMetas": {},
                "userData": {
                    "trimType": "none", "trimThreshold": 1, "rotated": False,
                    "offsetX": 0, "offsetY": 0, "trimX": 0, "trimY": 0,
                    "width": w, "height": h, "rawWidth": w, "rawHeight": h,
                    "borderTop": 0, "borderBottom": 0, "borderLeft": 0, "borderRight": 0,
                    "packable": False, "pixelsToUnit": 100, "pivotX": .5, "pivotY": .5,
                    "meshType": 0, "isUuid": True, "imageUuidOrDatabaseUri": texture_uuid,
                    "atlasUuid": "",
                    "vertices": {"rawPosition": [-w/2, -h/2, 0, w/2, -h/2, 0, -w/2, h/2, 0, w/2, h/2, 0],
                                 "indexes": [0, 1, 2, 2, 1, 3], "uv": [0, h, w, h, 0, 0, w, 0],
                                 "nuv": [0, 1, 1, 1, 0, 0, 1, 0],
                                 "minPos": [-w/2, -h/2, 0], "maxPos": [w/2, h/2, 0]},
                },
            },
        },
        "userData": {"type": "sprite-frame", "fixAlphaTransparencyArtifacts": False,
                     "hasAlpha": image.mode == "RGBA", "redirect": sprite_uuid,
                     "artworkLicense": LICENSE, "artworkSource": "tools/generate_ming_scene_art.py"},
    }
    path.with_suffix(".png.meta").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=list(DRAWINGS), action="append", help="Regenerate selected finished artwork(s).")
    parser.add_argument("--contact-sheet", type=Path, help="Optional inspection sheet outside the runtime resources.")
    args = parser.parse_args()
    selected = set(args.only or DRAWINGS)
    for relative, (draw, _) in DRAWINGS.items():
        path = ART / (relative + ".png")
        if relative in selected:
            path.parent.mkdir(parents=True, exist_ok=True)
            image = draw()
            # Opaque PNGs avoid unnecessary alpha channels; medallions/portraits retain real alpha.
            if relative.startswith(("scenes/", "events/")):
                image = image.convert("RGB")
            with io.BytesIO() as encoded:
                image.save(encoded, "PNG", optimize=True)
                path.write_bytes(encoded.getvalue())
            write_meta(path, relative, image)
            print(f"{path.relative_to(ROOT)}  {image.width}x{image.height}  {path.stat().st_size:,} bytes")
            image.close()
    if args.contact_sheet:
        keys = [key for key in DRAWINGS if (ART / (key + ".png")).exists()]
        cols, cellw, cellh = 4, 300, 248
        sheet = Image.new("RGB", (cols*cellw, math.ceil(len(keys)/cols)*cellh), rgb(INK))
        d = ImageDraw.Draw(sheet)
        for i, key in enumerate(keys):
            image = Image.open(ART / (key + ".png")).convert("RGBA")
            image.thumbnail((cellw-16, cellh-34), Image.Resampling.LANCZOS)
            x, y = (i%cols)*cellw+(cellw-image.width)//2, (i//cols)*cellh+8
            sheet.paste(image, (x, y), image)
            d.text(((i%cols)*cellw+8, (i//cols+1)*cellh-21), key, fill=rgb(LIGHT))
        args.contact_sheet.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(args.contact_sheet)


if __name__ == "__main__":
    main()
