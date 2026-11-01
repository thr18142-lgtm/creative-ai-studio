/*
 * Export: plays the timeline once from the start and records the canvas and
 * the mixed audio with MediaRecorder. It runs in real time, so a 30 s timeline
 * takes about 30 s. Only WebM is offered, because it is what the browser
 * records reliably. The original media files are only read, never changed.
 */
(function (ns) {
  "use strict";

  var MIME_CANDIDATES = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];

  var job = null;

  function pickMime() {
    if (!window.MediaRecorder) return null;
    for (var i = 0; i < MIME_CANDIDATES.length; i++) {
      if (MediaRecorder.isTypeSupported(MIME_CANDIDATES[i])) return MIME_CANDIDATES[i];
    }
    return null;
  }

  function estimateBytes(seconds, mbps) {
    return (mbps * 1000000 / 8) * seconds;
  }

  // Starts an export. Calls onProgress(0..1, secondsDone) while running, and
  // resolves with { url, size, mime } when the file is ready.
  function run(opts) {
    if (job) return Promise.reject(new Error("An export is already running."));
    var end = ns.Timeline.timelineEnd();
    if (end <= 0) return Promise.reject(new Error("Add something to the timeline first."));
    var mime = pickMime();
    if (!mime) return Promise.reject(new Error("This browser can't record WebM. Try Chrome or Edge."));

    return new Promise(function (resolve, reject) {
      var chunks = [];
      var stream;
      var recorder;
      var stopped = false;

      ns.Render.pause();
      ns.Render.setSize(opts.width, opts.height);
      ns.Render.seek(0);
      ns.Render.ensureAudio();
      stream = ns.Render.captureStream(30);

      try {
        recorder = new MediaRecorder(stream, {
          mimeType: mime,
          videoBitsPerSecond: Math.round(opts.mbps * 1000000)
        });
      } catch (err) {
        ns.Render.setSize(1280, 720);
        return reject(new Error("The recorder couldn't start: " + err.message));
      }

      function finish(error) {
        if (stopped) return;
        stopped = true;
        removeTick();
        job = null;
        ns.Render.pause();
        ns.Render.setSize(1280, 720);
        if (error) return reject(error);
      }

      recorder.ondataavailable = function (ev) {
        if (ev.data && ev.data.size) chunks.push(ev.data);
      };

      recorder.onerror = function (ev) {
        finish(new Error("Recording failed: " + (ev.error && ev.error.message || "unknown error")));
      };

      recorder.onstop = function () {
        var blob = new Blob(chunks, { type: "video/webm" });
        finish(null);
        resolve({ url: URL.createObjectURL(blob), size: blob.size, mime: mime });
      };

      function onTick(now) {
        if (stopped) return;
        var pct = Math.min(1, now / end);
        if (opts.onProgress) opts.onProgress(pct, now);
        if (!ns.Render.isPlaying() && recorder.state === "recording") {
          recorder.stop();
        }
      }

      function removeTick() {
        ns.Render.offTick(onTick);
      }

      job = {
        cancel: function () {
          if (recorder.state === "recording") recorder.stop();
          else finish(new Error("Export cancelled."));
        }
      };

      ns.Render.onTick(onTick);
      recorder.start(1000);
      ns.Render.play();
    });
  }

  function cancel() {
    if (job) job.cancel();
  }

  ns.Export = {
    run: run,
    cancel: cancel,
    isRunning: function () { return Boolean(job); },
    estimateBytes: estimateBytes,
    pickMime: pickMime
  };
})(window.Studio = window.Studio || {});
