from datetime import datetime
from pathlib import Path

import speech_recognition as sr
import streamlit as st

from audio_transcriber import transcribe_audio
from language_detector import detect_language, language_name

st.set_page_config(
    page_title="Speech Language Detector",
    page_icon="🎙️",
    layout="wide",
)

INITIAL_SESSION = {
    "session_id": "initial",
    "revision": 0,
    "status": "Ready",
    "transcript": "",
    "recognized_text": "",
    "selected_language": "auto",
    "duration_seconds": 0,
    "started_at": None,
    "error": "",
}

LIVE_COMPONENT_HTML = """
<section class="live-card" aria-label="Live speech transcription">
  <header class="live-header">
    <div>
      <p class="eyebrow">LIVE SPEECH-TO-TEXT</p>
      <h2>Live transcription</h2>
      <p class="intro">Speak naturally. Finalized words are added as you talk.</p>
    </div>
    <div id="status-pill" class="status-pill status-ready" role="status" aria-live="polite">
      <span class="status-dot"></span>
      <span id="status-label">Ready</span>
    </div>
  </header>

  <div class="live-toolbar">
    <label class="language-control">
      <span>Recognition language</span>
      <select id="language-select" aria-label="Recognition language">
        <option value="auto">Auto (browser language)</option>
        <option value="en-US">English (US)</option>
        <option value="fr-FR">French (France)</option>
        <option value="ar-SA">Arabic</option>
        <option value="ar-MA">Arabic (Morocco; Darija availability varies)</option>
        <option value="es-ES">Spanish (Spain)</option>
        <option value="de-DE">German</option>
        <option value="it-IT">Italian</option>
        <option value="pt-BR">Portuguese (Brazil)</option>
        <option value="zh-CN">Chinese (Simplified)</option>
        <option value="ja-JP">Japanese</option>
        <option value="custom">Other language (BCP 47 code)</option>
      </select>
    </label>
    <label id="custom-language-wrap" class="language-control custom-language" hidden>
      <span>Language code</span>
      <input id="custom-language" type="text" placeholder="e.g. nl-NL" maxlength="35" autocomplete="off">
    </label>
    <div class="duration-box">
      <span class="duration-label">DURATION</span>
      <strong id="duration">00:00</strong>
    </div>
  </div>

  <div class="wave-panel">
    <canvas id="waveform" aria-label="Live microphone waveform"></canvas>
    <div class="mic-line">
      <span id="mic-dot" class="mic-dot"></span>
      <span id="mic-status">Microphone is off</span>
      <span id="status-detail" class="status-detail"></span>
    </div>
  </div>

  <div class="control-row">
    <button id="start-button" class="button button-primary" type="button">Start Live Transcription</button>
    <button id="pause-button" class="button button-secondary" type="button" disabled>Pause</button>
    <button id="resume-button" class="button button-secondary" type="button" disabled>Resume</button>
    <button id="stop-button" class="button button-danger" type="button" disabled>Stop</button>
    <button id="new-session-button" class="button button-quiet" type="button">New session</button>
  </div>

  <div class="transcript-panel">
    <div class="transcript-heading">
      <div>
        <h3>Transcript</h3>
        <p>Finalized speech is saved below. You can edit it at any time.</p>
      </div>
      <span class="final-badge">FINAL TEXT</span>
    </div>
    <textarea id="transcript" rows="8" aria-label="Editable transcript" placeholder="Your recognized speech will appear here..."></textarea>
    <div class="interim-row" aria-live="polite">
      <span class="interim-label">LIVE</span>
      <span id="interim-text">Provisional words will appear here while you speak.</span>
    </div>
    <div class="transcript-actions">
      <button id="copy-button" class="text-button" type="button">Copy transcript</button>
      <button id="clear-button" class="text-button text-button-danger" type="button">Clear transcript</button>
      <span id="copy-status" class="copy-status" aria-live="polite"></span>
    </div>
  </div>
</section>
"""

