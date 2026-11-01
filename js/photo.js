/*
 * Photo editor. Works on a copy of the image: the original file and the
 * decoded source are never changed. Each adjustment is applied to pixels
 * from the source every time, so reset always returns to the original.
 */
(function (ns) {
  "use strict";

  var PREVIEW_MAX = 2000;

  var state = {
    item: null,       // media item being edited
    adjust: { exposure: 0, contrast: 0, saturation: 0 },
    rotation: 0,      // 0, 90, 180, 270
    flip: false,
    comparing: false
  };

  var canvas = null;

  function setCanvas(c) { canvas = c; }

  function baseSize(img) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    var rotated = state.rotation === 90 || state.rotation === 270;
    return rotated ? { w: h, h: w } : { w: w, h: h };
  }

  // Draws the image with rotation and flip applied, at the given scale.
  function drawTransformed(ctx, img, scale, w, h) {
    var iw = (img.naturalWidth || img.width) * scale;
    var ih = (img.naturalHeight || img.height) * scale;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate((state.rotation * Math.PI) / 180);
    if (state.flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
    ctx.restore();
  }

  // Applies exposure, contrast and saturation to every pixel in place.
  function applyAdjustments(imageData) {
    var d = imageData.data;
    var exp = Math.pow(2, state.adjust.exposure);
    var c = 1 + state.adjust.contrast / 100;
    var s = 1 + state.adjust.saturation / 100;
    var noop = exp === 1 && c === 1 && s === 1;
    if (noop) return imageData;
    for (var i = 0; i < d.length; i += 4) {
      var r = d[i] * exp;
      var g = d[i + 1] * exp;
      var b = d[i + 2] * exp;
      r = (r - 128) * c + 128;
      g = (g - 128) * c + 128;
      b = (b - 128) * c + 128;
      var gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray + (r - gray) * s;
      g = gray + (g - gray) * s;
      b = gray + (b - gray) * s;
      d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
    return imageData;
  }

  function render() {
    if (!canvas || !state.item || !state.item.element) return;
    var img = state.item.element;
    var size = baseSize(img);
    var scale = Math.min(1, PREVIEW_MAX / Math.max(size.w, size.h));
    var w = Math.max(1, Math.round(size.w * scale));
    var h = Math.max(1, Math.round(size.h * scale));
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d", { willReadFrequently: true });

    if (state.comparing) {
      ctx.clearRect(0, 0, w, h);
      drawTransformed(ctx, img, scale, w, h);
      return;
    }
    ctx.clearRect(0, 0, w, h);
    drawTransformed(ctx, img, scale, w, h);
    var data = ctx.getImageData(0, 0, w, h);
    ctx.putImageData(applyAdjustments(data), 0, 0);
  }

  function open(item) {
    state.item = item;
    state.adjust = { exposure: 0, contrast: 0, saturation: 0 };
    state.rotation = 0;
    state.flip = false;
    state.comparing = false;
    render();
  }

  function set(key, value) {
    if (!(key in state.adjust)) return;
    state.adjust[key] = Number(value) || 0;
    render();
  }

  function rotate() {
    state.rotation = (state.rotation + 90) % 360;
    render();
  }

  function flip() {
    state.flip = !state.flip;
    render();
  }

  function reset() {
    state.adjust = { exposure: 0, contrast: 0, saturation: 0 };
    state.rotation = 0;
    state.flip = false;
    state.comparing = false;
    render();
  }

  function setComparing(on) {
    state.comparing = Boolean(on);
    render();
  }

  // Full-resolution export of the current edit, as a PNG blob.
  function exportPng() {
    return new Promise(function (resolve, reject) {
      if (!state.item || !state.item.element) return reject(new Error("No photo open."));
      var img = state.item.element;
      var size = baseSize(img);
      var out = document.createElement("canvas");
      out.width = size.w;
      out.height = size.h;
      var ctx = out.getContext("2d", { willReadFrequently: true });
      drawTransformed(ctx, img, 1, size.w, size.h);
      var data = ctx.getImageData(0, 0, size.w, size.h);
      ctx.putImageData(applyAdjustments(data), 0, 0);
      out.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error("The browser couldn't encode this image."));
      }, "image/png");
    });
  }

  function getState() {
    return { item: state.item, adjust: state.adjust, rotation: state.rotation, flip: state.flip };
  }

  ns.Photo = {
    setCanvas: setCanvas,
    open: open,
    set: set,
    rotate: rotate,
    flip: flip,
    reset: reset,
    setComparing: setComparing,
    exportPng: exportPng,
    getState: getState
  };
})(window.Studio = window.Studio || {});
