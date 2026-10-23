# Trailer

The choggames.com trailer, built from scripts: 3D shots rendered in Blender (Cycles, headless, via the
`bpy` wheel), 2D cards and captions drawn on canvas pages in a headless browser, and an assembly step
that cuts, captions, mixes and encodes.

| Piece | File |
| --- | --- |
| Shared film kit (render setup, camera, Chog rig, planted-feet walk) | `film.py` |
| The lounge set (baked room, board, dice, buildings, cops) | `lounge.py` |
| Cards, chips and felts for the card tables | `tablekit.py` |
| Shots | `shot01_the_o.py` (cold open), `shot02_tour.py`, `shot03_monopoly.py`, `shot05_cards.py`, `shot06_poker.py`, `shot08_finale.py` |
| 2D pages | `card/title2d.html`, `card/endcard.html`, `card/captions.html`, `card/screens.html`, `card/nft.html` |
| Sound: music and recorded effects, with credits (`audio/README.md`); the old synthesised set | `audio/`, `sfx.py` |
| Cut, captions, mix, encode | `assemble.py` |
| Helpers | `render-canvas.mjs` (page → frames), `unpack-glb.mjs` (undo meshopt for Blender) |

Render a shot (from `tools/blender`, so `blib`/`props`/`table` import):

    TRAILER_OUT=<out> TRAILER_CACHE=<cache> <venv>/bin/python ../trailer/shot02_tour.py [--draft] [--stills 1,3.5] [--every 6]

Frames land in `<out>/frames/<shot>/`; a stopped render resumes where it left off. Board and card
textures are expected in `<out>/../tex/` and the page assets (fonts, `title-layout.json` from
`shot01_the_o.py --layout`, `chog-line.png`) in `<out>/../card/`.

Assemble (needs numpy and Pillow, e.g. the bpy venv):

    TRAILER_OUT=<out> TRAILER_MUSIC=<music.wav> FFMPEG=<ffmpeg> <venv>/bin/python assemble.py [--half]
