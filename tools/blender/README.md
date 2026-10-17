# 3D asset pipeline (headless Blender)

Every model in `client/public/models` is built by a script here. Blender runs
headless through its Python module (`bpy`), so there is no `.blend` file to
keep in sync and no hand-editing: change the script, rebuild, commit the output.

```bash
tools/blender/run.sh table.py                 # the game table (all maps)
tools/blender/run.sh props.py                 # houses and hotels
tools/blender/run.sh classic_room.py --draft  # Classic room, quick bake (~3 min)
tools/blender/run.sh classic_room.py          # Classic room, final bake (~40 min on 4 cores)
tools/blender/run.sh skyline_set.py --preview # Metropolis roof: Cycles renders of the game views, no bake
tools/blender/run.sh skyline_set.py --draft   # Metropolis roof, quick bake
tools/blender/run.sh skyline_set.py           # Metropolis roof, final bake
tools/blender/run.sh skyline_env.py           # Metropolis roof's reflection panorama
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
| `skyline_set.py` | The Metropolis map's penthouse roof (every edition), light-baked, with the city round it |
| `skyline_env.py` | A 360° panorama of the Metropolis roof, its environment map |

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
- Lit-live objects (the table, houses, the pieces) get matching live lights
  from `RoomLights` in `client/src/three/environments/index.tsx`.

## Adding a room for another edition

Copy `classic_room.py`, change the build functions and palette, export to
`models/<edition>/room.glb` with its own lightmap, record it under a new key,
and pick it in `Environment()` (environments/index.tsx) for that edition.
Until then an edition falls back to the drawn lounge in its palette.
