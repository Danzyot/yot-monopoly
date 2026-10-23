# SFX credits and licenses

Every file is 48 kHz, 16-bit, stereo WAV (mono sources are copied to both channels). The lead is trimmed so the transient starts within about 1-5 ms of sample 0, the tail is trimmed with a short fade, and each file is peak-normalised to -1.0 dBFS. All edits and layering are reproducible with `../scripts/build_sfx.py`.

**Licenses used:** only CC0 1.0 (Kenney packs and Freesound sounds marked "Creative Commons 0") and the Pixabay Content License. Nothing is CC-BY, CC-BY-NC or attribution-required. Attribution is not required for any file below; it is recorded only for provenance.

**How the files were obtained.** Only kenney.nl, freesound.org page HTML, the cdn.pixabay.com file host and GitHub were reachable from here. cdn.freesound.org was blocked, and so was the Cloudflare challenge on pixabay.com pages. So:
- **Freesound CC0 sounds** were taken from public GitHub repositories that ship copies of them with a license table. For every one, I opened the Freesound page itself (freesound.org/s/ID) and confirmed that it currently says **"Creative Commons 0"** and names the same author. Some mirrors are Freesound's 128 kbps HQ preview or a trimmed excerpt rather than the lossless original; this is noted per row.
- **Pixabay sounds** were downloaded from cdn.pixabay.com. Their identity (uploader, title, ID) comes from the download filename that Pixabay generates (`<uploader>-<slug>-<id>.mp3`) and/or from public GitHub catalogs that list the page URL and CDN URL. All Pixabay content is under the Pixabay Content License.
- **Kenney** packs were downloaded from kenney.nl. Each pack's License.txt reads "Creative Commons Zero, CC0".

