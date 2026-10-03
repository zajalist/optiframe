export function frameBrightness(image) {
  if (!image?.data?.length) return null;
  const values = [];
  const stride = Math.max(4, Math.ceil(image.data.length / 4096 / 4) * 4);
  for (let i = 0; i < image.data.length; i += stride)
    values.push((image.data[i] * 77 + image.data[i + 1] * 150 + image.data[i + 2] * 29) / 256);
  values.sort((a, b) => a - b);
  // A dark lens should not make the whole scene appear underexposed.
  return values[Math.floor(values.length * .8)];
}

export function createCaptureGuidance() {
  let pending = '', pendingSince = 0, current = '', slowCount = 0, nearEdge = false;
  return {
    reset() { pending = ''; pendingSince = 0; current = ''; slowCount = 0; nearEdge = false; },
    update({ calibration, width, height, quality, presence, brightness, latencyMs, now, state, minMarkerSpan = 300 }) {
      let message = '', ready = true;
      const markers = calibration?.markers;
      slowCount = latencyMs > 700 ? slowCount + 1 : 0;
      if (state === 'remove') message = 'Remove the first lens';
      else if (Number.isFinite(brightness) && brightness < 45) { message = 'Add soft light'; ready = false; }
      else if (markers?.length === 4) {
        nearEdge = markers.some(([x, y]) => x < width * .025 || x > width * .975 || y < height * .025 || y > height * .975);
        const span = Math.min(Math.hypot(markers[1][0] - markers[0][0], markers[1][1] - markers[0][1]),
          Math.hypot(markers[2][0] - markers[3][0], markers[2][1] - markers[3][1]));
        if (nearEdge) { message = 'Move back slightly'; ready = false; }
        else if (span < minMarkerSpan) { message = 'Move closer'; ready = false; }
        else if (quality?.clippedFraction > .025 && !(presence?.detected === true &&
            presence.evidence?.edgeSupport >= .64 && presence.evidence?.sectorsSupported >= 7)) {
          message = 'Soften the light'; ready = false;
        }
        else if (presence?.detected === true && quality?.sharpness < 35) { message = 'Let the camera focus'; ready = false; }
      } else {
        ready = false;
        if (nearEdge) message = 'Move back slightly';
        else if (presence?.detected === true) message = 'Show all four dots';
        else if (presence?.reason === 'background-shape') message = 'Use the capture sheet';
      }
      if (!message && slowCount >= 4) message = 'Processing slowly';
      if (!message && state === 'steady') message = 'Hold steady';
      if (message !== pending) { pending = message; pendingSince = now; }
      if (!message || state === 'remove' || now - pendingSince >= 300) current = message;
      return { message: current, ready };
    },
  };
}

export async function optimizeCameraTrack(track) {
  if (!track?.getCapabilities || !track?.applyConstraints) return;
  try {
    const capabilities = track.getCapabilities(), settings = {};
    for (const property of ['focusMode', 'exposureMode', 'whiteBalanceMode'])
      if (Array.isArray(capabilities[property]) && capabilities[property].includes('continuous')) settings[property] = 'continuous';
    if (Object.keys(settings).length) await track.applyConstraints({ advanced: [settings] });
  } catch { /* Camera defaults remain usable if a browser rejects optional controls. */ }
}
