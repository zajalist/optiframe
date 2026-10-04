// Illustrative display coordinates only; never used for wearer measurements.
export function pupilGeometry(value, side) {
  const mm = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  const valid = Number.isFinite(mm) && mm >= 20 && mm <= 40;
  // Frontal view: the wearer's left is on the viewer's right.
  const direction = side === 'left' ? 1 : -1;
  const x = 160 + direction * (valid ? mm : 32) * 2;
  return { valid, x, middle: (160 + x) / 2, label: valid ? `${Number(mm.toFixed(1))} mm` : '' };
}
