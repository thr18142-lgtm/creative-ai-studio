/*
 * Timeline model and timeline UI.
 *
 * Model: tracks hold clips. Clips on the same track never overlap. Times are
 * in seconds on the timeline; inPoint is where the clip starts inside its
 * source file. Every change goes through commit(), so undo and redo work on
 * whole snapshots of the clip list.
 *
 * Layers: V1 is drawn first (bottom), V2 on top, A1 is audio only.
 */
(function (ns) {
  "use strict";

  var LABEL_W = 64;          // width of the track label column, px
  var IMAGE_DEFAULT = 5;     // seconds for a still image added to the timeline
  var MIN_LEN = 0.1;
  var HISTORY_MAX = 100;

  var T = {
    tracks: [
      { id: "V1", kind: "video", label: "V1" },
      { id: "V2", kind: "video", label: "V2" },
      { id: "A1", kind: "audio", label: "A1" }
    ],
    clips: [],
    selected: null,
    time: 0,
    zoom: 40,              // pixels per second
    snap: true,
    past: [],
    future: [],
    listeners: [],
    els: null,
    nextId: 1
  };

  function notify() {
    T.listeners.forEach(function (fn) { fn(); });
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function commit(mutate) {
    T.past.push(clone(T.clips));
    if (T.past.length > HISTORY_MAX) T.past.shift();
    T.future = [];
    mutate();
    notify();
  }

  function undo() {
    if (!T.past.length) return false;
    T.future.push(clone(T.clips));
    T.clips = T.past.pop();
    if (T.selected && !byId(T.selected)) T.selected = null;
    notify();
    return true;
  }

  function redo() {
    if (!T.future.length) return false;
    T.past.push(clone(T.clips));
    T.clips = T.future.pop();
    if (T.selected && !byId(T.selected)) T.selected = null;
    notify();
    return true;
  }

  function byId(id) {
    for (var i = 0; i < T.clips.length; i++) if (T.clips[i].id === id) return T.clips[i];
    return null;
  }

  function trackOf(clip) {
    for (var i = 0; i < T.tracks.length; i++) if (T.tracks[i].id === clip.trackId) return T.tracks[i];
    return null;
  }

  function end(clip) { return clip.start + clip.duration; }

  function timelineEnd() {
    return T.clips.reduce(function (m, c) { return Math.max(m, end(c)); }, 0);
  }

  function clipsOnTrack(trackId, exceptId) {
    return T.clips.filter(function (c) { return c.trackId === trackId && c.id !== exceptId; });
  }

  function overlaps(trackId, start, duration, exceptId) {
    var stop = start + duration;
    return clipsOnTrack(trackId, exceptId).some(function (c) {
      return start < end(c) - 1e-6 && stop > c.start + 1e-6;
    });
  }

  // Snap a time to the playhead, 0, or any clip edge, when snapping is on.
  function snapTime(t, exceptId) {
    if (!T.snap) return t;
    var threshold = 8 / T.zoom;
    var candidates = [0, T.time];
    T.clips.forEach(function (c) {
      if (c.id === exceptId) return;
      candidates.push(c.start, end(c));
    });
    var best = t;
    var bestDist = threshold;
    candidates.forEach(function (c) {
      var d = Math.abs(c - t);
      if (d < bestDist) { best = c; bestDist = d; }
    });
    return best;
  }

  function mediaById(id) {
    var items = (ns.Media && ns.Media.items) || [];
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }

  function trackDefaultFor(kind) {
    return kind === "audio" ? "A1" : "V1";
  }

  // Adds a media item to a track. Returns the new clip, or null if the track is full at that point.
  function addClip(media, trackId, start) {
    var duration = media.kind === "image" ? IMAGE_DEFAULT : media.duration;
    if (!duration || duration <= 0) return null;
    var tid = trackId || trackDefaultFor(media.kind);
    var at = Math.max(0, start == null ? T.time : start);
    if (overlaps(tid, at, duration, null)) {
      // Append after the last clip on the track instead of overlapping.
      var last = clipsOnTrack(tid, null).reduce(function (m, c) { return Math.max(m, end(c)); }, 0);
      at = last;
    }
    var clip = {
      id: "c" + (T.nextId++),
      mediaId: media.id,
      kind: media.kind,
      trackId: tid,
      start: at,
      inPoint: 0,
      duration: duration,
      sourceLength: media.kind === "image" ? null : media.duration,
      transition: "none",
      transitionDur: 0.5,
      volume: 1
    };
    commit(function () { T.clips.push(clip); });
    T.selected = clip.id;
    return clip;
  }

  function moveClip(id, start, trackId) {
    var c = byId(id);
    if (!c) return false;
    var s = Math.max(0, snapTime(start, id));
    var tid = trackId || c.trackId;
    if (overlaps(tid, s, c.duration, id)) return false;
    commit(function () {
      c.start = s;
      c.trackId = tid;
    });
    return true;
  }

  // edge: "left" or "right". sec: the new time of that edge on the timeline.
  function trimClip(id, edge, sec) {
    var c = byId(id);
    if (!c) return false;
    var prev = clipsOnTrack(c.trackId, id).filter(function (o) { return o.start <= c.start; })
      .reduce(function (m, o) { return Math.max(m, end(o)); }, 0);
    var next = clipsOnTrack(c.trackId, id).filter(function (o) { return o.start > c.start + 1e-6; })
      .reduce(function (m, o) { return Math.min(m, o.start); }, Infinity);
    var t = snapTime(sec, id);
    var start = c.start, inPoint = c.inPoint, dur = c.duration;

    if (edge === "left") {
      var stop = end(c);
      var minStart = Math.max(prev, c.start - c.inPoint, 0);
      var newStart = Math.min(Math.max(t, minStart), stop - MIN_LEN);
      var delta = newStart - c.start;
      start = newStart;
      inPoint = c.inPoint + delta;
      dur = stop - newStart;
    } else {
      var maxDur = next - c.start;
      if (c.sourceLength != null) maxDur = Math.min(maxDur, c.sourceLength - c.inPoint);
      var newDur = Math.min(Math.max(t - c.start, MIN_LEN), maxDur);
      dur = newDur;
    }

    commit(function () {
      c.start = start;
      c.inPoint = inPoint;
      c.duration = dur;
    });
    return true;
  }

  // Splits every clip that spans time t. If a clip is selected, only that one is split.
  function splitAt(t, onlyId) {
    var targets = T.clips.filter(function (c) {
      if (onlyId && c.id !== onlyId) return false;
      return t > c.start + 0.05 && t < end(c) - 0.05;
    });
    if (!targets.length) return 0;
    commit(function () {
      targets.forEach(function (c) {
        var right = {
          id: "c" + (T.nextId++),
          mediaId: c.mediaId,
          kind: c.kind,
          trackId: c.trackId,
          start: t,
          inPoint: c.inPoint + (t - c.start),
          duration: end(c) - t,
          sourceLength: c.sourceLength,
          transition: "none",
          transitionDur: c.transitionDur,
          volume: c.volume
        };
        c.duration = t - c.start;
        T.clips.push(right);
      });
    });
    return targets.length;
  }

  function deleteClip(id) {
    if (!byId(id)) return;
    commit(function () {
      T.clips = T.clips.filter(function (c) { return c.id !== id; });
    });
    if (T.selected === id) T.selected = null;
  }

  function duplicateClip(id) {
    var c = byId(id);
    if (!c) return null;
    var at = end(c);
    var copy = clone(c);
    copy.id = "c" + (T.nextId++);
    copy.start = at;
    if (overlaps(c.trackId, at, c.duration, null)) {
      var last = clipsOnTrack(c.trackId, null).reduce(function (m, o) { return Math.max(m, end(o)); }, 0);
      copy.start = last;
    }
    commit(function () { T.clips.push(copy); });
    T.selected = copy.id;
    return copy;
  }

  function setTransition(id, type) {
    var c = byId(id);
    if (!c) return;
    commit(function () { c.transition = type; });
  }

  function setVolume(id, v) {
    var c = byId(id);
    if (!c) return;
    c.volume = Math.max(0, Math.min(1.5, Number(v) || 0));
    notify();
  }

  function setTime(t) {
    T.time = Math.max(0, Math.min(t, Math.max(timelineEnd(), 0)));
    notify();
  }

  // Moves only the playhead, without rebuilding the timeline (used every frame during playback).
  function movePlayhead(t) {
    T.time = Math.max(0, t);
    if (!T.els) return;
    var ph = T.els.tracks.querySelector(".playhead");
    if (ph) ph.style.left = xFor(T.time) + "px";
  }

  function select(id) {
    T.selected = id;
    notify();
  }

  // ---------- UI ----------

  function xFor(t) { return LABEL_W + t * T.zoom; }

  function timeFromEvent(ev, container) {
    var rect = container.getBoundingClientRect();
    var x = ev.clientX - rect.left + container.scrollLeft;
    return Math.max(0, (x - LABEL_W) / T.zoom);
  }

  function tickStep() {
    if (T.zoom >= 120) return 0.5;
    if (T.zoom >= 60) return 1;
    if (T.zoom >= 25) return 2;
    if (T.zoom >= 12) return 5;
    return 10;
  }

  function renderRuler() {
    var ruler = T.els.ruler;
    ruler.innerHTML = "";
    var total = Math.max(timelineEnd() + 10, 30);
    ruler.style.width = xFor(total) + "px";
    var step = tickStep();
    for (var t = 0; t <= total; t += step) {
      var tick = document.createElement("span");
      tick.style.left = xFor(t) + "px";
      tick.textContent = ns.Media.formatSeconds(t);
      ruler.appendChild(tick);
    }
  }

  function renderTracks() {
    var host = T.els.tracks;
    host.innerHTML = "";
    var total = Math.max(timelineEnd() + 10, 30);
    host.style.width = xFor(total) + "px";

    T.tracks.forEach(function (track) {
      var row = document.createElement("div");
      row.className = "track";
      row.dataset.track = track.id;

      var label = document.createElement("span");
      label.className = "track-label";
      label.textContent = track.label;
      label.style.width = (LABEL_W - 8) + "px";
      row.appendChild(label);

      row.addEventListener("pointerdown", function (ev) {
        if (ev.target !== row) return;
        setTime(timeFromEvent(ev, T.els.timelineScroll));
      });

      T.clips.filter(function (c) { return c.trackId === track.id; }).forEach(function (c) {
        row.appendChild(clipElement(c));
      });
      host.appendChild(row);
    });

    var playhead = document.createElement("div");
    playhead.className = "playhead";
    playhead.style.left = xFor(T.time) + "px";
    host.appendChild(playhead);
  }

  function clipElement(c) {
    var el = document.createElement("div");
    var media = mediaById(c.mediaId);
    el.className = "clip is-" + c.kind + (T.selected === c.id ? " is-selected" : "");
    el.dataset.id = c.id;
    el.style.left = xFor(c.start) + "px";
    el.style.width = Math.max(6, c.duration * T.zoom) + "px";

    var label = document.createElement("span");
    label.className = "clip-label";
    label.textContent = (media ? media.name : "Clip") + (c.transition !== "none" ? " · " + c.transition : "");
    el.appendChild(label);

    if (media && media.peaks) {
      el.appendChild(waveSvg(media.peaks, c));
    }

    var left = document.createElement("div");
    left.className = "clip-handle left";
    left.dataset.edge = "left";
    var right = document.createElement("div");
    right.className = "clip-handle right";
    right.dataset.edge = "right";
    el.appendChild(left);
    el.appendChild(right);

    el.addEventListener("pointerdown", function (ev) {
      ev.stopPropagation();
      startDrag(ev, c.id, ev.target.dataset && ev.target.dataset.edge);
    });
    return el;
  }

  function waveSvg(peaks, c) {
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "clip-wave");
    svg.setAttribute("viewBox", "0 0 " + peaks.length + " 1");
    svg.setAttribute("preserveAspectRatio", "none");
    var pathData = "";
    var start = Math.floor((c.inPoint / Math.max(c.sourceLength || 1, 0.001)) * peaks.length);
    var span = Math.max(1, Math.floor((c.duration / Math.max(c.sourceLength || 1, 0.001)) * peaks.length));
    for (var i = 0; i < span && start + i < peaks.length; i++) {
      var h = Math.max(0.04, peaks[start + i]);
      pathData += "M" + i + " 0.5 v" + (-h / 2) + " M" + i + " 0.5 v" + (h / 2) + " ";
    }
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", pathData);
    path.setAttribute("stroke", "#fff");
    path.setAttribute("stroke-width", "0.8");
    svg.appendChild(path);
    return svg;
  }

  // Drag: move the clip, or trim one edge. Pointer deltas are converted to seconds.
  function startDrag(ev, id, edge) {
    var c = byId(id);
    if (!c) return;
    select(id);
    var startX = ev.clientX;
    var startY = ev.clientY;
    var origStart = c.start;
    var origEnd = end(c);
    var mode = edge === "left" || edge === "right" ? "trim" : "move";
    var moved = false;
    // Snapshot before the drag so the whole drag is one undo step.
    var before = clone(T.clips);

    function onMove(e) {
      var dx = e.clientX - startX;
      var dt = dx / T.zoom;
      if (Math.abs(dx) > 2) moved = true;
      if (!moved) return;
      if (mode === "move") {
        var targetTrack = trackAtY(e.clientY) || c.trackId;
        var live = byId(id);
        if (!live) return;
        var snapped = Math.max(0, snapTime(origStart + dt, id));
        if (kindMatches(live, targetTrack) && !overlaps(targetTrack, snapped, live.duration, id)) {
          live.start = snapped;
          live.trackId = targetTrack;
          notify();
        }
      } else if (edge === "left") {
        trimClipLive(id, "left", origStart + dt, origEnd);
      } else {
        trimClipLive(id, "right", origEnd + dt, origStart);
      }
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!moved) return;
      T.past.push(before);
      if (T.past.length > HISTORY_MAX) T.past.shift();
      T.future = [];
      notify();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Live trim during drag: uses the same limits as trimClip but without history.
  function trimClipLive(id, edge, sec, otherEdge) {
    var c = byId(id);
    if (!c) return;
    var prev = clipsOnTrack(c.trackId, id).filter(function (o) { return o.start <= c.start; })
      .reduce(function (m, o) { return Math.max(m, end(o)); }, 0);
    var next = clipsOnTrack(c.trackId, id).filter(function (o) { return o.start > c.start + 1e-6; })
      .reduce(function (m, o) { return Math.min(m, o.start); }, Infinity);
    var t = snapTime(sec, id);
    if (edge === "left") {
      var stop = end(c);
      var minStart = Math.max(prev, c.start - c.inPoint, 0);
      var newStart = Math.min(Math.max(t, minStart), stop - MIN_LEN);
      c.inPoint = c.inPoint + (newStart - c.start);
      c.duration = stop - newStart;
      c.start = newStart;
    } else {
      var maxDur = next - c.start;
      if (c.sourceLength != null) maxDur = Math.min(maxDur, c.sourceLength - c.inPoint);
      c.duration = Math.min(Math.max(t - c.start, MIN_LEN), maxDur);
    }
    notify();
  }

  function kindMatches(clip, trackId) {
    var track = T.tracks.filter(function (t) { return t.id === trackId; })[0];
    return track && (track.kind === "audio") === (clip.kind === "audio");
  }

  function trackAtY(y) {
    var rows = T.els.tracks.querySelectorAll(".track");
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i].getBoundingClientRect();
      if (y >= r.top && y < r.bottom) return rows[i].dataset.track;
    }
    return null;
  }

  function init(els) {
    T.els = els;
    T.els.timelineScroll = els.tracks.parentNode;
    els.ruler.addEventListener("pointerdown", function (ev) {
      setTime(timeFromEvent(ev, T.els.timelineScroll));
    });
    T.listeners.push(function () {
      renderRuler();
      renderTracks();
    });
    notify();
  }

  function onChange(fn) { T.listeners.push(fn); }

  function setZoom(z) {
    T.zoom = Math.max(10, Math.min(200, Number(z) || 40));
    notify();
  }

  // Returns the clip on each track that is active at time t, bottom layer first.
  function activeAt(t) {
    var out = [];
    T.tracks.forEach(function (track) {
      var hit = T.clips.filter(function (c) {
        return c.trackId === track.id && t >= c.start - 1e-6 && t < end(c) - 1e-6;
      })[0];
      if (hit) out.push({ track: track, clip: hit });
    });
    return out;
  }

  ns.Timeline = {
    tracks: T.tracks,
    state: T,
    init: init,
    onChange: onChange,
    addClip: addClip,
    moveClip: moveClip,
    trimClip: trimClip,
    splitAt: splitAt,
    deleteClip: deleteClip,
    duplicateClip: duplicateClip,
    setTransition: setTransition,
    setVolume: setVolume,
    setTime: setTime,
    movePlayhead: movePlayhead,
    setZoom: setZoom,
    select: select,
    undo: undo,
    redo: redo,
    byId: byId,
    trackOf: trackOf,
    end: end,
    timelineEnd: timelineEnd,
    activeAt: activeAt,
    trackDefaultFor: trackDefaultFor
  };
})(window.Studio = window.Studio || {});
