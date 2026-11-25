import unittest
from pathlib import Path

from streamlit.testing.v1 import AppTest


class ApplicationRenderTests(unittest.TestCase):
    def test_existing_and_live_transcription_tabs_render(self):
        app_path = Path(__file__).resolve().parents[1] / "app.py"
        app = AppTest.from_file(str(app_path)).run(timeout=15)

        self.assertEqual(len(app.exception), 0)
        self.assertEqual(
            [tab.label for tab in app.tabs],
            ["Recorded audio", "Live transcription"],
        )

    def test_audio_upload_source_is_available(self):
        app_path = Path(__file__).resolve().parents[1] / "app.py"
        app = AppTest.from_file(str(app_path)).run(timeout=15)

        app.radio[0].set_value("Upload an audio file").run()

        self.assertEqual(len(app.exception), 0)
        self.assertEqual(app.file_uploader[0].label, "Choose an audio file")


if __name__ == "__main__":
    unittest.main()
