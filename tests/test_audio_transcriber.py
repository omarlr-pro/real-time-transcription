import io
import unittest
import wave
from unittest.mock import patch

import speech_recognition as sr

from audio_transcriber import transcribe_audio


def _silent_wav() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as audio_file:
        audio_file.setnchannels(1)
        audio_file.setsampwidth(2)
        audio_file.setframerate(16000)
        audio_file.writeframes(bytes(32000))
    return buffer.getvalue()


class AudioTranscriberTests(unittest.TestCase):
    def test_decodes_audio_and_returns_provider_transcription(self):
        with patch.object(
            sr.Recognizer,
            "recognize_google",
            return_value="recognized words",
        ) as recognize:
            result = transcribe_audio(_silent_wav())

        self.assertEqual(result, "recognized words")
        recognize.assert_called_once()

    def test_rejects_empty_audio(self):
        with self.assertRaisesRegex(ValueError, "empty"):
            transcribe_audio(b"")

    def test_rejects_unsupported_audio(self):
        with self.assertRaises(ValueError):
            transcribe_audio(b"not audio data")

    def test_propagates_recognition_service_errors(self):
        error = sr.RequestError("network unavailable")
        with patch.object(sr.Recognizer, "recognize_google", side_effect=error):
            with self.assertRaises(sr.RequestError):
                transcribe_audio(_silent_wav())


if __name__ == "__main__":
    unittest.main()
