import io
import math
import unittest
from zipfile import ZipFile

import trimesh

from frame import Settings, generate


def ellipse(rx, ry, count=96):
    return [[rx * math.cos(2 * math.pi * i / count),
             ry * math.sin(2 * math.pi * i / count)] for i in range(count)]


class FrameTests(unittest.TestCase):
    def test_asymmetric_kit_has_watertight_parts(self):
        archive_bytes, notes = generate(ellipse(25, 19), ellipse(23, 17),
                                        Settings(32, 31, 2.5, 125))
        self.assertTrue(notes["bedFit"])
        with ZipFile(io.BytesIO(archive_bytes)) as archive:
            for part in notes["parts"]:
                mesh = trimesh.load(io.BytesIO(archive.read(f"{part}.stl")), file_type="stl")
                self.assertTrue(mesh.is_watertight, part)
                self.assertGreater(mesh.volume, 0, part)

    def test_overlapping_lenses_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "overlap"):
            generate(ellipse(27, 20), ellipse(27, 20), Settings(24, 24, 2, 125))


if __name__ == "__main__":
    unittest.main()
