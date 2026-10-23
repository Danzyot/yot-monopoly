# Trailer audio

What the final trailer's sound is made of, so a new session can rebuild the mix.

| What | File | Source and license |
| --- | --- | --- |
| Music | `music/spy-jazz.flac` | "Spy Jazz" by SergeQuadrado, Pixabay Music, https://pixabay.com/music/id-20925/ (CDN: https://cdn.pixabay.com/audio/2022/02/15/audio_69aaf4e6d1.mp3). Pixabay Content License: free for commercial use, no attribution needed, and the raw track may not be resold on its own. Stored as 48 kHz 16-bit stereo with the lead and tail trimmed. `assemble.py`'s `MUSIC_START`, `MUSIC_SPLICE` and `MUSIC_CUT` are times in this file. |
| Sound effects | `sfx/*.wav` | Kenney (CC0), Freesound CC0 and Pixabay Content License. Every file's source, author and edit is listed in `sfx/credits.md`. `build_sfx.py` is the script that cut and layered them; its download paths point at the old scratch folder. |

`assemble.py` writes `<music>-soft.wav` next to the music the first time it runs. That copy has the high band's ticks squashed and pulled down 20 dB. Delete it if you change `soften()`.

Assemble with:

    TRAILER_OUT=<out> TRAILER_MUSIC=<wav of music/spy-jazz.flac> TRAILER_SFX=tools/trailer/audio/sfx FFMPEG=<ffmpeg> <venv>/bin/python assemble.py

`TRAILER_MUSIC` must be a WAV, so convert the FLAC first: `ffmpeg -i music/spy-jazz.flac spy-jazz.wav`.
