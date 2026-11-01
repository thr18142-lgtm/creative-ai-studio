# CREATIVE AI STUDIO

Browser-based photo and video editor. This is the Phase 1 build.

## Open it

No install. Open `index.html` in Chrome or Edge, or serve the folder:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080.

## What works in Phase 1

- **Media Library**: import images, video and audio by button, drag and drop, or file picker. Each item shows resolution, duration, size and audio channels. Video and audio get thumbnails; audio gets a waveform.
- **Photo Editor**: exposure, contrast and saturation sliders, rotate 90°, flip, reset, hold to compare with the original, and PNG download at full resolution.
- **Video Editor**: multi-track timeline (V1, V2, A1). Add clips, drag to move (snaps to the playhead and clip edges, and never overlaps on one track), drag clip edges to trim, split at the playhead, duplicate, delete, undo and redo.
- **Transitions** at the start of a video clip: fade in from black, dip to black, and cross dissolve over the layer below (V2 over V1).
- **Audio Studio**: waveform view of the selected audio clip and a clip volume slider.
- **Export**: WebM at 720p, 1080p, vertical 9:16 or square, with a bitrate setting. Export plays the timeline once in real time, so a 30-second timeline takes about 30 seconds.

Keyboard: Space plays and pauses, S splits at the playhead, Delete removes the selected clip, Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes, and the left and right arrows step one frame.

## Honest limits

- **Frame rate and video codec** can't be read by web pages, so the library shows "Not readable in browser" instead of guessing.
- **Export is WebM only.** It is recorded by the browser, so quality and speed depend on the device. MP4 and FFmpeg-quality export need a server.
- **Export runs in real time** and needs the tab to stay in the foreground.
- **Audio fades, speed changes, effects, color grading, text, keyframes and motion graphics** are not in Phase 1. The sidebar lists them under "Later phases" and they are not clickable.
- **AI features** (assistant, background removal, subtitles, generation) need paid AI services and a backend, so they come after Phase 1.
- **Projects are not saved.** Reloading the page clears the timeline. Autosave is a later phase.

## Your files

The original files are read into the browser and never written to. Exports are new files you download.

## Layout

- `index.html`: the app shell and panels
- `css/studio.css`: the dark glass theme
- `js/media.js`: import, metadata, thumbnails, waveforms
- `js/photo.js`: photo adjustments and PNG export
- `js/timeline.js`: clips, snapping, trim, split, move, undo and redo, timeline drawing
- `js/render.js`: draws a frame at any time, transitions, playback; used for preview and export
- `js/export.js`: real-time WebM recording
- `js/app.js`: glue for navigation, panels, the inspector and keyboard shortcuts

## Next phases

1. Phase 2: keyframes, color grading, effects, text animation, beat detection, speed ramping.
2. Phase 3: the AI assistant, AI photo editing, background removal, AI subtitles and editing plans, sent through a backend so keys stay off the frontend.
3. Phase 4: AI video generation, tracking, motion graphics, cloud rendering and templates.
