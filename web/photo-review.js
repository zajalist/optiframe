// The Photo view deliberately stays in original camera pixels. It must never
// place millimetre dimensions or a rectified contour over an unwarped photo.
export function photoReviewLayout(contour, width, height, {maxSide = 1200, padding = 0.12} = {}) {
  if (!Array.isArray(contour) || contour.length < 3 || !contour.every(point =>
    Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)) ||
    ![width, height, maxSide].every(value => Number.isFinite(value) && value > 0) ||
    !Number.isFinite(padding) || padding < 0) throw new Error('Invalid photo review geometry');
  const xs = contour.map(point => point[0]), ys = contour.map(point => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  if (minX < 0 || minY < 0 || maxX > width || maxY > height || maxX <= minX || maxY <= minY)
    throw new Error('Lens outline falls outside the photo');
  const padX = (maxX - minX) * padding, padY = (maxY - minY) * padding;
  const left = Math.max(0, Math.floor(minX - padX)), top = Math.max(0, Math.floor(minY - padY));
  const cropWidth = Math.min(width, Math.ceil(maxX + padX)) - left;
  const cropHeight = Math.min(height, Math.ceil(maxY + padY)) - top;
  const scale = Math.min(1, maxSide / Math.max(cropWidth, cropHeight));
  const outputWidth = Math.max(1, Math.round(cropWidth * scale));
  const outputHeight = Math.max(1, Math.round(cropHeight * scale));
  // Independent pixel rounding is shared by the image draw and every point.
  const scaleX = outputWidth / cropWidth, scaleY = outputHeight / cropHeight;
  return {crop: [left, top, cropWidth, cropHeight], width: outputWidth, height: outputHeight,
    contour: contour.map(([x, y]) => [(x - left) * scaleX, (y - top) * scaleY])};
}