LIVE_COMPONENT_CSS = """
:host {
  display: block;
  color: var(--st-text-color, #172033);
  font-family: var(--st-font, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
}
.live-card {
  --line: rgba(128, 145, 170, .24);
  --muted: #718096;
  --surface: var(--st-secondary-background-color, #f7f9fc);
  --accent: var(--st-primary-color, #4f46e5);
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: clamp(18px, 3vw, 28px);
  background: var(--st-background-color, #fff);
  box-shadow: 0 12px 38px rgba(20, 33, 61, .07);
}
.live-header, .live-toolbar, .transcript-heading, .transcript-actions, .control-row, .mic-line {
  display: flex;
  align-items: center;
}
.live-header, .transcript-heading { justify-content: space-between; gap: 16px; }
.eyebrow, .duration-label, .final-badge, .interim-label {
  font-size: 10px;
  font-weight: 750;
  letter-spacing: .12em;
}
.eyebrow { color: var(--accent); margin: 0 0 6px; }
.live-header h2, .transcript-heading h3 { margin: 0; letter-spacing: -.025em; }
.live-header h2 { font-size: 24px; }
.intro, .transcript-heading p { color: var(--muted); margin: 6px 0 0; font-size: 13px; }
.status-pill {
  display: inline-flex; align-items: center; gap: 8px; white-space: nowrap;
  border: 1px solid var(--line); border-radius: 999px; padding: 8px 12px;
  font-size: 12px; font-weight: 700;
}
.status-dot, .mic-dot { width: 8px; height: 8px; border-radius: 50%; background: #98a2b3; }
.status-recording .status-dot, .mic-on { background: #16a36a; box-shadow: 0 0 0 4px rgba(22, 163, 106, .12); }
.status-requesting .status-dot, .status-processing .status-dot { background: #d99a16; animation: pulse 1.15s infinite; }
.status-paused .status-dot { background: #d99a16; }
.status-error .status-dot { background: #df4856; }
.status-stopped .status-dot { background: #64748b; }
.live-toolbar { gap: 16px; margin: 22px 0 14px; align-items: end; flex-wrap: wrap; }
.language-control { display: grid; gap: 6px; color: var(--muted); font-size: 12px; font-weight: 650; min-width: 220px; }
.language-control select, .language-control input {
  border: 1px solid var(--line); border-radius: 9px; padding: 10px 12px;
  background: var(--st-background-color, #fff); color: var(--st-text-color, #172033); font: inherit;
}
.language-control select:focus, .language-control input:focus, #transcript:focus {
  outline: 2px solid color-mix(in srgb, var(--accent), transparent 68%); border-color: var(--accent);
}
.custom-language { min-width: 160px; }
.custom-language[hidden] { display: none; }
.duration-box { margin-left: auto; display: grid; gap: 4px; text-align: right; }
.duration-label { color: var(--muted); }
.duration-box strong { font-variant-numeric: tabular-nums; font-size: 20px; }
.wave-panel {
  overflow: hidden; border: 1px solid var(--line); border-radius: 12px;
  background: var(--surface); padding: 8px 12px 10px;
}
#waveform { display: block; width: 100%; height: 70px; }
.mic-line { gap: 8px; min-height: 20px; color: var(--muted); font-size: 12px; }
.status-detail { margin-left: auto; color: #b54708; }
.control-row { gap: 9px; flex-wrap: wrap; margin: 16px 0 22px; }
.button, .text-button {
  border: 0; border-radius: 9px; cursor: pointer; font: inherit; font-weight: 700;
  transition: background .15s ease, transform .15s ease, opacity .15s ease;
}
.button { padding: 10px 14px; font-size: 13px; }
.button:hover:not(:disabled) { transform: translateY(-1px); }
.button:disabled { opacity: .46; cursor: not-allowed; }
.button-primary { background: var(--accent); color: #fff; }
.button-secondary { background: var(--surface); color: var(--st-text-color, #172033); border: 1px solid var(--line); }
.button-danger { background: #fff1f2; color: #b42332; }
.button-quiet { margin-left: auto; background: transparent; color: var(--muted); }
.transcript-panel { border-top: 1px solid var(--line); padding-top: 19px; }
.transcript-heading h3 { font-size: 16px; }
.transcript-heading p { font-size: 12px; }
.final-badge { color: #127653; background: #e8f7f0; border-radius: 999px; padding: 6px 9px; }
#transcript {
  box-sizing: border-box; display: block; width: 100%; min-height: 180px; resize: vertical;
  margin-top: 14px; padding: 14px; border: 1px solid var(--line); border-radius: 11px;
  background: var(--st-background-color, #fff); color: var(--st-text-color, #172033);
  font: 15px/1.65 var(--st-font, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
}
.interim-row { display: flex; gap: 10px; align-items: baseline; margin-top: 10px; min-height: 22px; color: var(--muted); font-size: 13px; }
.interim-label { color: var(--accent); font-size: 9px; }
#interim-text { font-style: italic; }
.transcript-actions { gap: 16px; margin-top: 12px; flex-wrap: wrap; }
.text-button { padding: 0; background: none; color: var(--accent); font-size: 12px; }
.text-button-danger { color: #b42332; }
.copy-status { color: var(--muted); font-size: 12px; }
@keyframes pulse { 50% { opacity: .4; } }
@media (max-width: 620px) {
  .live-header { align-items: flex-start; flex-direction: column; }
  .duration-box { margin-left: 0; text-align: left; }
  .button-quiet { margin-left: 0; }
}
"""

LIVE_COMPONENT_JS = Path(__file__).with_name("live_transcription.js").read_text(encoding="utf-8")

live_transcription_component = st.components.v2.component(
    name="speech_recognition.live_transcription",
    html=LIVE_COMPONENT_HTML,
    css=LIVE_COMPONENT_CSS,
    js=LIVE_COMPONENT_JS,
)


def _read_component_state(value: object, fallback: dict) -> dict:
    if isinstance(value, dict):
        state = value.get("session")
    else:
        state = getattr(value, "session", None)
    return state if isinstance(state, dict) else fallback


