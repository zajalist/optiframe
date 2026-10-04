# Optional alignment for prototype frames

The guided fitting flow supports **Skip for prototype** on the lens-marking step. This deliberately substitutes a geometric centre and image-based top direction for missing provider marks. Neither is an inferred optical measurement.

Approximate alignment is carried on the panel and through transfers to the advanced studio. It permits an explicitly experimental fit-test kit; checked export remains unavailable until the actual optical-centre and orientation marks have both been placed. Choosing another view or opening the advanced page must not erase this provenance.

The frame API accepts `settings.alignment_source` as `illustrative`, `provider-marked`, or `unspecified`. Preview JSON returns `alignmentSource`; ZIP `README.json` includes `alignment_source` and `alignment_warning`. Omitted provenance is `unspecified`, never automatically provider-marked. Even provider-marked is an operator assertion, not independent optical verification.

The marking view enlarges the actual lens image and preserves image coordinates when dragging. Fine single-pixel adjustment is optional. Thickness diagrams react to independently entered left/right edge thicknesses; they do not infer lens curvature. The Higgsfield caliper image is an instructional illustration (job `bed80a3a-351f-4e30-b5a4-1ad37fc761a7`), not a captured measurement.
