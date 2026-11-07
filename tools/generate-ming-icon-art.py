#!/usr/bin/env python3
"""Reproduce the original Ming-end item illustrations and UI pictograms offline.

Art source: code-drawn, no image model, no external images, fonts, trademarks or
network calls. All paths and geometry below were authored for this project.
Requires Python 3.10+, Pillow >=10,<14 and resvg-py ==0.5.0. From project root:

  local/agent-sprite-forge-venv/bin/python tools/generate-ming-icon-art.py \
      --review /tmp/ming-end-icon-art-contact-sheet.png

The SVG design grid is 256 square. Items are rendered at 512 square; icons at
256 square. Transparent margins, material shading and a top-left light source
are intentional. The optional review sheet alone has labels and backgrounds;
no text or opaque background is baked into the game artwork. Source notes are
embedded in each PNG; stable Cocos SpriteFrame/texture metadata is beside it.
Only items/ and icons/ are owned here; their parent folder metas are not touched.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import io
import json
import math
from pathlib import Path
import uuid

from PIL import Image, ImageDraw, ImageFont, PngImagePlugin
import resvg_py

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "assets/resources/art/ming_end"
INK = "#15252e"
GOLD = "#d8b877"
LIGHT = "#f4e7c6"
TEAL = "#73b8ad"
PALETTE = {
    "ink": INK, "deep_teal": "#24434b", "teal": TEAL,
    "antique_gold": GOLD, "paper": "#e9d8ae", "vermilion": "#bc6552",
}
DEFS = """
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
 <stop stop-color="#f1dfac"/><stop offset=".45" stop-color="#cba260"/>
 <stop offset="1" stop-color="#80613b"/>
</linearGradient>
<linearGradient id="goldlight" x1="0" y1="0" x2=".8" y2="1">
 <stop stop-color="#fff0bc"/><stop offset=".5" stop-color="#dfba6c"/>
 <stop offset="1" stop-color="#ac8044"/>
</linearGradient>
<linearGradient id="teal" x1="0" y1="0" x2="1" y2="1">
 <stop stop-color="#9ad0ba"/><stop offset=".45" stop-color="#4d9185"/>
 <stop offset="1" stop-color="#244750"/>
</linearGradient>
<linearGradient id="darkteal" x1="0" y1="0" x2="1" y2="1">
 <stop stop-color="#608b88"/><stop offset=".3" stop-color="#355b61"/>
 <stop offset="1" stop-color="#172d39"/>
</linearGradient>
<linearGradient id="steel" x1="0" y1="0" x2="1" y2=".8">
 <stop stop-color="#f1efdf"/><stop offset=".35" stop-color="#c4d2cb"/>
 <stop offset=".6" stop-color="#7c969b"/><stop offset="1" stop-color="#3d5968"/>
</linearGradient>
<linearGradient id="paper" x1="0" y1="0" x2=".8" y2="1">
 <stop stop-color="#f1e4c7"/><stop offset=".65" stop-color="#d4c299"/>
 <stop offset="1" stop-color="#aa9168"/>
</linearGradient>
<linearGradient id="red" x1="0" y1="0" x2="1" y2="1">
 <stop stop-color="#dc9a74"/><stop offset=".35" stop-color="#b96551"/>
 <stop offset="1" stop-color="#6d3b3b"/>
</linearGradient>
<linearGradient id="clay" x1="0" y1="0" x2="0" y2="1">
 <stop stop-color="#c29771"/><stop offset=".5" stop-color="#9c7058"/>
 <stop offset="1" stop-color="#58423b"/>
</linearGradient>
<linearGradient id="glass" x1="0" y1="0" x2="1" y2=".4">
 <stop stop-color="#96b797"/><stop offset=".2" stop-color="#487c69"/>
 <stop offset=".65" stop-color="#315b4f"/><stop offset="1" stop-color="#192f37"/>
</linearGradient>
<radialGradient id="lens" cx=".38" cy=".3" r=".7">
 <stop stop-color="#f2f5e2"/><stop offset=".3" stop-color="#bde4d4"/>
 <stop offset=".72" stop-color="#669a9d"/><stop offset="1" stop-color="#304d5c"/>
