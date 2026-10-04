import io
import json
import math
import unittest
from zipfile import ZipFile

from frame import Settings, generate, preview


class AlignmentProvenanceTests(unittest.TestCase):
    def test_illustrative_alignment_survives_preview_and_download(self):
        lens = [[24*math.cos(i*math.tau/96), 18*math.sin(i*math.tau/96)] for i in range(96)]
        settings = Settings(34, 34, 2, 130, alignment_source='illustrative')
        self.assertEqual(preview(lens, lens, settings)['alignmentSource'], 'illustrative')
        archive, _ = generate(lens, lens, settings)
        with ZipFile(io.BytesIO(archive)) as files:
            notes = json.loads(files.read('README.json'))
        self.assertEqual(notes['alignment_source'], 'illustrative')
        self.assertIn('prototype only', notes['alignment_warning'])
        self.assertIn('experimental', notes['status'])

    def test_unknown_alignment_label_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'alignment source'):
            preview([], [], Settings(34, 34, 2, 130, alignment_source='certified'))


if __name__ == '__main__':
    unittest.main()
