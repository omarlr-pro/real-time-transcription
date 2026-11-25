import unittest

from language_detector import detect_language, language_name


class LanguageDetectorTests(unittest.TestCase):
    def test_detects_english_from_context(self):
        text = "This is a longer English sentence that gives the language detector enough context."
        self.assertEqual(detect_language(text), "en")

    def test_detects_french_from_context(self):
        text = (
            "Ceci est une phrase française plus longue pour donner assez de contexte "
            "au détecteur de langue."
        )
        self.assertEqual(detect_language(text), "fr")

    def test_detects_arabic_from_context(self):
        text = "هذه جملة عربية أطول حتى يحصل كاشف اللغة على سياق كاف لتحديد اللغة بشكل صحيح."
        self.assertEqual(detect_language(text), "ar")

    def test_language_names_include_french_and_ignore_code_case(self):
        self.assertEqual(language_name("fr"), "French")
        self.assertEqual(language_name("EN"), "English")
        self.assertEqual(language_name("fr-CA"), "French")
        self.assertEqual(language_name("ar-MA"), "Arabic")
        self.assertEqual(language_name("zh-TW"), "Chinese (Traditional)")
        self.assertEqual(language_name("cy"), "Welsh")
        self.assertEqual(language_name(None), "Unknown")

    def test_unknown_text_returns_unknown(self):
        self.assertEqual(detect_language(""), "unknown")


if __name__ == "__main__":
    unittest.main()