</radialGradient>
"""


def tag(name: str, **attrs: object) -> str:
    return "<" + name + " " + " ".join(
        f'{key.replace("_", "-")}="{value}"' for key, value in attrs.items()
    ) + "/>"


def path(d: str, fill: str = "none", stroke: str = INK, sw: float = 2,
         **attrs: object) -> str:
    return tag("path", d=d, fill=fill, stroke=stroke, stroke_width=sw, **attrs)


def rect(x: float, y: float, w: float, h: float, fill: str,
         rx: float = 0, stroke: str = INK, sw: float = 2, **attrs: object) -> str:
    return tag("rect", x=x, y=y, width=w, height=h, rx=rx,
               fill=fill, stroke=stroke, stroke_width=sw, **attrs)


def ellipse(x: float, y: float, rx: float, ry: float, fill: str,
            stroke: str = INK, sw: float = 2, **attrs: object) -> str:
    return tag("ellipse", cx=x, cy=y, rx=rx, ry=ry,
               fill=fill, stroke=stroke, stroke_width=sw, **attrs)


def circle(x: float, y: float, r: float, fill: str,
           stroke: str = INK, sw: float = 2, **attrs: object) -> str:
    return ellipse(x, y, r, r, fill, stroke, sw, **attrs)


def group(body: str, transform: str = "", **attrs: object) -> str:
    properties = " ".join(f'{key.replace("_", "-")}="{value}"' for key, value in attrs.items())
    return f'<g transform="{transform}" {properties}>{body}</g>'


def line(d: str, color: str = GOLD, sw: float = 2.5, **attrs: object) -> str:
    return path(d, "none", color, sw, **attrs)


def shadow(x: float = 128, y: float = 228, rx: float = 85) -> str:
    return ellipse(x, y, rx, 8, "#07121c", "none", opacity=".26")


def star(x: float, y: float, size: float, color: str = GOLD) -> str:
    return path(f"M{x} {y-size} Q{x+size*.15} {y-size*.15} {x+size} {y} "
                f"Q{x+size*.15} {y+size*.15} {x} {y+size} "
                f"Q{x-size*.15} {y+size*.15} {x-size} {y} "
                f"Q{x-size*.15} {y-size*.15} {x} {y-size}Z", color, "none")


def item_corn() -> str:
    cob = "M128 28 C110 31 91 61 92 111 C93 154 106 187 128 208 C150 187 164 151 165 108 C167 62 146 31 128 28Z"
    body = '<defs><clipPath id="corn-clip">' + path(cob) + '</clipPath></defs>'
    body += path("M120 207 C88 186 61 164 61 114 C69 128 79 135 91 137 C84 109 84 94 88 79 C115 111 131 159 129 206Z", "url(#darkteal)")
    body += path(cob, "url(#gold)", "#4d563d", 2.2)
    kernels = ""
    for row in range(15):
        y = 32 + row * 10.4
        for col in range(7):
            x = 91 + col * 11.3 + (1.2 if row % 2 else 0)
            kernels += rect(round(x, 2), round(y, 2), 10.3, 9.7,
                            "url(#goldlight)", 3.7, "#ad8547", .9)
            kernels += line(f"M{x+2:.2f} {y+3:.2f} l4 -1", "#fff0bc", .9, opacity=".75")
    body += group(kernels, clip_path="url(#corn-clip)")
    body += path("M126 211 C91 194 66 166 67 131 C91 140 110 161 126 196 C135 170 160 137 188 122 C184 165 155 198 134 213Z", "url(#teal)")
    body += path("M128 213 C116 183 109 158 112 132 C132 148 143 171 142 193 C158 166 178 151 193 145 C178 181 160 200 133 216Z", "url(#darkteal)")
    body += line("M70 137 C82 158 105 181 128 211 M185 130 C171 160 149 190 132 212", "#9cc9a5", 1.7)
    body += line("M116 145 C123 173 128 192 130 208", "#a2bb8c", 1.4)
    body += path("M126 208 L134 208 L141 229 Q135 234 130 229Z", "url(#gold)")
    body = group(body, "rotate(19 128 128)")
    body += group(ellipse(184, 215, 10, 7, "url(#goldlight)", "#98763f", 1.4)
                  + line("M181 212 L187 214", LIGHT, 1.1), "rotate(-19 184 215)")
    body += group(ellipse(207, 206, 8, 6, "url(#goldlight)", "#98763f", 1.4), "rotate(21 207 206)")
    body += ellipse(207, 223, 9, 6, "url(#gold)", "#98763f", 1.4)
    return shadow(129, 235, 91) + body


def item_antibiotic() -> str:
    manual = rect(86, 39, 104, 123, "url(#paper)", 5)
    manual += rect(81, 33, 104, 123, "url(#darkteal)", 5)
    manual += path("M91 35 V154", "none", "#8bac9c", 2)
    manual += rect(111, 58, 45, 54, "url(#paper)", 3, "#7a967e", 1.2)
    manual += path("M128 69 H139 V82 H151 V92 H139 V105 H128 V92 H116 V82 H128Z", "#5e8c80", "none")
    manual += line("M104 130 H166 M104 136 H146", "#84a597", 1.3)
    body = shadow() + group(manual, "rotate(12 133 96)")
    bottle = path("M51 95 L92 95 V108 Q105 117 105 130 V205 Q105 219 92 221 H49 Q35 220 35 206 V131 Q35 116 49 109Z", "url(#gold)")
    bottle += path("M43 135 Q47 122 51 123 V209", "none", "#f3d8a2", 3, opacity=".55")
    bottle += rect(45, 82, 51, 24, "url(#goldlight)", 5)
    for x in range(50, 95, 6):
        bottle += line(f"M{x} 87 V101", "#836e47", 1.4)
    bottle += rect(40, 144, 60, 49, "url(#paper)", 3, "#c4ad7f", 1)
    bottle += path("M64 152 H76 V162 H86 V174 H76 V184 H64 V174 H54 V162 H64Z", "#467c78", "none")
    bottle += line("M49 207 Q67 214 93 206", "#735439", 2)
    body += group(bottle, "rotate(-8 71 161)")
    foil = rect(127, 113, 79, 113, "url(#steel)", 10)
    foil += rect(132, 118, 69, 103, "none", 7, "#d7e3d5", 1)
    for row in range(3):
        for col in range(2):
            x, y = 138 + col * 32, 126 + row * 31
            foil += rect(x, y, 22, 28, "#58717b", 11, "#e4e8db", 1)
            foil += rect(x+3, y+2, 16, 24, "url(#paper)", 8, "#70898b", .8)
            foil += path(f"M{x+3} {y+14} H{x+19} V{y+18} Q{x+19} {y+26} {x+11} {y+26} Q{x+3} {y+26} {x+3} {y+18}Z", "#6bada3", "none")
            foil += line(f"M{x+7} {y+7} V{y+12}", "#f8f4df", 1.8)
    return body + group(foil, "rotate(15 166 169)")


def item_flashlight() -> str:
    body = shadow()
    light = path("M105 88 H151 L157 196 Q156 215 128 220 Q101 214 100 197Z", "url(#darkteal)", INK, 2.8)
    light += rect(104, 131, 49, 59, "#20343e", 7, "#557c7b", 1.6)
    for x in range(111, 151, 7):
        light += line(f"M{x} 139 V182", "#617f7c", 1.6)
    light += ellipse(129, 201, 27, 9, "#263f49", "#799089", 1.6)
    light += path("M99 78 L96 91 Q125 105 157 92 L160 78Z", "url(#steel)")
    light += ellipse(128, 77, 36, 23, "url(#gold)", INK, 2.8)
    light += ellipse(128, 73, 31, 20, "#2b4652", "#dae0cd", 2)
    light += ellipse(128, 71, 24, 15, "url(#lens)", "#91b9b6", 1.8)
    light += ellipse(125, 67, 13, 6, "#f2f4dc", "none", opacity=".55")
    light += line("M111 90 Q126 96 147 90", "#dfd9bb", 1.2)
    light += rect(116, 109, 25, 14, "url(#red)", 6, "#6d534b", 1.4)
    light += line("M122 113 H134", "#e8b59b", 1.1)
    light += circle(154, 151, 9, "url(#gold)")
    light += path("M154 147 H185 Q190 147 190 153 V171 H180 V157 H154Z", "url(#steel)", INK, 2.4)
    light += rect(177, 164, 17, 26, "url(#darkteal)", 7)
    light += line("M182 170 V182", "#91aaa0", 1.5)
    light += path("M105 210 Q90 222 94 229 Q101 238 110 224", "none", "#5e817b", 3)
    return body + group(light, "rotate(32 128 136)")


def item_calculator() -> str:
    body = shadow()
    calc = rect(57, 31, 143, 193, "#162b37", 17, INK, 3)
    calc += rect(54, 27, 143, 193, "url(#darkteal)", 17, "#6d9690", 2)
    calc += path("M61 49 Q61 34 76 34 H176", "none", "#a0b7a1", 1.8)
    calc += rect(74, 43, 104, 18, "#1d2930", 2, "#ae9f75", 1.6)
    for x in range(78, 176, 14):
        calc += rect(x, 46, 10, 12, "#565548", 0, "#a3966f", .6)
    calc += rect(70, 72, 112, 40, "#162c36", 5, "#6e8d87", 1.8)
    calc += rect(76, 78, 100, 27, "#a2b9a1", 3, "#b5c8ab", 1)
    calc += path("M78 79 H162 L134 104 H78Z", "#d2ddba", "none", opacity=".24")
    for row in range(4):
        for col in range(4):
            if col == 3 and row == 3:
                continue
            x, y = 72 + col * 27, 125 + row * 21
            fill = "url(#paper)" if col < 3 else "url(#gold)"
            if row == 0 and col == 0:
                fill = "url(#red)"
            height = 36 if (col, row) == (3, 2) else 15
            calc += rect(x, y+2, 20, height, "#172d35", 4, "none")
            calc += rect(x, y, 20, height, fill, 4, "#45585a", 1.3)
            calc += line(f"M{x+5} {y+4} H{x+14}", "#ffefcd", 1.1, opacity=".65")
    calc += line("M76 208 H173", "#7a9690", 1.1)
    return body + group(calc, "rotate(-12 128 128)")


def item_glue() -> str:
    body = shadow()
    knife = path("M154 141 L152 89 Q153 55 170 24 Q183 42 181 75 L177 146Z", "url(#steel)", INK, 2.7)
    knife += path("M170 29 Q173 78 168 133 L176 143 L180 75 Q183 46 170 29Z", "#d9e2d3", "none")
    knife += line("M158 111 L165 58", "#f0ead7", 1.6)
    knife += rect(159, 92, 5, 25, "#4d6872", 2, "#a8b8b4", .7)
    knife += rect(145, 134, 36, 96, "#b1bbae", 18, INK, 2.6)
    knife += rect(148, 139, 29, 87, "url(#red)", 14, "#ce9d76", 1.4)
    knife += line("M153 158 V207", "#e5a681", 2)
    knife += line("M173 160 V207", "#693b3b", 1.7)
    for y in (150, 214):
        knife += circle(163, y, 4, "url(#steel)", "#594e43", 1.2)
        knife += line(f"M161 {y} H165", "#455b63", .9)
    knife += ellipse(163, 229, 6, 4, "none", "#90a7a3", 2)
    body += group(knife, "rotate(30 163 138)")
    glue = path("M56 109 L92 109 L104 132 V209 Q103 218 94 220 H53 Q43 219 43 209 V132Z", "url(#paper)", INK, 2.6)
    glue += path("M62 78 L66 45 Q75 39 82 45 L88 78 V111 H62Z", "url(#red)", INK, 2.2)
    glue += line("M69 50 L67 98", "#ecc39d", 1.8)
    glue += rect(57, 102, 35, 12, "url(#gold)", 3, "#927c5a", 1.3)
    glue += path("M50 137 Q62 133 97 137 V196 Q77 200 50 195Z", "url(#darkteal)", "#537b78", 1.2)
    glue += line("M53 148 V184", "#b3d4c1", 1.6)
    glue += path("M62 161 L71 152 Q76 148 81 153 L89 161 M60 177 L69 184 Q75 189 81 183 L89 176", "none", "#d8c28c", 3.3)
    glue += line("M62 207 H88", "#b7a17d", 1.2)
    return body + group(glue, "rotate(-8 74 150)")


def item_lighter() -> str:
    body = shadow()
    lighter = rect(48, 112, 86, 109, "url(#gold)", 13, INK, 2.6)
    lighter += rect(54, 119, 73, 92, "none", 8, "#e5ce91", 1.5)
    lighter += path("M62 127 V196", "none", "#fff0bc", 3, opacity=".6")
    lighter += path("M121 131 V198 Q119 211 107 213", "none", "#78613f", 2)
    lighter += line("M54 202 Q87 208 124 202", "#816b48", 1.2)
    lighter += rect(52, 100, 8, 17, "#697e7c", 3, "#dfddbf", 1.2)
    lighter += rect(74, 75, 42, 42, "url(#steel)", 4, INK, 2)
    lighter += path("M77 84 H111 M80 111 H109", "none", "#dce1cc", 1.4)
    for x in (82, 95, 108):
        for y in (89, 101):
            lighter += circle(x, y, 2.3, "#344b55", "none")
    lighter += rect(62, 89, 12, 22, "url(#gold)", 5, "#475e60", 1.3)
    for y in range(93, 109, 4):
        lighter += line(f"M64 {y} H71", "#6b6247", .8)
    lighter += path("M92 74 Q81 60 95 39 Q98 52 103 59 Q110 69 100 76Z", "url(#goldlight)", "#d7af6c", 1.2)
    lighter += path("M94 73 Q90 64 96 57 Q102 66 100 73Z", "#8ac8bd", "none")
    lid = rect(49, 57, 86, 46, "url(#gold)", 10, INK, 2.6)
    lid += rect(55, 63, 74, 34, "none", 6, "#e7d095", 1.4)
    lid += line("M64 69 H118", "#f1e5b4", 2)
    lighter += group(lid, "rotate(-24 53 105)")
    body += group(lighter, "rotate(-7 90 148)")
    oil = path("M159 148 H192 L202 160 V208 Q201 219 191 220 H158 Q147 218 147 208 V163Z", "url(#glass)", INK, 2.6)
    oil += rect(153, 132, 44, 24, "url(#gold)", 5, "#53685a", 1.8)
    for x in range(159, 196, 6):
        oil += line(f"M{x} 137 V151", "#6c7250", 1.1)
    oil += path("M154 171 V208 M198 172 V205", "none", "#a0c4ab", 2, opacity=".6")
    oil += rect(157, 171, 35, 35, "url(#paper)", 4, "#b4bd8f", 1.3)
    oil += path("M165 193 Q165 178 184 179 Q186 196 165 197 M166 196 L180 183", "url(#teal)", "#557e65", 1.3)
    oil += line("M156 213 H190", "#799984", 1.3)
    return body + group(oil, "rotate(9 175 181)")


def item_book() -> str:
    body = shadow()
    book = rect(44, 80, 121, 139, "#294b52", 5, INK, 2.6)
    book += path("M48 86 H159 V210 H48 Q37 207 39 198 V93 Q39 87 48 86Z", "url(#paper)")
    for y in range(192, 211, 4):
        book += line(f"M49 {y} H155", "#b3a17d", .9)
    book += rect(39, 74, 121, 128, "url(#darkteal)", 5, "#7b9a8b", 1.8)
    book += line("M56 77 V199", "#223b46", 2)
    book += rect(79, 91, 34, 60, "url(#paper)", 2, "#789589", 1.2)
    book += rect(83, 95, 26, 52, "none", 1, "#ad9e79", .9)
    for y in (91, 118, 145, 176):
        book += path(f"M41 {y} Q49 {y-4} 58 {y} M42 {y+4} Q49 {y+7} 57 {y+3}", "none", "#c6bc91", 1.6)
    book += line("M67 182 Q91 186 116 181 M127 80 V91", "#6b9990", 1.2)
    body += group(book, "rotate(-13 101 147)")
    scale = path("M96 50 L220 63", "none", "#c7ad6b", 6)
    scale += line("M96 48 L220 61", "#f0db9c", 1.4)
    scale += path("M125 53 Q119 30 130 30 Q143 31 137 53", "none", "#708e87", 2.6)
    for x in range(145, 204, 10):
        y = 50 + (x-96) * .105
        scale += line(f"M{x} {y-1:.2f} l-1 5", "#64583d", 1)
    scale += rect(154, 52, 11, 18, "url(#gold)", 2, "#6c6245", 1.2)
    scale += path("M151 67 L169 69 L172 84 L150 82Z", "url(#gold)", INK, 1.8)
    scale += line("M211 66 V112 M211 111 L187 156 M211 111 L234 156", "#93aaa0", 1.6)
    scale += ellipse(210, 158, 29, 9, "#36545a", "#d9c188", 1.8)
    scale += path("M181 158 Q189 180 210 182 Q234 180 239 158 Q211 172 181 158Z", "url(#gold)", INK, 2)
    scale += line("M192 172 Q210 180 227 173", "#f2d9a0", 1.1)
    return body + scale


def item_bowl() -> str:
    body = shadow(128, 219, 87)
    body += ellipse(128, 206, 41, 10, "#5e493b", "#a08663", 1.8)
    body += path("M35 106 Q39 158 73 190 Q125 223 180 190 Q216 162 222 105Z", "url(#clay)", INK, 2.8)
    body += path("M47 123 Q60 166 88 182", "none", "#dec19a", 3, opacity=".45")
    body += path("M208 132 Q190 174 168 186", "none", "#55443c", 4, opacity=".6")
    body += path("M35 106 C41 75 152 67 181 82 L184 95 L194 91 L199 85 Q221 92 222 105 C220 137 40 142 35 106Z", "url(#paper)", INK, 2.4)
    body += path("M44 105 C52 83 143 78 176 87 L180 101 L193 99 L200 93 Q214 99 212 106 C208 127 51 131 44 105Z", "#4b4740", "#8c8065", 1.4)
    body += ellipse(128, 108, 69, 14, "#5c5346", "none")
    body += path("M45 108 Q65 130 128 131 Q198 129 213 109", "none", "#4b6f6c", 5)
    body += path("M54 116 Q124 142 201 117", "none", "#b7b28c", 1.8)
    body += path("M184 96 L177 120 L185 138 L175 152 M185 138 L198 143", "none", "#58453b", 1.5)
    for x, y, length in ((71,151,8),(88,173,10),(116,193,12),(157,178,8),(140,156,6),(98,144,7),(178,162,6),(114,181,4)):
        body += line(f"M{x} {y} l{length} 2", "#d2ae84", 1.2, opacity=".56")
    return body


def icon_physique() -> str:
    body = path("M40 173 L73 135 Q88 144 109 141 Q119 123 135 118 L143 96 L125 81 Q117 71 122 58 L128 41 Q131 34 141 38 L177 54 Q183 58 182 69 L177 96 Q176 106 167 111 L166 143 Q207 144 213 173 Q214 199 181 208 H110 Q94 207 78 199 L61 216Z", "url(#gold)", INK, 5)
    body += path("M37 172 L70 145 L92 199 L60 219Z", "url(#teal)", INK, 5)
    body += line("M112 146 Q134 132 151 149 Q165 164 152 180 M163 149 Q184 150 192 164 M132 55 L158 68 L156 87", "#f1d9a2", 5)
    body += line("M145 96 L166 105 M113 194 H178", "#8e7047", 4)
    return body


def coin(x: float, y: float, r: float, name: str) -> str:
    half = r * .22
    mask = f'<defs><mask id="{name}"><rect width="256" height="256" fill="#ffffff"/>'
    mask += rect(x-half, y-half, 2*half, 2*half, "#000000", 1, "none") + '</mask></defs>'
    body = circle(x, y, r, "url(#gold)", INK, 4)
    body += circle(x, y, r-8, "none", "#f4d9a0", 3)
    body += rect(x-half-3, y-half-3, 2*half+6, 2*half+6, "none", 2, "#987444", 3)
    body += line(f"M{x-r*.65} {y-r*.28} Q{x-r*.45} {y-r*.7} {x-r*.14} {y-r*.74}", "#fff0c1", 3)
    return mask + group(body, mask=f"url(#{name})")


def icon_wealth() -> str:
    return (path("M76 64 Q132 22 180 67 L189 144", "none", "#5e9690", 9)
            + coin(86, 100, 51, "coin-back") + coin(150, 159, 66, "coin-front"))


def icon_intelligence() -> str:
    body = path("M28 85 Q78 65 126 91 Q174 65 226 85 V196 Q174 181 126 208 Q77 182 28 196Z", "url(#teal)", INK, 5)
    body += path("M38 74 Q82 58 126 85 V193 Q84 170 38 183Z", "url(#paper)", INK, 3)
    body += path("M126 85 Q171 57 217 74 V183 Q170 171 126 193Z", "url(#paper)", INK, 3)
    body += line("M126 91 V188 M51 100 Q76 94 101 105 M51 125 Q76 119 101 130 M151 119 Q173 109 202 114", "#9e8d66", 3.5)
    brush = path("M168 40 L182 46 L128 162 L115 168 L116 151Z", "url(#gold)", INK, 3)
    brush += path("M117 150 Q101 152 101 180 Q111 172 123 165Z", "#294e58", "#8eb8ae", 2)
    brush += line("M171 49 L129 142", LIGHT, 2)
    return body + group(brush, "rotate(9 152 107)")


def icon_prestige() -> str:
    body = line("M56 112 Q128 49 200 112 M60 164 Q128 209 196 164", "#628f88", 6)
    body += circle(57, 112, 24, "url(#teal)", INK, 4)
    body += circle(199, 112, 24, "url(#teal)", INK, 4)
    body += path("M20 180 Q20 146 57 146 Q91 146 94 180Z", "url(#darkteal)", "#65988d", 3)
    body += path("M163 180 Q164 146 199 146 Q235 146 236 180Z", "url(#darkteal)", "#65988d", 3)
    body += circle(128, 73, 32, "url(#goldlight)", INK, 4)
    body += path("M70 192 Q72 127 128 125 Q184 127 186 192 Q128 217 70 192Z", "url(#gold)", INK, 5)
    body += path("M103 136 L128 162 L153 136 M128 162 V197", "none", "#f0d8a0", 4)
    return body


def icon_luck() -> str:
    body = path("M128 82 C80 21 38 64 86 103 C24 142 78 190 118 145 C166 197 215 151 170 114 C224 66 175 26 139 75", "none", "#24434b", 19)
    body += path("M128 82 C80 21 38 64 86 103 C24 142 78 190 118 145 C166 197 215 151 170 114 C224 66 175 26 139 75", "none", "#6eb2a3", 11)
    body += path("M128 68 L169 109 L128 151 L87 109Z", "url(#gold)", INK, 4)
    body += path("M128 89 L148 109 L128 130 L108 109Z", "none", "#f3dfac", 6)
    body += line("M118 153 L106 203 M138 153 L150 203", "#c69c5e", 7)
    body += path("M99 196 L116 199 L116 223 L96 220Z M141 199 L158 196 L161 220 L141 223Z", "url(#teal)", INK, 3)
    body += star(204, 51, 14, "#dfc17e")
    return body


def icon_farming() -> str:
    body = circle(187, 61, 24, "url(#goldlight)", INK, 3)
    body += line("M47 195 Q126 165 212 195 M41 219 Q127 190 218 219", "#b69762", 8)
    body += path("M129 183 Q125 129 132 76", "none", "#99c8a5", 9)
    body += path("M126 140 Q57 139 48 82 Q107 77 126 140Z", "url(#teal)", INK, 4)
    body += path("M130 110 Q138 52 191 41 Q197 104 130 110Z", "url(#teal)", INK, 4)
    body += line("M62 94 L119 132 M178 59 L137 100", "#bee0af", 3)
    return body


def icon_health() -> str:
    body = path("M166 107 L203 52 Q208 43 199 39 L186 35 Q178 33 173 43 L143 104Z", "url(#gold)", INK, 4)
    body += path("M44 119 Q47 188 87 204 H172 Q206 185 212 119Z", "url(#darkteal)", "#7fa99b", 4)
    body += ellipse(128, 119, 86, 23, "#2c4d54", "#d6bb7d", 6)
    body += path("M91 109 Q55 83 76 47 Q119 58 124 108Z", "url(#teal)", INK, 3)
    body += line("M83 60 L113 108 M65 139 Q70 170 91 182", "#bad7b1", 4)
    body += rect(85, 201, 88, 15, "url(#gold)", 6, INK, 3)
    body += path("M150 140 H170 V153 H183 V173 H170 V186 H150 V173 H137 V153 H150Z", "#dfc994", "none")
    return body


def gear(cx: float, cy: float, radius: float) -> str:
    points = []
    for step in range(40):
        a = math.pi * step / 20 - math.pi / 20
        r = radius if step % 4 in (0, 1) else radius * .78
        points.append(f"{cx+math.cos(a)*r:.2f},{cy+math.sin(a)*r:.2f}")
    return tag("polygon", points=" ".join(points), fill="url(#darkteal)", stroke="#729d91", stroke_width=4)


def icon_workshop() -> str:
    body = gear(140, 142, 84)
    body += circle(140, 142, 36, "none", "#8eb8aa", 8)
    hammer = path("M102 84 L119 98 L70 216 Q66 225 56 220 L49 216 Q43 212 48 201Z", "url(#gold)", INK, 4)
    hammer += path("M66 58 L93 29 L157 88 L132 118 L111 102 L117 94 L99 77 L91 85Z", "url(#steel)", INK, 5)
    hammer += line("M82 57 L131 101 M61 205 L105 104", "#f3e7bc", 3)
    return body + hammer


def icon_night() -> str:
    body = path("M204 37 Q171 55 179 91 Q186 120 213 126 Q164 146 144 105 Q122 62 164 35 Q182 27 204 37Z", "url(#teal)", INK, 4)
    body += star(70, 52, 10, GOLD)
    body += line("M122 31 V60", "#ba9b62", 6)
    body += path("M91 65 L77 84 H167 L153 65Z", "url(#gold)", INK, 4)
    body += path("M78 84 Q64 135 82 181 H161 Q179 134 167 84Z", "url(#goldlight)", INK, 4)
    body += line("M96 91 Q85 134 99 176 M147 91 Q158 134 145 176 M121 91 V176", "#9b7a46", 5)
    body += rect(78, 177, 88, 15, "url(#darkteal)", 5, "#97ada0", 3)
    body += path("M115 193 H129 L135 224 L109 224Z", "url(#red)", INK, 3)
    return body


def icon_market() -> str:
    body = path("M50 92 V213 M206 92 V213", "none", "#a58b5d", 10)
    body += rect(40, 185, 176, 27, "url(#gold)", 4, INK, 4)
    body += path("M63 42 H190 L222 91 H31Z", "url(#teal)", INK, 5)
    body += path("M31 91 H222 V104 Q208 126 190 105 Q173 126 157 105 Q141 126 124 105 Q108 126 91 105 Q75 126 59 105 Q44 125 31 104Z", "url(#gold)", INK, 4)
    body += line("M82 49 L62 85 M116 48 L108 85 M151 48 L157 85 M182 49 L201 85", "#a4c5ad", 4)
    body += rect(65, 146, 48, 39, "url(#darkteal)", 4, "#8cb4a1", 3)
    body += line("M71 151 L107 178 M106 152 L72 177", "#a6b393", 3)
    for y in (179, 166, 153):
        body += ellipse(166, y, 27, 8, "url(#goldlight)", "#77623f", 2)
    return body


def icon_war() -> str:
    body = line("M58 213 L191 59 M198 213 L65 59", "#b49b6a", 9)
    body += path("M183 64 L196 27 L216 40 L196 72Z M71 63 L58 27 L38 40 L57 72Z", "url(#steel)", INK, 4)
    body += path("M128 62 Q157 83 195 85 L186 148 Q171 191 128 220 Q84 191 70 148 L61 85 Q100 83 128 62Z", "url(#darkteal)", "#bca268", 6)
    body += path("M128 78 Q152 93 179 97 L172 143 Q160 176 128 199 Q97 176 84 143 L77 97 Q104 93 128 78Z", "none", "#5e8b83", 3)
    body += path("M128 84 V191 M96 128 H160", "none", "#d7ba7b", 9)
    body += circle(128, 129, 17, "url(#gold)", INK, 3)
    return body


def scroll_shape() -> str:
    body = path("M57 56 H195 V196 H57Z", "url(#paper)", INK, 4)
    body += path("M56 55 Q30 55 32 77 V183 Q31 203 55 204 Q80 205 78 184 V78 Q77 57 56 55Z", "url(#gold)", INK, 4)
    body += path("M195 55 Q173 56 176 78 V183 Q173 204 197 204 Q221 204 221 182 V78 Q221 55 195 55Z", "url(#gold)", INK, 4)
    body += ellipse(55, 64, 20, 11, "url(#paper)", "#b99d69", 3)
    body += ellipse(197, 64, 20, 11, "url(#paper)", "#b99d69", 3)
    body += line("M46 84 V183 M188 84 V184", "#ead5a2", 3)
    return body


def icon_generic() -> str:
    body = scroll_shape()
    body += path("M127 83 L156 126 L127 170 L99 126Z", "url(#teal)", "#577b6e", 3)
    body += path("M127 96 V155 M110 126 H144", "none", "#cce0b7", 3)
    body += circle(127, 126, 7, "url(#gold)", "#54786d", 2)
    return body


def shield_shape(fill: str, edge: str = GOLD) -> str:
    return path("M128 30 Q168 57 215 63 L204 137 Q191 191 128 228 Q65 191 52 137 L41 63 Q88 57 128 30Z", fill, edge, 7)


def icon_risk_safe() -> str:
    body = shield_shape("url(#darkteal)", "#82c2b1")
    body += path("M127 48 Q160 70 195 77", "none", "#c2d6b6", 3)
    body += path("M81 125 L113 158 L178 91", "none", "#e5d6a0", 17)
    return body


def icon_risk_normal() -> str:
    body = path("M114 42 Q128 20 142 42 L228 196 Q239 216 215 219 H41 Q17 216 28 196Z", "url(#gold)", INK, 6)
    body += path("M125 54 L49 195 H207", "none", "#f4dba4", 4)
    body += path("M117 88 H139 L136 149 H120Z", "#3b4c4e", "none")
    body += circle(128, 180, 12, "#34494b", "none")
    return body


def icon_risk_high() -> str:
    body = shield_shape("url(#red)", "#d39a71")
    body += path("M129 69 Q151 96 146 115 Q163 106 166 97 Q196 147 168 178 Q153 198 127 199 Q84 198 80 163 Q75 137 95 111 Q98 132 111 138 Q102 100 129 69Z", "url(#goldlight)", "#753f3c", 3)
    body += path("M128 139 Q152 158 144 175 Q139 187 128 189 Q111 187 110 174 Q109 159 128 139Z", "#b65e4a", "none")
    return body


def icon_career() -> str:
    body = path("M43 100 Q42 88 55 88 H201 Q214 88 213 100 L205 212 H51Z", "url(#darkteal)", "#96b5a4", 4)
    body += path("M91 88 V61 Q128 37 165 61 V88", "none", "#c8a86c", 12)
    body += path("M43 99 Q127 156 213 99 L211 143 Q129 189 46 143Z", "url(#teal)", INK, 4)
    body += rect(116, 130, 25, 34, "url(#gold)", 4, INK, 3)
    body += line("M63 176 V198 M194 175 V198", "#6f9c90", 3)
    return body


def icon_life() -> str:
    body = path("M129 108 Q119 161 127 202 L94 225 M128 195 L151 224 M126 207 L127 230", "none", "#b99a61", 11)
    body += path("M125 135 L87 100 M131 128 L172 88", "none", "#c9b273", 9)
    body += path("M81 121 Q44 116 49 86 Q33 55 68 43 Q80 15 111 34 Q141 15 158 42 Q198 26 207 65 Q235 82 213 111 Q204 137 168 124 Q146 147 126 128 Q102 147 81 121Z", "url(#teal)", INK, 5)
    body += path("M63 85 Q81 60 109 63 M140 69 Q173 51 191 72", "none", "#b6d6ad", 5)
    body += line("M131 145 V199", "#ecd09a", 3)
    return body


def icon_milestone() -> str:
    body = path("M88 53 L128 28 L168 53 L178 197 H78Z", "url(#steel)", INK, 5)
    body += path("M128 30 V195 H174 L164 55Z", "#3d6468", "none", opacity=".65")
    body += path("M78 197 H179 L203 218 H53Z", "url(#gold)", INK, 4)
    body += path("M128 65 L152 102 L128 139 L104 102Z", "url(#goldlight)", INK, 3)
    body += line("M101 165 H154 M89 53 V182", "#d3d5b9", 4)
    return body


def icon_anecdote() -> str:
    body = path("M43 47 H210 Q226 47 226 66 V154 Q226 172 207 172 H126 L82 210 L89 172 H43 Q26 172 26 153 V66 Q26 47 43 47Z", "url(#darkteal)", "#9cbba6", 5)
    body += path("M70 91 Q104 71 128 91 Q153 71 188 91 V145 Q155 126 128 146 Q102 127 70 145Z", "url(#paper)", INK, 3)
    body += line("M128 93 V141", "#b6a078", 3)
    body += star(181, 56, 21, GOLD)
    return body


def icon_next() -> str:
    body = path("M35 102 H143 L143 62 L226 128 L143 194 V154 H35Z", "url(#gold)", INK, 6)
    body += line("M47 113 H155 V89 L203 127", "#f1dfac", 5)
    body += line("M38 173 H90", "#55978e", 7)
    return body


def icon_manage_career() -> str:
    body = rect(42, 47, 133, 166, "url(#darkteal)", 10, "#8dbaaa", 5)
    body += line("M66 53 V206", "#c7b17b", 5)
    for y in (84, 113, 142, 171):
        body += line(f"M83 {y} H126", "#8aab98", 5)
    body += gear(177, 173, 50)
    body += circle(177, 173, 21, "url(#gold)", "#e3c993", 4)
    body += path("M182 70 L199 81 L151 148 L137 156 L141 139Z", "url(#goldlight)", INK, 3)
    return body


def icon_restart() -> str:
    body = path("M207 112 A82 82 0 1 0 197 180", "none", "#3e766f", 25)
    body += path("M202 105 A76 76 0 1 0 191 177", "none", "#d7b676", 14)
    body += path("M176 93 L221 86 L216 133Z", "url(#goldlight)", INK, 4)
    body += path("M129 167 V123 M129 144 Q91 142 87 111 Q121 104 129 144 M130 128 Q134 91 168 84 Q173 119 130 128Z", "url(#teal)", "#9bc3a9", 4)
    return body


def icon_summary() -> str:
    body = rect(73, 35, 126, 166, "url(#darkteal)", 7, "#7eaa9b", 4)
    body += path("M50 60 H157 L179 83 V218 H50Z", "url(#paper)", INK, 5)
    body += path("M156 60 V85 H179", "url(#gold)", "#977f56", 3)
    body += path("M72 100 H135 M72 122 H145 M72 144 H116", "none", "#708578", 6)
    body += path("M144 187 L132 226 L155 216 L176 228 L169 186Z", "url(#red)", INK, 3)
    body += circle(155, 179, 29, "url(#gold)", INK, 4)
    body += circle(155, 179, 18, "none", "#f0d6a0", 3)
    body += star(155, 179, 12, "#667e6d")
    return body


ITEMS = {
    "corn": (item_corn, "A corn ear with individually shaded kernels, teal husks and loose seed."),
    "antibiotic": (item_antibiotic, "An amber medicine bottle, capsule blister pack and prevention manual."),
    "flashlight": (item_flashlight, "A hand-cranked flashlight with folding generator handle and reflector."),
    "calculator": (item_calculator, "A solar calculator with a blank LCD, solar cells and raised keypad."),
    "glue": (item_glue, "A long-nozzle adhesive bottle and an open folding pocket knife."),
    "lighter": (item_lighter, "An open windproof lighter and a small green aromatic-oil bottle."),
    "book": (item_book, "A worn thread-bound primer with a small rod steelyard and hanging pan."),
    "bowl": (item_bowl, "A chipped earthenware begging bowl with a worn rim and pottery marks."),
}
ICONS = {
    "physique": (icon_physique, "A strong flexed arm with a teal cuff."),
    "wealth": (icon_wealth, "Two antique square-hole coins and a cord."),
    "intelligence": (icon_intelligence, "An open book and writing brush."),
    "prestige": (icon_prestige, "Three connected people, with a gold central figure."),
    "luck": (icon_luck, "An interwoven decorative cord knot and tassels."),
    "event-farming": (icon_farming, "A young crop over curved furrows with a small sun."),
    "event-health": (icon_health, "A leaf, pestle and medicine mortar."),
    "event-workshop": (icon_workshop, "A metal hammer in front of a teal gear."),
    "event-night": (icon_night, "A hanging lantern beside the moon."),
    "event-market": (icon_market, "A market stall, crate and stack of coins."),
    "event-war": (icon_war, "A shield and crossed spears, without battle or injury."),
    "event-generic": (icon_generic, "An unfurled scroll bearing a geometric direction motif."),
    "risk-safe": (icon_risk_safe, "A teal shield with a gold check mark."),
    "risk-normal": (icon_risk_normal, "A gold triangular caution pictogram."),
    "risk-high": (icon_risk_high, "A vermilion shield containing a flame pictogram."),
    "career": (icon_career, "A traditional work satchel with a gold clasp."),
    "life": (icon_life, "A rooted living tree."),
    "milestone": (icon_milestone, "A stone waymarker on a stepped plinth."),
    "anecdote": (icon_anecdote, "An open storybook inside a speech bubble."),
    "btn-next": (icon_next, "A clear forward arrow."),
    "btn-career": (icon_manage_career, "A working ledger, brush and gear."),
    "btn-restart": (icon_restart, "A circular restart arrow surrounding a seedling."),
    "btn-summary": (icon_summary, "A folded summary sheet and seal."),
}


def svg_document(body: str) -> str:
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" '
            'viewBox="0 0 256 256" data-codeart="original-ming-end">'
            f'<defs>{DEFS}</defs><g stroke-linecap="round" stroke-linejoin="round">'
            + body + '</g></svg>')


def stable_uuid(relative: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "original-ming-end-art/" + relative))


def write_json(filename: Path, content: dict) -> None:
    filename.write_text(json.dumps(content, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def sprite_meta(filename: Path, size: int) -> None:
    relative = filename.relative_to(ROOT).as_posix()
    meta_file = filename.with_suffix(filename.suffix + ".meta")
    identity = (json.loads(meta_file.read_text(encoding="utf-8"))["uuid"]
                if meta_file.exists() else stable_uuid(relative))
    texture_id, frame_id = "6c48a", "f9941"
    texture = {
        "importer": "texture", "uuid": identity + "@" + texture_id,
        "displayName": filename.stem, "id": texture_id, "name": "texture",
        "userData": {"wrapModeS": "clamp-to-edge", "wrapModeT": "clamp-to-edge",
                     "minfilter": "linear", "magfilter": "linear", "mipfilter": "none",
                     "anisotropy": 0, "isUuid": True,
                     "imageUuidOrDatabaseUri": identity, "visible": False},
        "ver": "1.0.22", "imported": True, "files": [".json"], "subMetas": {},
    }
    frame = {
        "importer": "sprite-frame", "uuid": identity + "@" + frame_id,
        "displayName": filename.stem, "id": frame_id, "name": "spriteFrame",
        "userData": {"trimType": "custom", "trimThreshold": 1, "rotated": False,
                     "offsetX": 0, "offsetY": 0, "trimX": 0, "trimY": 0,
                     "width": size, "height": size, "rawWidth": size, "rawHeight": size,
                     "borderTop": 0, "borderBottom": 0, "borderLeft": 0, "borderRight": 0,
                     "packable": True, "pixelsToUnit": 100, "pivotX": .5, "pivotY": .5,
                     "meshType": 0,
                     "vertices": {key: [] for key in ("rawPosition", "indexes", "uv", "nuv", "minPos", "maxPos")},
                     "isUuid": True, "imageUuidOrDatabaseUri": identity + "@" + texture_id,
                     "atlasUuid": ""},
        "ver": "1.0.12", "imported": True, "files": [".json"], "subMetas": {},
    }
    write_json(meta_file, {
        "ver": "1.0.27", "importer": "image", "imported": True, "uuid": identity,
        "files": [".json", ".png"], "subMetas": {texture_id: texture, frame_id: frame},
        "userData": {"type": "sprite-frame", "fixAlphaTransparencyArtifacts": True,
                     "hasAlpha": True, "redirect": identity + "@" + frame_id},
    })




def render_assets() -> dict[str, Image.Image]:
    rendered: dict[str, Image.Image] = {}
    source_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    renderer = "resvg-py " + importlib.metadata.version("resvg-py")
    pillow_version = importlib.metadata.version("Pillow")
    for folder_name, definitions, size in (("items", ITEMS, 512), ("icons", ICONS, 256)):
        folder = ART / folder_name
        folder.mkdir(parents=True, exist_ok=True)
        for name, (draw, description) in definitions.items():
            svg = svg_document(draw())
            data = resvg_py.svg_to_bytes(svg_string=svg, width=size*2, height=size*2,
                                        skip_system_fonts=True)
            image = Image.open(io.BytesIO(data)).convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
            # Keep alpha exactly zero outside the silhouette and remove invisible RGB.
            pixels = image.load()
            for y in range(size):
                for x in range(size):
                    if pixels[x, y][3] == 0:
                        pixels[x, y] = (0, 0, 0, 0)
            filename = folder / f"{name}.png"
            note = PngImagePlugin.PngInfo()
            note.add_text("Source", "Original code-drawn project artwork; tools/generate-ming-icon-art.py")
            note.add_text("Description", description)
            note.add_text("ArtSource", "code; original project artwork; placeholder=false; no image model")
            note.add_text("SourceSHA256", source_hash)
            note.add_text("Renderer", renderer + "; Pillow " + pillow_version)
            note.add_text("Palette", json.dumps(PALETTE, sort_keys=True))
            alpha = image.getchannel("A")
            note.add_text("VisibleBounds", json.dumps(alpha.getbbox()))
            note.add_text("TransparentPixels", str(alpha.histogram()[0]))
            image.save(filename, pnginfo=note, optimize=True)
            sprite_meta(filename, size)
            rendered[f"{folder_name}/{name}"] = image
    return rendered


def make_review(images: dict[str, Image.Image], filename: Path) -> None:
    # Review-only typography is Pillow's bundled font, never part of game assets.
    sheet = Image.new("RGB", (1440, 1420), "#101d2a")
    draw = ImageDraw.Draw(sheet)
    title_font = ImageFont.load_default(size=22)
    font = ImageFont.load_default(size=15)
    small_font = ImageFont.load_default(size=12)
    draw.text((22, 16), "MING-END  /  ORIGINAL OFFLINE OBJECT & ICON ART", fill=LIGHT, font=title_font)
    draw.text((22, 49), "Items: 512px originals shown at 236px. Transparent edges on dark + checker swatches.", fill="#8db2aa", font=font)
    for index, name in enumerate(ITEMS):
        x, y = 20 + index % 4 * 355, 81 + index // 4 * 293
        draw.rounded_rectangle((x, y, x+335, y+278), 12, fill="#172935", outline="#36555e", width=1)
        picture = images["items/" + name].resize((236, 236), Image.Resampling.LANCZOS)
        sheet.paste(picture, (x+4, y+2), picture)
        # A small light/checker background reveals accidental opaque rectangles.
        bx, by = x+245, y+112
        for cy in range(8):
            for cx in range(8):
                color = "#adbbb1" if (cx+cy) % 2 else "#d4d7bf"
                draw.rectangle((bx+cx*10, by+cy*10, bx+cx*10+9, by+cy*10+9), fill=color)
        thumb = images["items/" + name].resize((80, 80), Image.Resampling.LANCZOS)
        sheet.paste(thumb, (bx, by), thumb)
        draw.text((x+14, y+245), "items/" + name, fill=LIGHT, font=font)
    draw.text((22, 684), "Icons: 256px originals shown at 104px, with 32px dark and light readability samples.", fill="#8db2aa", font=font)
    for index, name in enumerate(ICONS):
        x, y = 20 + index % 6 * 237, 720 + index // 6 * 169
        draw.rounded_rectangle((x, y, x+220, y+153), 10, fill="#172935", outline="#36555e", width=1)
        picture = images["icons/" + name].resize((104, 104), Image.Resampling.LANCZOS)
        sheet.paste(picture, (x+4, y+4), picture)
        thumb = images["icons/" + name].resize((32, 32), Image.Resampling.LANCZOS)
        sheet.paste(thumb, (x+129, y+34), thumb)
        draw.rounded_rectangle((x+171, y+28, x+211, y+72), 4, fill="#d4d6be")
        sheet.paste(thumb, (x+175, y+34), thumb)
        draw.text((x+11, y+125), name, fill=LIGHT, font=font)
        draw.text((x+129, y+82), "32px", fill="#86a89f", font=small_font)
    filename.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(filename, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--review", type=Path, help="Optional labelled contact sheet outside the resource folders")
    args = parser.parse_args()
    images = render_assets()
    if args.review:
        make_review(images, args.review)
    print(json.dumps({"items": len(ITEMS), "item_dimensions": [512, 512],
                      "icons": len(ICONS), "icon_dimensions": [256, 256],
                      "root": ART.relative_to(ROOT).as_posix(),
                      "review": str(args.review) if args.review else None,
                      "source": "original offline SVG geometry, resvg-py 0.5.0 + Pillow"}, indent=2))


if __name__ == "__main__":
    main()
