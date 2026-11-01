/*
 * Media import: reads what the browser can tell us about each file.
 * Resolution, duration, size, audio channels and thumbnails/waveforms come
 * from the file itself. Frame rate and video codec are not exposed to web
 * pages, so they are reported as unavailable rather than guessed.
 */
(function (ns) {
  "use strict";

  var nextId = 1;
  var PEAK_COUNT = 400;

  function kindOf(file) {
    if (file.type.indexOf("image/") === 0) return "image";
    if (file.type.indexOf("video/") === 0) return "video";
    if (file.type.indexOf("audio/") === 0) return "audio";
    return null;
  }

  function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function formatSeconds(t) {
    var s = Math.max(0, Number(t) || 0);
    var m = Math.floor(s / 60);
    return String(m).padStart(2, "0") + ":" + (s - m * 60).toFixed(2).padStart(5, "0");
  }

  // Captures one frame of a video as a JPEG data URL, at the given time.
  function captureFrame(video, time) {
    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        var canvas = document.createElement("canvas");
        var w = 320;
        var h = Math.round(w * (video.videoHeight / video.videoWidth)) || 180;
        canvas.width = w;
        canvas.height = h;
        try {
          canvas.getContext("2d").drawImage(video, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.8));
        } catch (err) {
          resolve(null);
        }
      }
      video.addEventListener("seeked", finish, { once: true });
      video.currentTime = time;
      setTimeout(finish, 4000);
    });
  }

  function probeVideo(url) {
    return new Promise(function (resolve, reject) {
      var video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.src = url;
      video.onloadeddata = function () {
        var info = {
          width: video.videoWidth,
          height: video.videoHeight,
          duration: isFinite(video.duration) ? video.duration : 0
        };
        var seekTo = Math.min(0.5, info.duration / 2);
        captureFrame(video, seekTo).then(function (thumb) {
          info.thumb = thumb;
          resolve(info);
        });
      };
      video.onerror = function () { reject(new Error("This video can't be decoded by this browser.")); };
    });
  }

  function probeImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        resolve({ width: img.naturalWidth, height: img.naturalHeight, thumb: url, element: img });
      };
      img.onerror = function () { reject(new Error("This image can't be decoded by this browser.")); };
      img.src = url;
    });
  }

  // Decodes the audio to read its length, channel count and waveform peaks.
  function probeAudio(file) {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    return file.arrayBuffer().then(function (buf) {
      var ctx = new AudioCtx();
      return ctx.decodeAudioData(buf).then(function (decoded) {
        var data = decoded.getChannelData(0);
        var block = Math.max(1, Math.floor(data.length / PEAK_COUNT));
        var peaks = [];
        for (var i = 0; i < PEAK_COUNT; i++) {
          var max = 0;
          var start = i * block;
          for (var j = start; j < start + block && j < data.length; j++) {
            var v = Math.abs(data[j]);
            if (v > max) max = v;
          }
          peaks.push(max);
        }
        var info = {
          duration: decoded.duration,
          channels: decoded.numberOfChannels,
          sampleRate: decoded.sampleRate,
          peaks: peaks
        };
        ctx.close();
        return info;
      });
    });
  }

  // Imports a FileList. Returns the list of media items that were added.
  // The original File is kept as-is; nothing is written back to it.
  function importFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    var jobs = files.map(function (file) {
      var kind = kindOf(file);
      if (!kind) {
        return Promise.resolve({ error: file.name + ": this file type isn't supported." });
      }
      var url = URL.createObjectURL(file);
      var item = {
        id: "m" + nextId++,
        name: file.name,
        kind: kind,
        size: file.size,
        url: url,
        file: file,
        width: null,
        height: null,
        duration: null,
        channels: null,
        thumb: null,
        peaks: null,
        frameRate: "Not readable in browser",
        codec: kind === "audio" ? null : "Not readable in browser"
      };
      var probe;
      if (kind === "image") probe = probeImage(url);
      else if (kind === "video") probe = probeVideo(url);
      else probe = probeAudio(file);

      return probe.then(function (info) {
        if (kind === "audio") {
          item.duration = info.duration;
          item.channels = info.channels;
          item.sampleRate = info.sampleRate;
          item.peaks = info.peaks;
        } else {
          item.width = info.width;
          item.height = info.height;
          item.thumb = info.thumb;
          if (kind === "video") item.duration = info.duration;
          if (kind === "image") item.element = info.element;
        }
        return { item: item };
      }, function (err) {
        URL.revokeObjectURL(url);
        return { error: file.name + ": " + err.message };
      });
    });

    return Promise.all(jobs).then(function (results) {
      var added = [];
      var errors = [];
      results.forEach(function (r) {
        if (r.item) added.push(r.item);
        if (r.error) errors.push(r.error);
      });
      if (ns.Media) ns.Media.items = ns.Media.items.concat(added);
      return { added: added, errors: errors };
    });
  }

  ns.Media = ns.Media || { items: [] };
  ns.Media.importFiles = importFiles;
  ns.Media.formatBytes = formatBytes;
  ns.Media.formatSeconds = formatSeconds;
  ns.Media.kindOf = kindOf;
})(window.Studio = window.Studio || {});
