import io

import speech_recognition as sr

RECOGNITION_TIMEOUT_SECONDS = 15


def transcribe_audio(audio_bytes: bytes) -> str:
    if not audio_bytes:
        raise ValueError("Audio content is empty.")

    recognizer = sr.Recognizer()
    recognizer.operation_timeout = RECOGNITION_TIMEOUT_SECONDS
    with sr.AudioFile(io.BytesIO(audio_bytes)) as source:
        audio = recognizer.record(source)
    return recognizer.recognize_google(audio)
