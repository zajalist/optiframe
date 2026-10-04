import io
import json
import unittest
from pathlib import Path
from zipfile import ZipFile

import trimesh

from frame import Settings, FRAME_STYLES, build_parts, generate, preview, _extrude
from clip_retention import clip_fit_coupon, UNDER_CLEARANCE
from test_frame import ellipse, bed_contact_area


class DirectClipTests(unittest.TestCase):
    def test_actual_scanned_pair_all_styles_has_clear_integral_clips(self):
        fixture = json.loads((Path(__file__).parent/"fixtures/scanned-lens-outlines.json").read_text())
        for style in FRAME_STYLES:
            with self.subTest(style=style):
                settings = Settings(**dict(fixture["settings"], frame_style=style, retention_style="clip"))
                parts, lenses, notes = build_parts(fixture["left"], fixture["right"], settings)
                self.assertEqual(set(parts), {"front", "left-temple", "right-temple", "left-hinge-snap-pin", "right-hinge-snap-pin"})
                front = parts["front"]
                self.assertEqual(len(front.metadata["directClipPaths"]), 8)
                self.assertEqual(len(front.split()), 1)
                for mesh in parts.values():
                    self.assertTrue(mesh.is_watertight)
                for lens, thickness in zip(lenses, settings.edge_thicknesses()):
                    overlap = trimesh.boolean.intersection([front, _extrude(lens, thickness, 2.15)], engine="manifold")
                    self.assertTrue(overlap.is_empty or abs(overlap.volume)<1e-5)
                for path in front.metadata["directClipPaths"]:
                    x,y=path["slot_point"];rear=path["rear_z"]
                    for z, occupied in ((rear+UNDER_CLEARANCE/2, False), (rear+UNDER_CLEARANCE+.7, True)):
                        probe=trimesh.creation.box([.12,.12,.12]);probe.apply_translation([x,y,z])
                        overlap=trimesh.boolean.intersection([front,probe],engine="manifold")
                        self.assertEqual(not overlap.is_empty and abs(overlap.volume)>1e-5, occupied)
                names=list(parts)
                for i,name in enumerate(names):
                    for other in names[i+1:]:
                        overlap=trimesh.boolean.intersection([parts[name],parts[other]],engine="manifold")
                        self.assertTrue(overlap.is_empty or abs(overlap.volume)<1e-5, f"{name}/{other}")
                data,_=generate(fixture["left"],fixture["right"],settings)
                with ZipFile(io.BytesIO(data)) as archive:
                    self.assertEqual(len([n for n in archive.namelist() if n.endswith('.stl')]),8)
                    for name in archive.namelist():
                        if name.endswith('.stl'):
                            self.assertTrue(trimesh.load(io.BytesIO(archive.read(name)),file_type='stl').is_watertight,name)
                    plate=trimesh.load(io.BytesIO(archive.read('plate.stl')),file_type='stl')
                    self.assertEqual(len(plate.split()),7)
                    for piece in plate.split():
                        self.assertGreater(bed_contact_area(piece),15)
                result=preview(fixture['left'],fixture['right'],settings)
                self.assertFalse(any('coupon' in p['name'] for p in result['meshes']))
                self.assertIn('not physically validated',notes['status'])

    def test_independent_thickness_coupons_are_closed_at_supported_extremes(self):
        for thickness in (1,6):
            mesh=clip_fit_coupon(thickness)
            self.assertTrue(mesh.is_watertight)
            self.assertEqual(len(mesh.split()),1)
            self.assertAlmostEqual(mesh.bounds[0,2],0)
            self.assertAlmostEqual(mesh.bounds[1,2],2+thickness+.3+.6+1.4,places=5)
        parts,_,_=build_parts(ellipse(25,19),ellipse(23,17),Settings(33,33,2.5,125,left_edge_thickness=1,right_edge_thickness=6,retention_style='clip'))
        depths={round(p['rear_z'],1) for p in parts['front'].metadata['directClipPaths']}
        self.assertEqual(depths,{3.3,8.3})


if __name__=='__main__':
    unittest.main()
