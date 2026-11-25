from collections.abc import Iterator
from typing import TypedDict

import speech_recognition as sr
from langdetect import DetectorFactory, detect
from langdetect.lang_detect_exception import LangDetectException

# To ensure consistent results
DetectorFactory.seed = 0


class RecognitionResponse(TypedDict):
    success: bool
    error: str | None
    transcription: str | None


def detect_language(text: str) -> str:
    try:
        return detect(text)
    except LangDetectException:
        return "unknown"


def language_name(lang_code: str | None) -> str:
    languages = {
        "af": "Afrikaans",
        "ar": "Arabic",
        "bg": "Bulgarian",
        "bn": "Bengali",
        "ca": "Catalan",
        "cs": "Czech",
        "cy": "Welsh",
        "de": "German",
        "da": "Danish",
        "en": "English",
        "es": "Spanish",
        "et": "Estonian",
        "el": "Greek",
        "fa": "Persian",
        "fi": "Finnish",
        "fr": "French",
        "gu": "Gujarati",
        "he": "Hebrew",
        "hi": "Hindi",
        "hr": "Croatian",
        "hu": "Hungarian",
        "id": "Indonesian",
        "it": "Italian",
        "ja": "Japanese",
        "kn": "Kannada",
        "ko": "Korean",
        "lt": "Lithuanian",
        "lv": "Latvian",
        "mk": "Macedonian",
        "ml": "Malayalam",
        "mr": "Marathi",
        "ne": "Nepali",
        "nl": "Dutch",
        "no": "Norwegian",
        "pa": "Punjabi",
        "pl": "Polish",
        "pt": "Portuguese",
        "ro": "Romanian",
        "ru": "Russian",
        "sk": "Slovak",
        "sl": "Slovenian",
        "so": "Somali",
        "sq": "Albanian",
        "sv": "Swedish",
        "sw": "Swahili",
        "ta": "Tamil",
        "te": "Telugu",
        "th": "Thai",
        "tl": "Tagalog",
        "tr": "Turkish",
        "uk": "Ukrainian",
        "ur": "Urdu",
        "vi": "Vietnamese",
        "zh": "Chinese",
        "zh-cn": "Chinese",
        "zh-tw": "Chinese (Traditional)",
    }
    if not lang_code:
        return "Unknown"
    normalized_code = lang_code.strip().casefold().replace("_", "-")
    primary_code = normalized_code.split("-", maxsplit=1)[0]
    return languages.get(normalized_code, languages.get(primary_code, "Unknown"))


def recognize_speech_chunk(
    recognizer: sr.Recognizer,
    microphone: sr.Microphone,
) -> Iterator[RecognitionResponse]:
    with microphone as source:
        print("Adjusting for ambient noise...")
        recognizer.adjust_for_ambient_noise(source)
        print("Listening...")

        while True:
            audio = recognizer.listen(source, phrase_time_limit=5)
            response: RecognitionResponse = {"success": True, "error": None, "transcription": None}

            try:
                response["transcription"] = recognizer.recognize_google(audio)
            except sr.RequestError:
                response["success"] = False
                response["error"] = "API unavailable"
            except sr.UnknownValueError:
                response["error"] = "Unable to recognize speech"

            yield response


def list_microphones() -> list[str]:
    # List all available microphones
    mic_list = sr.Microphone.list_microphone_names()
    for i, microphone_name in enumerate(mic_list):
        print(f"Microphone with index {i}: {microphone_name}")
    return mic_list


def main() -> None:
    recognizer = sr.Recognizer()

    try:
        print("Available microphones:")
        mic_list = list_microphones()
    except (AttributeError, OSError) as exc:
        print(f"Could not list microphones: {exc}")
        print("The command-line microphone mode may require PyAudio.")
        return

    if not mic_list:
        print("No microphones are available.")
        return

    try:
        mic_index = int(input(f"Select microphone index (0 to {len(mic_list) - 1}): "))
    except ValueError:
        print("Please enter a valid microphone number.")
        return

    if not 0 <= mic_index < len(mic_list):
        print("The selected microphone index is out of range.")
        return

    try:
        microphone = sr.Microphone(device_index=mic_index)
    except (AttributeError, OSError) as exc:
        print(f"Could not access microphone: {exc}")
        return

    try:
        with open("file.txt", "a", encoding="utf-8") as file:
            print("Listening. Press Ctrl+C to stop.")
            for speech_to_text in recognize_speech_chunk(recognizer, microphone):
                if not speech_to_text["success"]:
                    print("I didn't catch that. Check your connection and try again.\n")
                    continue
                if speech_to_text["error"]:
                    print(f"ERROR: {speech_to_text['error']}")
                    continue

                text = speech_to_text["transcription"]
                if not text:
                    continue

                print(f"You said: {text}")
                lang_code = detect_language(text)
                lang_name = language_name(lang_code)
                print(f"The detected language is: {lang_name}")

                file.write(f"Text: {text}\n")
                file.write(f"Detected Language: {lang_name}\n\n")
                file.flush()
    except KeyboardInterrupt:
        print("\nStopped listening.")
    except OSError as exc:
        print(f"Could not write transcription to file.txt: {exc}")


if __name__ == "__main__":
    main()
