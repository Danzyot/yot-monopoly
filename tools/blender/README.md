# 3D asset pipeline (headless Blender)

Every model in `client/public/models` is built by a script here. Blender runs
headless through its Python module (`bpy`), so there is no `.blend` file to
keep in sync and no hand-editing: change the script, rebuild, commit the output.

```bash
tools/blender/run.sh table.py                 # the game table (all maps)
tools/blender/run.sh props.py                 # houses and hotels
tools/blender/run.sh characters.py            # the thirteen characters (~1.5 min)
tools/blender/run.sh characters.py --build chog  # just these characters (the others' files stay byte for byte)
tools/blender/run.sh outfits.py               # outfit items + picker thumbnails (~6 min)
tools/blender/run.sh outfits.py --sheet out.png --items cap,halo  # those items on the Chog, front + three-quarter, to check fit
tools/blender/run.sh chog_traits.py           # Chog Genesis trait parts: faces, eyes, mouths, hats, outfits, props (~1.5 min)
tools/blender/run.sh chog_traits.py --preview out.png --tokens 1,186,1517  # + a render per real token
tools/blender/run.sh chog_traits.py --preview out.png --tokens 352 --head --no-export  # head close-ups only, no export
tools/blender/run.sh chog_traits.py --preview out.png --tokens 3,90 --head --no-export --yaw 0,60  # + a three-quarter view (PREVIEW_HAIR=#00ff00: the mane in green, to spot it through a hat)
tools/blender/run.sh chog_traits.py --preview out.png --tokens 1076,1821 --head --no-export --eyes-style decal --skull-style sculpted  # another face version
tools/blender/run.sh cops.py                  # the cutscene cast: cops, patrol car, tow truck, trophy, podium (~15 s)
tools/blender/run.sh chog_roamer.py          # the home page's roaming Chog: its sprite sheet (~3 min); --pack-only re-packs the last renders
tools/blender/run.sh classic_room.py --draft  # Classic room, quick bake (~3 min)
tools/blender/run.sh classic_room.py          # Classic room, final bake (~40 min on 4 cores)
tools/blender/run.sh chog_room.py --preview   # Chog Poker lounge: Cycles renders of the game views, no bake
tools/blender/run.sh chog_room.py --draft     # Chog Poker lounge, quick bake
tools/blender/run.sh chog_room.py             # Chog Poker lounge, final bake (~30 min on 4 cores)
tools/blender/run.sh chog_env.py              # its 360° panorama (reflections)
tools/blender/run.sh skyline_set.py --preview # Metropolis roof: Cycles renders of the game views, no bake
tools/blender/run.sh skyline_set.py --draft   # Metropolis roof, quick bake
tools/blender/run.sh skyline_set.py           # Metropolis roof, final bake
tools/blender/run.sh skyline_env.py           # Metropolis roof's reflection panorama
tools/blender/run.sh speedway_set.py --draft  # Speedway track, quick bake (~4 min)
tools/blender/run.sh speedway_set.py --preview  # path-traced stills from the game cameras, no bake
tools/blender/run.sh speedway_set.py          # Speedway track, final bake (~1 h on 4 cores)
tools/blender/run.sh speedway_env.py          # its 360° panorama (reflections)
tools/blender/run.sh tptv_room.py --draft     # Takeprofit TV studio, quick bake (~5 min)
tools/blender/run.sh tptv_room.py --preview   # path-traced stills from the game cameras, no bake
tools/blender/run.sh tptv_room.py             # Takeprofit TV studio, final bake
tools/blender/run.sh tptv_env.py              # its 360° panorama (reflections)
```

