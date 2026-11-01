/*
 * App glue: navigation, media library, photo and timeline controls,
 * keyboard shortcuts, inspector and export. The engines live in their own files.
 */
(function (ns) {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var fmt = ns.Media.formatSeconds;
  var state = {
    view: "media",
    selectedMedia: null,
    photoItem: null,
    exporting: false
  };

  function status(msg) { $("statusbar").textContent = msg; }

  // ---------- Views ----------

  function setView(view) {
    state.view = view;
    document.querySelectorAll(".nav-item[data-view]").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.view === view);
    });
    ["media", "photo", "video", "audio", "export"].forEach(function (v) {
      $("view-" + v).hidden = v !== view;
    });
    if (view === "video") ns.Render.redraw();
    renderInspector();
  }

  // ---------- Media library ----------

  function mediaMeta(item) {
    var lines = [];
    if (item.kind === "audio") {
      lines.push(fmt(item.duration) + " · " + item.channels + " ch · " + Math.round(item.sampleRate / 100) / 10 + " kHz");
    } else {
      var res = item.width + " × " + item.height;
      var dur = item.kind === "image" ? "still" : fmt(item.duration);
      lines.push(res + " · " + dur);
      lines.push("Frame rate: " + item.frameRate);
      if (item.kind === "video") lines.push("Codec: " + item.codec);
    }
    lines.push(ns.Media.formatBytes(item.size));
    return lines;
  }

  function renderLibrary() {
    var list = $("media-list");
    list.innerHTML = "";
    ns.Media.items.forEach(function (item) {
      var li = document.createElement("li");
      li.className = "media-item" + (state.selectedMedia === item.id ? " is-selected" : "");
      li.addEventListener("click", function () {
        state.selectedMedia = item.id;
        renderLibrary();
        renderInspector();
      });

      var thumb = document.createElement("div");
      thumb.className = "thumb";
      if (item.thumb) {
        thumb.style.backgroundImage = "url(\"" + item.thumb + "\")";
      } else {
        thumb.textContent = item.kind === "audio" ? "Audio" : "";
      }
      li.appendChild(thumb);

      var name = document.createElement("div");
      name.className = "media-name";
      name.textContent = item.name;
      li.appendChild(name);

      var meta = document.createElement("div");
      meta.className = "media-meta";
      mediaMeta(item).forEach(function (line) {
        var p = document.createElement("div");
        p.textContent = line;
        meta.appendChild(p);
      });
      li.appendChild(meta);

      var actions = document.createElement("div");
      actions.className = "row";
      var add = button("Add to timeline", function (ev) {
        ev.stopPropagation();
        addToTimeline(item);
      });
      actions.appendChild(add);
      if (item.kind === "image") {
        actions.appendChild(button("Edit photo", function (ev) {
          ev.stopPropagation();
          openPhoto(item);
        }));
      }
      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  function button(label, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function importFiles(fileList) {
    if (!fileList || !fileList.length) return;
    status("Reading " + fileList.length + " file(s)…");
    ns.Media.importFiles(fileList).then(function (res) {
      renderLibrary();
      var msg = res.added.length + " imported";
      if (res.errors.length) msg += ". " + res.errors.join(" ");
      status(msg);
      if (res.added.length && !state.selectedMedia) state.selectedMedia = res.added[0].id;
      renderInspector();
    });
  }

  function addToTimeline(item) {
    var trackId = ns.Timeline.trackDefaultFor(item.kind);
    var clip = ns.Timeline.addClip(item, trackId, ns.Render.now());
    if (!clip) {
      status("That clip can't be added (no length).");
      return;
    }
    status("Added " + item.name + " to " + clip.trackId + " at " + fmt(clip.start) + ".");
    ns.Render.redraw();
  }

  // ---------- Photo editor ----------

  function openPhoto(item) {
    state.photoItem = item;
    $("photo-empty").hidden = true;
    ns.Photo.open(item);
    setPhotoButtons(true);
    setView("photo");
    status("Editing " + item.name + ". The original file is not changed.");
  }

  function setPhotoButtons(on) {
    ["photo-compare", "photo-rotate", "photo-flip", "photo-reset", "photo-download"].forEach(function (id) {
      $(id).disabled = !on;
    });
  }

  // ---------- Timeline and preview ----------

  function selectedClip() {
    return ns.Timeline.state.selected ? ns.Timeline.byId(ns.Timeline.state.selected) : null;
  }

  function updateTimelineButtons() {
    var clip = selectedClip();
    $("btn-delete").disabled = !clip;
    $("btn-dup").disabled = !clip;
    $("transition").disabled = !clip || clip.kind === "audio";
    if (clip && clip.kind !== "audio") $("transition").value = clip.transition;
    var vol = $("audio-volume");
    var isAudio = Boolean(clip && clip.kind === "audio");
    vol.disabled = !isAudio;
    if (isAudio) vol.value = Math.round(clip.volume * 100);
    $("btn-undo").disabled = !ns.Timeline.state.past.length;
    $("btn-redo").disabled = !ns.Timeline.state.future.length;
    $("btn-export").disabled = ns.Timeline.timelineEnd() <= 0 || state.exporting;
  }

  function updateTimecode(t) {
    $("timecode").textContent = fmt(t) + " / " + fmt(ns.Timeline.timelineEnd());
    $("btn-play").textContent = ns.Render.isPlaying() ? "Pause" : "Play";
    $("preview-empty").hidden = ns.Timeline.timelineEnd() > 0;
  }

  function splitAtPlayhead() {
    var n = ns.Timeline.splitAt(ns.Render.now(), null);
    status(n ? "Split " + n + " clip(s) at " + fmt(ns.Render.now()) + "." : "Nothing to split here. Move the playhead inside a clip.");
    ns.Render.redraw();
  }

  // ---------- Inspector ----------

  function slider(label, min, max, step, value, onInput) {
    var row = document.createElement("div");
    row.className = "adjust";
    var l = document.createElement("label");
    l.textContent = label;
    var input = document.createElement("input");
    input.type = "range";
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = value;
    var out = document.createElement("output");
    out.textContent = value;
    input.addEventListener("input", function () {
      out.textContent = input.value;
      onInput(input.value);
    });
    row.appendChild(l);
    row.appendChild(input);
    row.appendChild(out);
    return row;
  }

  function heading(text) {
    var p = document.createElement("p");
    p.className = "muted";
    p.textContent = text;
    return p;
  }

  function renderInspector() {
    var body = $("inspector-body");
    body.innerHTML = "";

    if (state.view === "photo" && state.photoItem) {
      var ps = ns.Photo.getState();
      body.appendChild(heading("Adjust " + state.photoItem.name));
      body.appendChild(slider("Exposure (EV)", -2, 2, 0.05, ps.adjust.exposure, function (v) { ns.Photo.set("exposure", v); }));
      body.appendChild(slider("Contrast", -100, 100, 1, ps.adjust.contrast, function (v) { ns.Photo.set("contrast", v); }));
      body.appendChild(slider("Saturation", -100, 100, 1, ps.adjust.saturation, function (v) { ns.Photo.set("saturation", v); }));
      return;
    }

    var clip = selectedClip();
    if (clip && state.view === "video") {
      var media = ns.Media.items.filter(function (m) { return m.id === clip.mediaId; })[0];
      body.appendChild(heading(media ? media.name : "Clip"));
      var lines = [
        "Track: " + clip.trackId,
        "Starts at: " + fmt(clip.start),
        "Length: " + fmt(clip.duration),
        "Source in-point: " + fmt(clip.inPoint)
      ];
      lines.forEach(function (text) {
        var p = document.createElement("p");
        p.textContent = text;
        body.appendChild(p);
      });
      if (clip.kind !== "audio") {
        body.appendChild(heading("Transition at the start of this clip"));
        var sel = document.createElement("p");
        sel.textContent = "Use the Transition menu below the timeline.";
        body.appendChild(sel);
      }
      return;
    }

    var item = state.selectedMedia ? ns.Media.items.filter(function (m) { return m.id === state.selectedMedia; })[0] : null;
    if (item) {
      body.appendChild(heading(item.name));
      mediaMeta(item).forEach(function (line) {
        var p = document.createElement("p");
        p.textContent = line;
        body.appendChild(p);
      });
      return;
    }

    body.appendChild(heading("Select a media item or a clip."));
  }

  // ---------- Audio studio ----------

  function drawWave() {
    var canvas = $("wave-canvas");
    var c = canvas.getContext("2d");
    var rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(300, Math.round(rect.width || 600));
    canvas.height = 160;
    c.clearRect(0, 0, canvas.width, canvas.height);
    var clip = selectedClip();
    var media = clip ? ns.Media.items.filter(function (m) { return m.id === clip.mediaId; })[0] : null;
    if (!media || !media.peaks) {
      c.fillStyle = "#8a909c";
      c.fillText("Select an audio clip on A1 to see its waveform.", 12, 24);
      return;
    }
    var grad = c.createLinearGradient(0, 0, canvas.width, 0);
    grad.addColorStop(0, "#4f8cff");
    grad.addColorStop(1, "#8b5cf6");
    c.fillStyle = grad;
    var n = media.peaks.length;
    var bw = canvas.width / n;
    for (var i = 0; i < n; i++) {
      var h = Math.max(2, media.peaks[i] * (canvas.height - 20));
      c.fillRect(i * bw, (canvas.height - h) / 2, Math.max(1, bw - 1), h);
    }
  }

  // ---------- Export ----------

  function runExport() {
    if (state.exporting) return;
    var parts = $("export-size").value.split("x");
    var mbps = Number($("export-bitrate").value) || 6;
    var secs = ns.Timeline.timelineEnd();
    state.exporting = true;
    updateTimelineButtons();
    $("export-link").hidden = true;
    $("export-status").textContent = "Starting…";
    status("Exporting. This plays the timeline in real time.");

    ns.Export.run({
      width: Number(parts[0]),
      height: Number(parts[1]),
      mbps: mbps,
      onProgress: function (pct, now) {
        $("export-status").textContent = "Rendering " + Math.round(pct * 100) + "% (" + fmt(now) + " of " + fmt(secs) + ")";
      }
    }).then(function (res) {
      state.exporting = false;
      var link = $("export-link");
      link.href = res.url;
      link.hidden = false;
      $("export-status").textContent = "Done: " + ns.Media.formatBytes(res.size) + " (bitrate estimate was " + ns.Media.formatBytes(ns.Export.estimateBytes(secs, mbps)) + ").";
      status("Export ready.");
      updateTimelineButtons();
    }, function (err) {
      state.exporting = false;
      $("export-status").textContent = err.message;
      status(err.message);
      updateTimelineButtons();
    });
  }

  // ---------- Wiring ----------

  function wire() {
    document.querySelectorAll(".nav-item[data-view]").forEach(function (b) {
      b.addEventListener("click", function () { setView(b.dataset.view); });
    });

    $("btn-import").addEventListener("click", function () { $("file-input").click(); });
    $("file-input").addEventListener("change", function (e) {
      importFiles(e.target.files);
      e.target.value = "";
    });

    var drop = $("drop");
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); });
    });
    drop.addEventListener("drop", function (e) { importFiles(e.dataTransfer.files); });

    // Photo
    $("photo-rotate").addEventListener("click", function () { ns.Photo.rotate(); });
    $("photo-flip").addEventListener("click", function () { ns.Photo.flip(); });
    $("photo-reset").addEventListener("click", function () { ns.Photo.reset(); renderInspector(); });
    var cmp = $("photo-compare");
    cmp.addEventListener("pointerdown", function () { ns.Photo.setComparing(true); });
    ["pointerup", "pointerleave"].forEach(function (ev) {
      cmp.addEventListener(ev, function () { ns.Photo.setComparing(false); });
    });

    $("photo-download").addEventListener("click", function () {
      ns.Photo.exportPng().then(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = (state.photoItem ? state.photoItem.name.replace(/\.[^.]+$/, "") : "photo") + "-edit.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
        status("PNG downloaded. The original file is unchanged.");
      }, function (err) { status(err.message); });
    });

    // Video
    $("btn-play").addEventListener("click", function () { ns.Render.toggle(); });
    $("btn-to-start").addEventListener("click", function () { ns.Render.pause(); ns.Render.seek(0); });
    $("zoom").addEventListener("input", function (e) { ns.Timeline.setZoom(e.target.value); });
    $("btn-split").addEventListener("click", splitAtPlayhead);
    $("btn-delete").addEventListener("click", function () {
      var clip = selectedClip();
      if (clip) ns.Timeline.deleteClip(clip.id);
    });
    $("btn-dup").addEventListener("click", function () {
      var clip = selectedClip();
      if (clip) ns.Timeline.duplicateClip(clip.id);
    });
    $("transition").addEventListener("change", function (e) {
      var clip = selectedClip();
      if (clip) ns.Timeline.setTransition(clip.id, e.target.value);
    });
    $("snap").addEventListener("change", function (e) { ns.Timeline.state.snap = e.target.checked; });

    $("btn-undo").addEventListener("click", function () { ns.Timeline.undo(); ns.Render.redraw(); });
    $("btn-redo").addEventListener("click", function () { ns.Timeline.redo(); ns.Render.redraw(); });

    // Audio
    $("audio-volume").addEventListener("input", function (e) {
      var clip = selectedClip();
      if (clip && clip.kind === "audio") ns.Timeline.setVolume(clip.id, Number(e.target.value) / 100);
    });

    // Export
    $("btn-export").addEventListener("click", runExport);

    // Keyboard
    document.addEventListener("keydown", function (e) {
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); ns.Timeline.undo(); ns.Render.redraw(); return; }
      if (mod && ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y")) { e.preventDefault(); ns.Timeline.redo(); ns.Render.redraw(); return; }
      if (e.key === " " && state.view === "video") { e.preventDefault(); ns.Render.toggle(); return; }
      if (e.key.toLowerCase() === "s" && state.view === "video") { splitAtPlayhead(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && state.view === "video") {
        var clip = selectedClip();
        if (clip) { e.preventDefault(); ns.Timeline.deleteClip(clip.id); }
        return;
      }
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && state.view === "video") {
        e.preventDefault();
        var step = 1 / 30;
        ns.Render.pause();
        ns.Render.seek(ns.Render.now() + (e.key === "ArrowLeft" ? -step : step));
      }
    });
  }

  function start() {
    var preview = $("preview-canvas");
    preview.hidden = false;
    $("preview-video").hidden = true;
    ns.Render.setCanvas(preview);
    ns.Render.setSize(1280, 720);
    ns.Photo.setCanvas($("photo-canvas"));

    ns.Timeline.init({ ruler: $("ruler"), tracks: $("tracks") });
    ns.Timeline.onChange(function () {
      updateTimelineButtons();
      updateTimecode(ns.Render.now());
      renderInspector();
      // Seek, not just redraw: this loads the media for the frame under the playhead.
      if (!ns.Render.isPlaying()) ns.Render.seek(ns.Render.now());
      if (state.view === "audio") drawWave();
    });
    ns.Render.onTick(updateTimecode);
    ns.Render.onTick(function () { ns.Timeline.movePlayhead(ns.Render.now()); });

    wire();
    renderLibrary();
    renderInspector();
    updateTimelineButtons();
    updateTimecode(0);
    setPhotoButtons(false);
    setView("media");
    window.addEventListener("resize", function () { if (state.view === "audio") drawWave(); });
  }

  ns.App = { start: start };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})(window.Studio = window.Studio || {});