| Name | Source file(s) and edit | Source URL | Author | License |
|---|---|---|---|---|
| squeak-1 | Breviceps "Squeaky Toy #4" (3rd squeak, 0.38-0.62 s). Mirror: github.com/Phauks/Jeopardy_Machine `apps/web/static/sounds/squeaky-toy.mp3` (HQ preview, trimmed) | https://freesound.org/s/483922/ | Breviceps | CC0 1.0 |
| squeak-2 | arc241 "Squeaky Toy 6.wav" (2nd squeak, 0.35-0.55 s). Mirror: github.com/WeakAuras/WeakAuras2 `WeakAuras/Media/Sounds/SqueakyToyShort.ogg` | https://freesound.org/people/arc241/sounds/448821/ | arc241 | CC0 1.0 |
| squeak-3 | qubodup "Squeaky Toy 7" (whole). Mirror: github.com/VHlearning3/Out-of-the-Depths `Assets/Sound/Creatures/HelloFish_Poke_SqueakyToy_Qubodup_CC0.mp3` (HQ preview) | https://freesound.org/people/qubodup/sounds/861825/ | qubodup | CC0 1.0 |
| squeak-4 | arc241 "Squeaky Toy 6.wav" (1st squeak, 0.02-0.30 s), same mirror as squeak-2 | https://freesound.org/people/arc241/sounds/448821/ | arc241 | CC0 1.0 |
| hop | Layer: CCOUNTERFEIT "JUMP SFX RANDOMISATION - HUMAN MADE" (one take, mirror github.com/tomaslachmann/dont-fall `apps/client/public/sounds/character/jump_3.ogg`), plus the first 0.42 s of sdroliasnick "cartoon-sound-single-boing" at -7 dB (mirror: same repo, `character/spring_0.ogg`) | https://freesound.org/people/CCOUNTERFEIT/sounds/851416/ and https://freesound.org/people/sdroliasnick/sounds/731262/ | CCOUNTERFEIT; sdroliasnick | CC0 1.0 (both) |
| land | Layer: Kenney Impact Sounds `impactSoft_medium_001.ogg` + `footstep_carpet_000.ogg` (-6 dB) | https://kenney.nl/assets/impact-sounds | Kenney (kenney.nl) | CC0 1.0 |
| flatten | Layer: Kenney `impactSoft_heavy_000.ogg` (low thump) + Kenney `impactPunch_medium_000.ogg` (-8 dB) + Bricklover "Water Squelch" (one short squelch, low-passed at 3.5 kHz, -9 dB; mirror: dont-fall `surface/mud_0.ogg`) | https://kenney.nl/assets/impact-sounds and https://freesound.org/people/Bricklover/sounds/560953/ | Kenney; Bricklover | CC0 1.0 (both) |
| sit | Layer: Kenney `impactSoft_medium_003.ogg` (-3 dB) + Kenney RPG Audio `cloth3.ogg` (-4 dB) | https://kenney.nl/assets/impact-sounds and https://kenney.nl/assets/rpg-audio | Kenney | CC0 1.0 |
| dice-shake | Kenney Casino Audio `dice-shake-1.ogg` (from 0.16 s, 0.85 s long) | https://kenney.nl/assets/casino-audio | Kenney | CC0 1.0 |
| dice-hit-1 | Kenney Casino Audio `dice-throw-1.ogg` | https://kenney.nl/assets/casino-audio | Kenney | CC0 1.0 |
| dice-hit-2 | Kenney Casino Audio `dice-throw-2.ogg` | https://kenney.nl/assets/casino-audio | Kenney | CC0 1.0 |
| dice-hit-3 | Kenney Casino Audio `dice-throw-3.ogg` | https://kenney.nl/assets/casino-audio | Kenney | CC0 1.0 |
| pop-1 | "Pop" (cdn.pixabay.com/download/audio/2025/09/09/audio_3023b9bde2.mp3?filename=dragon-studio-pop-402324.mp3) | https://pixabay.com/sound-effects/film-special-effects-pop-402324/ | DRAGON-STUDIO | Pixabay Content License |
| pop-2 | "Soft Pop" (cdn.pixabay.com/download/audio/2026/06/04/audio_0f8832a8fb.mp3?filename=mikeaveloo-soft_pop-538611.mp3) | https://pixabay.com/sound-effects/film-special-effects-soft-pop-538611/ | mikeaveloo | Pixabay Content License |
| ding | "Clear Bell Chime" (cdn.pixabay.com/download/audio/2026/02/20/audio_547f040f5a.mp3?filename=universfield-clear-bell-chime-487898.mp3) | https://pixabay.com/sound-effects/film-special-effects-clear-bell-chime-487898/ | Universfield | Pixabay Content License |
| siren | TitanKaempfer "Police Siren", 2.8 s excerpt starting 0.5 s into the mirror (3 ms fade-in, 450 ms fade-out). Mirror: github.com/victorrentea/victor-effects `starter-pack/02_siren.mp3` (an 8 s, 160 kbps excerpt) | https://freesound.org/people/TitanKaempfer/sounds/746302/ | TitanKaempfer | CC0 1.0 |
| skid | martian "car park skiding corner.wav", excerpt (first 0.62 s of the mirror's 0.83 s cut). Mirror: github.com/umutseven92/godspeed `source/assets/sounds/skid.wav` | https://freesound.org/people/martian/sounds/178889/ | martian | CC0 1.0 |
| grab | Layer: Kenney RPG Audio `cloth2.ogg`, `handleSmallLeather.ogg` (+70 ms), `cloth4.ogg` (+160 ms), and Kenney Impact `impactPunch_medium_002.ogg` (-12 dB) | https://kenney.nl/assets/rpg-audio and https://kenney.nl/assets/impact-sounds | Kenney | CC0 1.0 |
| jail-door | kd_jack "Cell Door 2.aiff" (main slam; mirror github.com/drevton/OpenSC2k `assets/audio/freesound/prison-door.wav`, a 2 s mono excerpt), plus Kenney `impactMetal_heavy_001.ogg` at -9 dB for weight | https://freesound.org/people/kd_jack/sounds/214230/ and https://kenney.nl/assets/impact-sounds | kd_jack; Kenney | CC0 1.0 (both) |
| card-slap-1 | Kenney Casino Audio `card-place-1.ogg` | https://kenney.nl/assets/casino-audio | Kenney | CC0 1.0 |
| card-slap-2 | Kenney Casino Audio `card-place-3.ogg` (slap only, from 0.40 s) | https://kenney.nl/assets/casino-audio | Kenney | CC0 1.0 |
| card-slap-3 | Kenney Casino Audio `card-place-4.ogg` (slap only, from 0.25 s) | https://kenney.nl/assets/casino-audio | Kenney | CC0 1.0 |
| card-flick | Kenney Casino Audio `card-shove-3.ogg` (first 0.32 s) | https://kenney.nl/assets/casino-audio | Kenney | CC0 1.0 |
| card-shuffle | Kenney Casino Audio `card-fan-1.ogg` (0.69 s card stream/riffle) | https://kenney.nl/assets/casino-audio | Kenney | CC0 1.0 |
| fire | Layer: moogy73 "Woosh_Medium_01.wav" (low ignition "whoomp", first 0.9 s; mirror dont-fall `character/dash_0.ogg`; CC0), plus a 1.75 s crackle window (12.6-14.35 s) of "Fire Crackling Sounds" (cdn.pixabay.com/download/audio/2025/10/28/audio_a61f2bf9d0.mp3?filename=dragon-studio-fire-crackling-sounds-427410.mp3) at -3 dB with a 140 ms fade-in at +60 ms | https://freesound.org/people/moogy73/sounds/425703/ and https://pixabay.com/sound-effects/fire-crackling-sounds-427410/ (page slug inferred from the filename) | moogy73; DRAGON-STUDIO | CC0 1.0 + Pixabay Content License |
| chips-1 | Kenney Casino Audio `chips-handle-5.ogg` | https://kenney.nl/assets/casino-audio | Kenney | CC0 1.0 |
| chips-2 | Kenney Casino Audio `chips-handle-4.ogg` | https://kenney.nl/assets/casino-audio | Kenney | CC0 1.0 |
| whoosh-1 | "Clean Whoosh" (cdn.pixabay.com/download/audio/2025/07/30/audio_343bfeb0ea.mp3?filename=dragon-studio-clean-whoosh-382726.mp3) | https://pixabay.com/sound-effects/film-special-effects-clean-whoosh-382726/ | DRAGON-STUDIO | Pixabay Content License |
| whoosh-2 | moogy73 "Woosh_Medium_Short_01.wav" (mirror dont-fall `character/dash_2.ogg`) | https://freesound.org/people/moogy73/sounds/425706/ | moogy73 | CC0 1.0 |
| whoosh-3 | qubodup "Double Whoosh 2" (second pass only, 0.40 s). Mirror: WeakAuras2 `WeakAuras/Media/Sounds/DoubleWhoosh.ogg` | https://freesound.org/people/qubodup/sounds/60025/ | qubodup | CC0 1.0 |
| impact | "Cinematic Impact Boom 05" (cdn.pixabay.com/audio/2025/05/31/audio_be1e4daf3e.mp3) | https://pixabay.com/sound-effects/film-special-effects-cinematic-impact-boom-05-352465/ | Universfield (per github.com/ricardo/overlay-motion docs/sfx-library.md; Pixabay page itself not reachable here) | Pixabay Content License |
| riser | "Small Riser", first 1.02 s, cut at its peak so it lands on a hit (cdn.pixabay.com/download/audio/2025/05/30/audio_11d1a8dd8d.mp3?filename=koiroylers-small-riser-351977.mp3) | https://pixabay.com/sound-effects/film-special-effects-small-riser-351977/ | koiroylers | Pixabay Content License |
| ui-tick | Kenney Interface Sounds `tick_002.ogg` | https://kenney.nl/assets/interface-sounds | Kenney | CC0 1.0 |
| cheer | jbeetle "3 Men Cheering" ("hooray/yay", 2 s). Mirror: github.com/MixaDoDs/AngelOS-Dotfiles `.config/quickshell/angelos/data/sounds/intro/cheer.ogg` | https://freesound.org/people/jbeetle/sounds/274510/ | jbeetle | CC0 1.0 |
| room-tone | callmethefoo "Soft Room Tone", 11 s (2-13 s of the mirror, 400 ms fade-in, 600 ms fade-out). Mirror: github.com/Slymaster/masame `public/assets/board3d/hanok/room.mp3` (HQ preview, made into a mono loop and raised 14 dB by that repo). Normalised to -1 dBFS like the rest, so play it far down in the mix. | https://freesound.org/people/callmethefoo/sounds/744447/ | callmethefoo | CC0 1.0 |

Notes
- Layered or composite files (hop, land, flatten, sit, grab, jail-door, fire) are my own mixes of the CC0 sources listed. CC0 places no conditions on derivatives.
- No ESC-50 dataset clips are used. The dataset as a whole is CC BY-NC, so I replaced the siren and fire-crackle clips I had first taken from it with the sources above.

- step-1..5: Kenney "Impact Sounds" footstep_carpet_000..004 (CC0, kenney.nl), pitched up ~3 semitones, trimmed, normalised. Replaces the squeaks in the opener and the jail walk.

Music: "Spy Jazz" by SergeQuadrado, Pixabay Content License, https://pixabay.com/music/id-20925/
