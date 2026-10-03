# Multi-mode lens capture experiment

**Goal:** test whether phone parallax and depth can recover a useful 3D point cloud of a transparent lens edge, while retaining a measured 2D contour as an independent reference. The winner is the mode that helps the printed rim fit; a dense-looking cloud alone does not pass.

Status: research-backed experiment design, **not tested on physical lenses yet**. SiteSplat was inspected as a reference and is not a dependency of OptiFrame.

## Platform facts

- **Android web:** Chrome WebXR uses ARCore on supported Android devices. Google lists WebXR Depth Sensing as shipped, and the web API can return CPU depth for an active XR frame. The device needs ARCore support, Google Play Services for AR, depth capability, and HTTPS or localhost. [Google WebXR/ARCore comparison](https://developers.google.com/ar/develop/webxr/arcore-comparison), [WebXR depth API](https://developer.mozilla.org/en-US/docs/Web/API/XRFrame/getDepthInformation), [Google requirements](https://developers.google.com/ar/develop/webxr/requirements)
- **Android native:** ARCore Raw Depth returns a sparse depth image plus per-pixel confidence; its full depth map fills pixels through smoothing/interpolation. A native test app has better access to raw quality signals, but is an extra delivery format. [Google Raw Depth](https://developers.google.com/ar/develop/java/depth/raw-depth)
- **iPhone web:** Safari can show a USDZ AR preview, but does not expose ARKit scene depth to a normal web page. Capture from ordinary photos still works on iPhone. [Apple ARKit depth sample](https://developer.apple.com/documentation/ARKit/displaying-a-point-cloud-using-scene-depth), [Apple AR Quick Look](https://developer.apple.com/documentation/arkit/previewing-a-model-with-ar-quick-look)
- **Depth range:** Google reports best depth results at roughly 0.5–5 m and says moving the phone improves depth-from-motion. That is evidence for testing parallax, not a guarantee for a small transparent lens. [Google ARCore Depth](https://developers.google.com/ar/develop/depth)

## Shared low-cost rig and ground truth

Use the same marked lens and scale object in every mode. For top-view contour capture, place the lens on the printed marker sheet. For depth/multi-view capture, hold it **upright** in a simple stand with minimal edge clips, with a patterned fiducial board behind it at a measured offset. The separation gives depth algorithms a chance to distinguish lens from background. Keep the board and lens fixed while moving the phone. Measure the lens's maximum width/height, several edge thicknesses, and side-view bow with calipers/ruler; save a 1:1 paper contour and a physical rim coupon for final checks.

Test at least: one clear lens, one coated or tinted lens if available, and an asymmetric pair. Repeat each scan after resetting the phone and lens. Label all points from the background board separately so a good-looking board scan cannot count as a lens scan.

## Mode A — calibrated photo contour (control)

Top-down high-resolution image with four known-position markers; optionally compare empty and lens-on-sheet images or use oblique edge lighting. Extract and edit the perimeter in millimetres. Record side thickness and bow separately. This gives the best available **reference XY boundary** and a fallback for all phones. Full algorithm: [lens-capture-pipeline.md](lens-capture-pipeline.md).

## Mode B — Android WebXR depth cloud

On a supported Android phone in Chrome, request `immersive-ar` with `depth-sensing` and CPU-optimized depth. Move around the fixed upright lens in a short arc at roughly 0.5–1 m, capturing depth and viewer pose from many frames. Back-project depth pixels with the per-view projection data, transform them into one board-relative coordinate frame, crop to the known lens volume, and fuse spatially consistent samples into a point cloud. Keep the raw per-frame depth images so background leakage and view disagreement are visible. Compare an empty-stand scan with a lens-in-stand scan.

**Failure signal:** depth mostly follows the patterned board or returns no stable points on the lens edge. WebXR's depth result should not be treated as a ground-truth lens surface simply because it contains points. Transparent-object RGB-D research reports missing or background depth caused by transmission/refraction. [WebXR depth API](https://developer.mozilla.org/en-US/docs/Web/API/XRFrame/getDepthInformation), [transparent-object depth research](https://arxiv.org/abs/2104.00622)

## Mode C — multi-view silhouette point cloud

Take a set of still images from different elevations and angles around the same fixed upright lens. Recover camera pose from known markers on the rigid board, rather than from features visible *through* the lens. For each view, mark the lens's outer silhouette or edge using the controlled background and allow correction. Intersect the back-projected silhouette cones in a small voxel volume (a **visual hull**), then sample its surface as a point cloud. This is a true multi-view geometric reconstruction, but its accuracy depends on camera calibration and especially silhouette quality. Thin lenses and a limited arc may yield a thick or coarse hull. [Visual-hull method](https://publications.ri.cmu.edu/visual-hull-construction-alignment-and-refinement-across-time), [transparent-object depth + silhouette fusion](https://onlinelibrary.wiley.com/doi/10.1155/2017/9796127), [OpenCV marker-board pose](https://github.com/opencv/opencv/blob/5.x/doc/tutorials/objdetect/aruco_board_detection/aruco_board_detection.markdown)

This mode remains a normal mobile-web flow: upload/capture photos in the page, process locally or on a backend, and show the cloud in the browser. It does not require ARKit or ARCore.

## Mode D — parallax reconstruction / splat backend

Feed the same multi-angle images into SiteSplat or another reconstruction backend, with camera/scale marker data when supported. Export **points or a mesh**, not just a Gaussian-splat visualization. Compare its rim samples against Modes A–C. Standard feature matching through a refractive lens may attach to the background or reflections, so inspect reprojections and the raw cloud before using it for CAD. A glass-digitization study reported standard COLMAP/Metashape failing during image matching on transparent test objects; specialized transparent-object methods use silhouette and refraction constraints. [ISPRS transparent-object reconstruction experiment](https://isprs-archives.copernicus.org/articles/XLVIII-2-W2-2022/77/2022/isprs-archives-XLVIII-2-W2-2022-77-2022.pdf), [transparent-object reconstruction research](https://arxiv.org/abs/1805.03482)

**SiteSplat assessment:** its capture contract includes metric ARKit/ARCore poses and camera calibration, and its backend can expose sparse points. Its large-scene GPU pipeline, reconstruction time, and scene-scale validation thresholds are not suitable as OptiFrame's lens measurement core. The product will use its own compact capture format and point-cloud tests. Do not assume that a photorealistic splat produces a dimensional mesh. [SiteSplat backend](https://github.com/ProjectLogistics/sitesplat-backend) (private repository)

## Comparison and selection

| Metric | How to check | Go/no-go interpretation |
| --- | --- | --- |
| Scale | Known board distance and caliper width/height | Reject any cloud that needs arbitrary hand scaling. |
| Rim coverage | Divide perimeter into equal angular sectors; count sectors with nearby stable points | Gaps show that the cloud cannot drive the whole rim. |
| Repeatability | Repeat the capture; align by the board, not by hand; compare corresponding rim areas | Large changes imply view-dependent reflections/background points. |
| Boundary error | Project cloud/hull back into each original image; compare with edited silhouette and 1:1 paper contour | A pretty cloud with the wrong outline loses. |
| Side geometry | Compare recovered edge thickness/bow with calipers and side photo | Use cloud Z only where it beats or corroborates these measurements. |
| Physical fit | Print a short rim coupon generated from candidate geometry | The deciding test for printable frame geometry. |
| Cost and coverage | Note capture time, processing time, required device, and failures | Prefer the simplest mode that passes on the phones the team has. |

**Proposed decision gate:** aim for repeated width/height within 0.5 mm and a rim coupon that seats the lens without force or slip. These are design targets, not claims of phone-scanner accuracy. If a cloud misses a perimeter sector or disagrees with the photo contour, fuse **Mode A's XY contour** with any trustworthy **Mode B/C/D depth or bow**. Keep the point cloud as visible evidence and store its uncertainty; do not force every cloud point into the printable CAD path.

## Fast experiment order

1. Capture one lens in Mode A and create the caliper/paper reference.
2. Run Mode B on an actual supported Android phone; view raw depth and board-relative cloud before building meshing code.
3. Run Mode C from the same upright setup if silhouettes are visible.
4. Run Mode D through SiteSplat once its repository and deployment requirements are known.
5. Print one small coupon from the best geometry. Record actual numbers and failed attempts in [validation.md](validation.md).