def _format_duration(seconds: int | float | None) -> str:
    seconds = max(0, int(seconds or 0))
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def _language_label(code: str | None) -> str:
    if not code or code == "unknown":
        return "Not detected yet"
    label = language_name(code)
    return label if label != "Unknown" else f"Language code: {code}"


st.title("Speech Language Detector")
st.caption("Transcribe a finished recording or see live speech results as you talk.")

recorded_tab, live_tab = st.tabs(["Recorded audio", "Live transcription"])

with recorded_tab:
    st.subheader("Transcribe a recording")
    st.caption(
        "Recorded audio is sent to Google's recognition service for transcription. "
        "Do not submit sensitive recordings."
    )
    audio_source = st.radio(
        "Choose an audio source",
        ["Record with microphone", "Upload an audio file"],
        horizontal=True,
    )

    if audio_source == "Record with microphone":
        audio_file = st.audio_input("Record your speech", sample_rate=16000)
    else:
        audio_file = st.file_uploader(
            "Choose an audio file",
            type=["wav", "aiff", "aif", "flac"],
            help="Supported formats: WAV, AIFF, and FLAC.",
        )

    if audio_file is not None:
        st.audio(audio_file)

        if st.button("Transcribe and detect language", type="primary"):
            try:
                transcription = transcribe_audio(audio_file.getvalue())
            except sr.UnknownValueError:
                st.warning("Speech could not be understood. Try recording again.")
            except sr.RequestError as exc:
                st.error(
                    "Google's recognition request timed out or failed. Check your "
                    "internet connection and try again."
                )
                st.caption(f"Service detail: {exc}")
            except (OSError, ValueError):
                st.error(
                    "Could not read this audio file. Use a valid WAV, AIFF, or FLAC recording."
                )
            else:
                lang_code = detect_language(transcription)
                lang_label = _language_label(lang_code)

                st.subheader("Transcription")
                st.write(transcription)
                st.subheader("Detected language")
                st.write(lang_label)

                report = f"Text: {transcription}\nDetected Language: {lang_label}\n"
                st.download_button(
                    "Download transcription",
                    data=report,
                    file_name="transcription.txt",
                    mime="text/plain",
                )

with live_tab:
    st.subheader("Speak and see words appear progressively")
    st.caption(
        "Live recognition runs in your browser. The browser's speech service may "
        "send audio to its provider; see the README for support and privacy limits."
    )

    saved_component_state = st.session_state.get("live_transcription")
    saved_session = _read_component_state(saved_component_state, INITIAL_SESSION)
    component_result = live_transcription_component(
        data={"snapshot": saved_session},
        default={"session": INITIAL_SESSION},
        on_session_change=lambda: None,
        key="live_transcription",
    )
    session = _read_component_state(component_result, saved_session)

    session_id = session.get("session_id", "initial")
    recognized_text = session.get("recognized_text", "")
    selected_language = session.get("selected_language", "auto")

    if st.session_state.get("_language_session_id") != session_id:
        st.session_state["_language_session_id"] = session_id
        st.session_state["_detected_language"] = "unknown"
    if not recognized_text:
        st.session_state["_detected_language"] = "unknown"

    if selected_language == "auto":
        current_language = st.session_state.get("_detected_language", "unknown")
        words = recognized_text.split()
        if current_language == "unknown" and len(recognized_text) >= 50 and len(words) >= 8:
            candidate = detect_language(recognized_text)
            if candidate != "unknown":
                st.session_state["_detected_language"] = candidate
                current_language = candidate
        language_display = (
            _language_label(current_language)
            if current_language != "unknown"
            else "Detecting from speech context..."
        )
    else:
        if selected_language == "custom":
            language_display = "Choose a language code"
        else:
            language_code = selected_language.split("-", 1)[0].lower()
            language_display = _language_label(language_code)

    metric_left, metric_middle, metric_right = st.columns(3)
    metric_left.metric("Status", session.get("status", "Ready"))
    metric_middle.metric("Detected language", language_display)
    metric_right.metric("Recording time", _format_duration(session.get("duration_seconds", 0)))

    if session.get("error"):
        st.warning(session["error"])

    transcript = session.get("transcript", "")
    started_at = session.get("started_at")
    export_lines = []
    if started_at:
        try:
            started = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
            export_lines.append(f"Started: {started.astimezone().strftime('%Y-%m-%d %H:%M:%S %Z')}")
        except ValueError:
            export_lines.append(f"Started: {started_at}")
    export_lines.extend(
        [
            f"Duration: {_format_duration(session.get('duration_seconds', 0))}",
            f"Detected language: {language_display}",
            "",
            transcript,
        ]
    )
    st.download_button(
        "Download live transcript",
        data="\n".join(export_lines),
        file_name="live_transcript.txt",
        mime="text/plain",
        disabled=not transcript.strip(),
        key="download_live_transcript",
    )
