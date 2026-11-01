/*
 * Render engine: draws the timeline at a given time and drives playback.
 * The same drawing code is used for the preview and for export, so what you
 * see is what gets recorded.
 *
 * The playhead lives in the timeline (Studio.Timeline.state.time). This module
 * reads and moves it, so there is only one source of truth.
 *
 * Transitions, applied at the start of a clip:
 *   fade      fade in from black over transitionDur
 *   dip       hold black for half of transitionDur, then fade in over the other half
 *   dissolve  cross-fade over transitionDur on top of whatever the lower layer shows
 */
(function (ns) {
  "use strict";

  var canvas = null;
  var ctx = null;
  var audioCtx = null;
  var recordDest = null;
  var connected = new WeakSet();
  var layers = {};          // trackId -> { el, clipId }
  var playing = false;
  var lastFrame = 0;
  var rafId = null;
  var tickListeners = [];
  var endTime = 0;

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function now() { return ns.Timeline.state.time; }

  function setCanvas(c) {
    canvas = c;
    ctx = canvas.getContext("2d");
  }

  function findMedia(id) {
    var items = ns.Media.items;
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }

  function layerFor(trackId) {
    if (!layers[trackId]) {
      var el = document.createElement(trackId.charAt(0) === "A" ? "audio" : "video");
      el.preload = "auto";
      el.playsInline = true;
      el.style.display = "none";
      document.body.appendChild(el);
      layers[trackId] = { el: el, clipId: null };
      connectEl(el);
      el.addEventListener("seeked", function () { if (!playing) draw(); });
      el.addEventListener("loadeddata", function () { if (!playing) draw(); });
    }
    return layers[trackId];
  }

  // Routes every media element through one AudioContext, so the recorder can capture sound.
  function ensureAudio() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      recordDest = audioCtx.createMediaStreamDestination();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    Object.keys(layers).forEach(function (id) { connectEl(layers[id].el); });
    return audioCtx;
  }

  function connectEl(el) {
    if (!audioCtx || connected.has(el)) return;
    var src = audioCtx.createMediaElementSource(el);
    src.connect(audioCtx.destination);
    src.connect(recordDest);
    connected.add(el);
  }

  function sourceTime(clip, at) {
    return clip.inPoint + (at - clip.start);
  }

  // Makes the track's element show the right clip at time at, and keeps it in step.
  function syncLayer(trackId, active, at, shouldPlay) {
    var layer = layerFor(trackId);
    var el = layer.el;
    if (!active) {
      if (!el.paused) el.pause();
      layer.clipId = null;
      return;
    }
    var clip = active.clip;
    var media = findMedia(clip.mediaId);
    if (!media || media.kind === "image") {
      if (!el.paused) el.pause();
      layer.clipId = clip.id;
      return;
    }
    var want = sourceTime(clip, at);
    if (layer.clipId !== clip.id) {
      if (el.src !== media.url) el.src = media.url;
      layer.clipId = clip.id;
      el.currentTime = want;
    } else if (Math.abs(el.currentTime - want) > 0.25) {
      el.currentTime = want;
    }
    el.volume = clamp(clip.volume, 0, 1);
    if (shouldPlay) {
      if (el.paused) {
        var p = el.play();
        if (p && p.catch) p.catch(function () {});
      }
    } else if (!el.paused) {
      el.pause();
    }
  }

  // Returns the element to draw for a clip, or null if it isn't ready yet.
  function sourceFor(clip, media, layer) {
    if (media.kind === "image") return media.element || null;
    if (!layer || layer.clipId !== clip.id) return null;
    if (layer.el.readyState < 2) return null;
    return layer.el;
  }

  // Draws one frame at time at (defaults to the playhead).
  function draw(at) {
    if (at === undefined) at = now();
    if (!canvas || !ctx) return;
    var W = canvas.width;
    var H = canvas.height;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    ns.Timeline.activeAt(at).forEach(function (entry) {
      if (entry.track.kind === "audio") return;
      var clip = entry.clip;
      var media = findMedia(clip.mediaId);
      if (!media) return;
      var src = sourceFor(clip, media, layers[entry.track.id]);
      if (!src) return;

      var local = at - clip.start;
      var tr = clip.transitionDur || 0.5;
      var alpha = 1;
      var blackAlpha = 0;
      if (clip.transition === "fade" && local < tr) {
        blackAlpha = 1 - local / tr;
      } else if (clip.transition === "dip" && local < tr) {
        var hold = tr / 2;
        blackAlpha = local < hold ? 1 : 1 - (local - hold) / (tr - hold);
      } else if (clip.transition === "dissolve" && local < tr) {
        alpha = local / tr;
      }

      var sw = src.videoWidth || src.naturalWidth || src.width;
      var sh = src.videoHeight || src.naturalHeight || src.height;
      if (!sw || !sh) return;
      var scale = Math.min(W / sw, H / sh);
      var dw = sw * scale;
      var dh = sh * scale;
      var dx = (W - dw) / 2;
      var dy = (H - dh) / 2;

      if (blackAlpha > 0) {
        ctx.fillStyle = "rgba(0,0,0," + blackAlpha + ")";
        ctx.fillRect(0, 0, W, H);
      }
      ctx.globalAlpha = alpha;
      ctx.drawImage(src, dx, dy, dw, dh);
      ctx.globalAlpha = 1;
    });
  }

  function syncAll(at, shouldPlay) {
    var active = ns.Timeline.activeAt(at);
    ns.Timeline.tracks.forEach(function (track) {
      var entry = active.filter(function (a) { return a.track.id === track.id; })[0] || null;
      syncLayer(track.id, entry, at, shouldPlay);
    });
  }

  function emitTick() {
    var t = now();
    tickListeners.forEach(function (fn) { fn(t); });
  }

  function step(stamp) {
    if (!playing) return;
    var dt = lastFrame ? (stamp - lastFrame) / 1000 : 0;
    lastFrame = stamp;
    var t = now() + dt;
    if (t >= endTime) {
      ns.Timeline.movePlayhead(endTime);
      pause();
      draw(endTime);
      emitTick();
      return;
    }
    ns.Timeline.movePlayhead(t);
    syncAll(t, true);
    draw(t);
    emitTick();
    rafId = requestAnimationFrame(step);
  }

  function play() {
    if (playing) return;
    ensureAudio();
    endTime = ns.Timeline.timelineEnd();
    if (endTime <= 0) return;
    if (now() >= endTime) ns.Timeline.movePlayhead(0);
    playing = true;
    lastFrame = 0;
    rafId = requestAnimationFrame(step);
    emitTick();
  }

  function pause() {
    playing = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    lastFrame = 0;
    Object.keys(layers).forEach(function (id) {
      if (!layers[id].el.paused) layers[id].el.pause();
    });
    emitTick();
  }

  function toggle() {
    if (playing) pause(); else play();
  }

  // Moves the playhead. While paused, this shows the frame at that time.
  function seek(time) {
    var end = ns.Timeline.timelineEnd();
    var t = Math.max(0, Math.min(time, Math.max(end, 0)));
    ns.Timeline.movePlayhead(t);
    syncAll(t, false);
    draw(t);
    emitTick();
  }

  function setSize(w, h) {
    if (!canvas) return;
    canvas.width = w;
    canvas.height = h;
    draw(now());
  }

  function redraw() { draw(now()); }

  function isPlaying() { return playing; }

  function onTick(fn) { tickListeners.push(fn); }

  function offTick(fn) {
    tickListeners = tickListeners.filter(function (f) { return f !== fn; });
  }

  // Used by export: a stream with the canvas picture and the mixed audio.
  function captureStream(fps) {
    ensureAudio();
    var video = canvas.captureStream(fps || 30);
    var tracks = video.getVideoTracks().concat(recordDest.stream.getAudioTracks());
    return new MediaStream(tracks);
  }

  ns.Render = {
    setCanvas: setCanvas,
    play: play,
    pause: pause,
    toggle: toggle,
    seek: seek,
    setSize: setSize,
    redraw: redraw,
    isPlaying: isPlaying,
    now: now,
    onTick: onTick,
    offTick: offTick,
    captureStream: captureStream,
    ensureAudio: ensureAudio,
    draw: draw
  };
})(window.Studio = window.Studio || {});
