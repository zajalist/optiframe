"""CPU-only regression benchmark: a weak rim with a stronger offset shadow.

Run: python gpu/benchmark_shadow_selection.py [--image output.png]
Prints a JSON report. This is a diagnostic benchmark, not a passing unit test,
and pixel errors on this synthetic scene do not establish physical accuracy.
"""
import argparse
import json
import time

import cv2
import numpy as np

from edge_refine import refine_lens_edge, _distance_to_loop


def benchmark(offset=(10, 8), blur=1.5, strength=95):
    angles = np.arange(256) * 2 * np.pi / 256
    truth = np.column_stack([160+100*np.cos(angles), 140+75*np.sin(angles)])
    # Simulate a SAM proposal that already contains some of the offset shadow.
    raw = np.column_stack([166+102*np.cos(angles), 144+77*np.sin(angles)])
    shadow = np.zeros((280, 320), np.uint8)
    cv2.ellipse(shadow, (160+offset[0], 140+offset[1]), (100, 75), 0, 0, 360, strength, -1)
    shadow = cv2.GaussianBlur(shadow, (0, 0), blur)
    photo = np.repeat((220-shadow)[:, :, None], 3, axis=2)
    cv2.ellipse(photo, (160, 140), (100, 75), 0, 0, 360, (155, 155, 155), 1, cv2.LINE_AA)
    started = time.perf_counter()
    contour, diagnostics = refine_lens_edge(photo, raw)
    elapsed = (time.perf_counter()-started)*1000
    errors = _distance_to_loop(np.asarray(contour), truth)
    report = {
        'case': 'weaker-transparent-rim-with-stronger-offset-shadow',
        'parameters': {'shadowOffset': offset, 'shadowBlurSigma': blur, 'shadowStrength': strength},
        'refinementMs': elapsed,
        'scope': 'Synthetic pixel geometry; not physical measurement accuracy.',
        'distanceMetric': 'sampled-proposal-points-to-ground-truth-polygon-segments',
        'accepted': diagnostics['accepted'],
        'meanBoundaryErrorPx': float(np.mean(errors)),
        'medianBoundaryErrorPx': float(np.median(errors)),
        'p95BoundaryErrorPx': float(np.percentile(errors, 95)),
        'maxBoundaryErrorPx': float(np.max(errors)),
        'diagnostics': diagnostics,
    }
    return report, photo, truth, contour


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', help='Optional comparison image output path.')
    parser.add_argument('--matrix', action='store_true', help='Run 48 shadow strength, blur and displacement cases.')
    args = parser.parse_args()
    if args.matrix:
        reports = [benchmark(offset, blur, strength)[0] for blur in (.7, 1.5, 3., 5.)
                   for strength in (40, 70, 95, 125) for offset in ((5, 4), (10, 8), (14, 10))]
        accepted = [row for row in reports if row['accepted']]
        print(json.dumps({'cases': len(reports), 'accepted': len(accepted),
                          'acceptedAbove3pxP95': sum(row['p95BoundaryErrorPx'] > 3 for row in accepted),
                          'medianRefinementMs': float(np.median([row['refinementMs'] for row in reports])),
                          'scope': 'Synthetic pixel geometry only; rejected contours are not measurements.',
                          'reports': reports}, indent=2))
        raise SystemExit(0)
    report, photo, truth, contour = benchmark()
    print(json.dumps(report, indent=2))
    if args.image:
        panels = []
        for label, points, colour in [('SYNTHETIC PHOTO', None, None),
                                      ('KNOWN RIM', truth, (0, 180, 0)),
                                      ('CURRENT PROPOSAL', contour, (255, 100, 0))]:
            panel = photo.copy()
            if points is not None:
                cv2.polylines(panel, [np.round(points).astype(np.int32)], True, colour, 1, cv2.LINE_AA)
            cv2.putText(panel, label, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, .55, (0, 0, 0), 1, cv2.LINE_AA)
            panels.append(panel)
        if not cv2.imwrite(args.image, np.hstack(panels)):
            raise OSError('Could not write comparison image')