The first run creates `tools/blender/.venv` with `bpy` 5.0 and Pillow
(needs Python 3.11; set `PYTHON=python3.11` if that isn't your default). Set
`BLENDER_VENV` to reuse a venv somewhere else.

Each script writes its files and records them in `manifest.json`, which is
turned into `client/src/three/assets.gen.ts`: the URLs there carry a content
hash, so browsers never keep a stale model after a rebuild.

## Files

| File | What |
|---|---|
| `blib.py` | Shared helpers: game-space coordinates (`V`), shape builders, materials, vertex-colour folding, lightmap unwrap + Cycles bake, GLB export, manifest |
| `tex.py` | Procedural textures drawn with numpy (planks, wallpaper, rug, night window, paintings) — nothing is downloaded |
| `table.py` | The round table; its finish is recoloured live from the room's table style |
| `props.py` | Houses and hotels; body and roof take the edition's colours live |
| `classic_room.py` | The Classic edition's room, light-baked |
| `chog_room.py` | The Chog edition's room on the Classic map: the Chog Poker lounge (velvet walls, bar, poker tables, slots and jackpot board, booths, neon), light-baked |
| `characters.py` | The thirteen playable characters → `characters/<id>.glb`, one file per character so a game downloads only the ones at its table, plus `characters/<id>-low.glb` (gltfpack-simplified to `LOW_RATIO`) for Low graphics; the manifest lists them by id under `characters` / `charactersLow`. One node per rig part (`<id>_Body`, `_Head`, `_HandL/R`, `_FootL/R`, `_LidL/R` eyelids hinged from their `hinge` extra, and the signature garments `_Top`/`_Chain`), material names `<id>:<key>` that the game swaps for each player's own materials; the client merges each figure into a few skinned meshes (`client/src/three/characters/merged.ts`). `.cache/models/characters.glb` keeps all of them uncompressed in one file for `outfits.py`. The Chog's mane is its own node, `chog_Hair_full`, with the cuts it wears under an outfit hat beside it (`chog_Hair_fringe|crown`, `MANES`; `outfitFit.json` `mane` says which hat takes which). `--preview out.png [--only a,b]` renders a close lineup |
| `chog_traits.py` | Chog Genesis trait parts → `characters/chog-traits.glb` (+ `-low`), the parts a holder's own Chog is assembled from at runtime: `chog_HeadBare` (the face, no eyes, mouth or mane), `chog_HeadSkull` (the bald Skull form), `chog_Hair_<trim>` (the mane, cut back under a hat so some spikes always show: `full`, `crown` round a crown, `cap` side and back spikes, `fringe` short spikes below a hat that comes down all round, `hood` spike tips round the face inside a hood; `wear.ts` HAT_MANE picks), `chog_Eyes_<id>` per eyes variant, `chog_LaserBeams` (and the Blue Laser head's `chog_BrowBeam`), `chog_Mouth_<id>` per mouth, and from `chog_wear.py` the hats `chog_Hat_<shape>`, outfits `chog_Wear_<shape>` (body space) and held props `chog_Prop_<id>` (right-hand space); ids from `shared/chogs/traits.ts` and `wear.ts`. `chog:<key>` materials, so the client merges them onto the base Chog (`client/src/three/characters/chogToken.ts`); hats and outfits are `chog:paint`, coloured per trait value from a texture the client paints (`chogPaint.ts`) through UVs laid out by `shared/chogs/paint-layout.json`. `--preview` renders real tokens (shapes in their ground colours), their looks resolved by `chog_look.ts` |
| `chog_draw.py` | Drawing on a surface for the trait parts: thin patches (filled shapes, bands, brush strokes) laid over the face or an eyeball at fixed heights, so outlines, pupils and glints are their own shapes in drawing order and both eyes read alike from any angle (no pupil or rim is the sliver left where two solids cross) |
| `chog_faces.py` | Versions of the token Chog's eyes (`refined`, `decal`, `bold`) and of the Skull face (`sculpted`, `painted`, `hybrid`) beside today's (`current`), for choosing between. `shared/chogs/face-style.json` picks which `chog_traits.py` builds (the game reads it too, for the Skulls' bone colours and the eye parts a value maps to); the node names are the same in every version, so switching is: edit it, rerun `chog_traits.py`. `--eyes-style` / `--skull-style` override it for one run (`--preview … --no-export` to look without exporting) |
| `outfits.py` | Wearable items (hats, glasses, chains, jackets, and props held in the right hand…) → `outfits.glb` + `outfits-low.glb` for Low graphics (one node per item id from `shared/outfits.ts`, origin on its anchor, materials `outfit:<key>` swapped for the wearer's own) and `public/outfits/<id>.webp` thumbnails plus `<id>-tint.webp` masks of the player-colour parts. Per-character placement lives in `client/src/three/characters/outfitFit.json`; `--preview out.png [--looks cap,shades|crown]` renders every character wearing them (needs `.cache/models/characters.glb`; `OUTFIT_ONLY=chog` for one up close, `OUTFIT_MANE=full` to see the whole mane under every hat); `--sheet out.png [--items a,b]` lays items out on the Chog, front and three-quarter, labelled. Every head item names its mane cut in `mane` (a test checks) |
| `cops.py` | The cutscene cast → `cops.glb` (loaded only when a cutscene first needs it): two cops (`CopBody`, `CopHeadA/B`, `CopHandL/R`, `CopFootL/R`, `CopBaton`; arms and legs drawn live), the patrol car (`CarBody`, `CarSirenRed/Blue`, `CarWheel`), the tow truck (`TruckBody`, `TruckBeacon`), `Trophy` and `Podium`. No light bake. `--preview out.png` renders a lineup |
| `chog_roamer.py` | The little Chog that runs about the home page → `public/home/chog-roamer.webp`, one sprite sheet: the base Chog posed with a Python copy of the game's rig (run cycle in five headings, a standing frame per heading, idle poses), seen from above at a slant, outlined, packed into 88 px cells; the layout goes to `client/src/components/roamer/sheet.gen.json` (`--cell`, `--quality`, `--only`, `--pack-only`, `--preview out.png`) |
| `detailed.py` | The hand-built character designs (one builder per character) and their shape helpers: ellipsoids, tubes and strands, rounded boxes, eyes with blinking lids, mittens, boots, piping, stars and moons |
| `extract_characters.ts` | Dumps the code-drawn looks (client `looks.tsx`) that `characters.py` falls back to for anything without a hand-built design |
| `skyline_set.py` | The Metropolis map's penthouse roof (every edition), light-baked, with the city round it |
| `skyline_env.py` | A 360° panorama of the Metropolis roof, its environment map |
| `classic_env.py` | 360° panorama of the Classic room (the environment map for reflections) |
| `chog_env.py` | 360° panorama of the Chog lounge (its environment map) |
| `speedway_set.py` | The Speedway map's race track at dusk (every edition), light-baked: track, kerbs, pits, grandstands with a crowd, floodlights, hills and sky |
| `speedway_env.py` | 360° panorama of the Speedway set (the environment map for reflections on that map) |
| `tptv_room.py` | The Takeprofit TV edition's room on the Classic map, light-baked: a broadcast studio and trading floor — video wall, anchor desk, ON AIR sign, trading desks with stacked monitors, studio cameras, softboxes, amber LEDs. Every screen is drawn into one atlas (PIL + numpy, the edition's fonts and logo) |
| `tptv_env.py` | 360° panorama of the Takeprofit TV studio (its environment map) |

## How a baked room works

- Positions in the scripts are in **game units** (x right, y up, z toward the
  camera; the board top is y = 0, the floor y = −4.6), the same numbers
  `BoardScene.tsx` uses.
- Plain colours are folded into a vertex-colour attribute so all the plain
  furniture is **one mesh, one draw call**. Textured surfaces (floor, walls,
  rug, pictures) keep their own material.
- Lighting (lamp, fire, moon, the warm pool over the table, bounce light,
  soft shadows) is baked by Cycles into **one lightmap** on a second UV set.
  The game shows the room with unlit materials multiplied by that lightmap,
  so the room costs no live lights. `lightmapIntensity` in the manifest
  undoes the normalisation the bake writes the image with.
- The table and board are in the bake as shadow casters only.
- An outdoor set has far more small parts than a room: the Speedway gives
  each little cluster of spectators, tyres or fence posts one tiny square of
  the lightmap (shaded by normal in the vertex colours) and packs the rest
  with its own shelf packer, so the atlas stays dense. Its sky and hills are
  unlit, coloured in the vertex colours, and never baked.
- Lit-live objects (the table, houses, the pieces) get matching live lights
  from `RoomLights` in `client/src/three/environments/index.tsx`.

## Adding a room for another edition

Copy `classic_room.py`, change the build functions and palette, export to
`models/<edition>/room.glb` with its own lightmap, record it under a new key,
and pick it in `Environment()` (environments/index.tsx) for that edition.
Until then an edition falls back to the drawn lounge in its palette.
