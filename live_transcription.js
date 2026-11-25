export default function ({ parentElement, data, setStateValue }) {
  const root = parentElement.querySelector(".live-card");

  if (root.__liveTranscriptionController) {
    root.__liveTranscriptionController.restore(data?.snapshot);
    return () => {};
  }

  const element = (id) => parentElement.querySelector(`#${id}`);
  const startButton = element("start-button");
  const pauseButton = element("pause-button");
  const resumeButton = element("resume-button");
  const stopButton = element("stop-button");
  const newSessionButton = element("new-session-button");
  const languageSelect = element("language-select");
  const customLanguageWrap = element("custom-language-wrap");
  const customLanguageInput = element("custom-language");
  const transcriptInput = element("transcript");
  const interimText = element("interim-text");
  const statusPill = element("status-pill");
  const statusLabel = element("status-label");
  const statusDetail = element("status-detail");
  const durationLabel = element("duration");
  const micStatus = element("mic-status");
  const micDot = element("mic-dot");
  const canvas = element("waveform");
  const copyStatus = element("copy-status");
  const clearButton = element("clear-button");
  const copyButton = element("copy-button");

  const initial = data?.snapshot || {};
  const controller = {
    sessionId: initial.session_id || makeSessionId(),
    revision: Number(initial.revision) || 0,
    mode: "ready",
    status: initial.status || "Ready",
    transcript: initial.transcript || "",
    recognizedText: initial.recognized_text || "",
    selectedLanguage: initial.selected_language || "auto",
    durationBaseMs: Math.max(0, Number(initial.duration_seconds) || 0) * 1000,
    activeStartedAt: 0,
    startedAt: initial.started_at || null,
    error: initial.error || "",
    recognition: null,
    handledFinalIndices: new Set(),
    recognitionRuns: 0,
    recognitionRunEnded: false,
    retryCount: 0,
    restartTimer: null,
    stopTimer: null,
    durationTimer: null,
    durationTicks: 0,
    publishTimer: null,
    micStream: null,
    audioContext: null,
    analyser: null,
    waveformSamples: null,
    waveformFrame: 0,
    disposed: false,
    pendingNetworkRetry: false,
  };

  if (["Recording", "Requesting microphone permission", "Processing audio"].includes(controller.status)) {
    controller.mode = "stopped";
    controller.status = "Stopped";
    controller.error = "The page reconnected. Your transcript was restored; start again to continue.";
    controller.activeStartedAt = 0;
    controller.recognitionRuns = controller.recognizedText ? 1 : 0;
  } else if (controller.status === "Paused") {
    controller.mode = "paused";
  } else if (controller.status === "Error") {
    controller.mode = "error";
  } else if (controller.status === "Stopped") {
    controller.mode = "stopped";
  }

  const presetLanguages = new Set([
    "auto", "en-US", "fr-FR", "ar-SA", "ar-MA", "es-ES", "de-DE", "it-IT",
    "pt-BR", "zh-CN", "ja-JP", "custom",
  ]);
  if (presetLanguages.has(controller.selectedLanguage)) {
    languageSelect.value = controller.selectedLanguage;
  } else {
    languageSelect.value = "custom";
    customLanguageInput.value = controller.selectedLanguage;
  }
  customLanguageWrap.hidden = languageSelect.value !== "custom";
  transcriptInput.value = controller.transcript;

  function makeSessionId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function currentDurationMs() {
    return controller.durationBaseMs +
      (controller.mode === "recording" && controller.activeStartedAt
        ? performance.now() - controller.activeStartedAt
        : 0);
  }

  function formatDuration(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function updateUi() {
    const isActive = ["requesting", "recording", "paused", "stopping"].includes(controller.mode);
    startButton.disabled = isActive;
    pauseButton.disabled = controller.mode !== "recording";
    resumeButton.disabled = controller.mode !== "paused";
    stopButton.disabled = !isActive;
    newSessionButton.disabled = isActive;
    languageSelect.disabled = isActive;
    customLanguageInput.disabled = isActive;
    durationLabel.textContent = formatDuration(currentDurationMs());
    statusLabel.textContent = controller.status;
    statusPill.className = "status-pill";
    const statusClass = {
      "Ready": "status-ready",
      "Requesting microphone permission": "status-requesting",
      "Recording": "status-recording",
      "Processing audio": "status-processing",
      "Paused": "status-paused",
      "Stopped": "status-stopped",
      "Error": "status-error",
    }[controller.status] || "status-ready";
    statusPill.classList.add(statusClass);
    statusDetail.textContent = controller.error;
    micStatus.textContent = controller.micStream ? "Microphone is on" : "Microphone is off";
    micDot.classList.toggle("mic-on", Boolean(controller.micStream));
    if (!interimText.textContent.trim()) {
      interimText.textContent = "Provisional words will appear here while you speak.";
    }
  }

  function snapshot() {
    return {
      session_id: controller.sessionId,
      revision: controller.revision,
      status: controller.status,
      transcript: controller.transcript,
      recognized_text: controller.recognizedText,
      selected_language: controller.selectedLanguage,
      duration_seconds: Math.floor(currentDurationMs() / 1000),
      started_at: controller.startedAt,
      error: controller.error,
    };
  }

  function publish() {
    if (controller.disposed) return;
    controller.revision += 1;
    setStateValue("session", snapshot());
  }

  function setStatus(status, detail = "") {
    controller.status = status;
    controller.error = detail;
    updateUi();
    publish();
  }

  function normalizeToken(token) {
    return token.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  }

  function removeRepeatedBoundary(existing, incoming) {
    const oldTokens = [...existing.matchAll(/[\p{L}\p{N}]+/gu)];
    const newTokens = [...incoming.matchAll(/[\p{L}\p{N}]+/gu)];
    const maxOverlap = Math.min(5, oldTokens.length, newTokens.length);
    let overlap = 0;

    for (let count = maxOverlap; count >= 2; count -= 1) {
      const oldTail = oldTokens.slice(-count).map((token) => normalizeToken(token[0]));
      const newHead = newTokens.slice(0, count).map((token) => normalizeToken(token[0]));
      if (oldTail.every((token, index) => token && token === newHead[index])) {
        overlap = count;
        break;
      }
    }

    if (!overlap) return incoming;
    const end = newTokens[overlap - 1].index + newTokens[overlap - 1][0].length;
    return incoming.slice(end).replace(/^[\s,.;:!?-]+/, "");
  }

  function appendText(existing, incoming, isRestartBoundary = false) {
    let addition = incoming.trim();
    if (!addition) return existing;
    if (isRestartBoundary) addition = removeRepeatedBoundary(existing, addition);
    if (!addition) return existing;
    const separator = existing && !/\s$/.test(existing) ? " " : "";
    return `${existing}${separator}${addition}`.replace(/\s+([,.;:!?])/g, "$1");
  }

  function setTranscript(value, notify = true) {
    controller.transcript = value;
    if (transcriptInput.value !== value) {
      transcriptInput.value = value;
    }
    if (notify) {
      if (controller.publishTimer) clearTimeout(controller.publishTimer);
      controller.publishTimer = setTimeout(publish, 250);
    }
  }

  function stopWaveform() {
    if (controller.waveformFrame) cancelAnimationFrame(controller.waveformFrame);
    controller.waveformFrame = 0;
    if (controller.micStream) {
      controller.micStream.getTracks().forEach((track) => track.stop());
      controller.micStream = null;
    }
    if (controller.audioContext) {
      controller.audioContext.close().catch(() => {});
      controller.audioContext = null;
      controller.analyser = null;
      controller.waveformSamples = null;
    }
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    updateUi();
  }

  function drawWaveform() {
    if (!controller.analyser || !controller.micStream) return;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const pixelRatio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.floor(width * pixelRatio) ||
        canvas.height !== Math.floor(height * pixelRatio)) {
      canvas.width = Math.floor(width * pixelRatio);
      canvas.height = Math.floor(height * pixelRatio);
    }
    const context = canvas.getContext("2d");
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const samples = controller.waveformSamples;
    controller.analyser.getByteTimeDomainData(samples);
    context.clearRect(0, 0, width, height);
    context.beginPath();
    context.lineWidth = 2;
    context.strokeStyle = getComputedStyle(root).getPropertyValue("--st-primary-color").trim() || "#4f46e5";
    const step = width / samples.length;
    for (let index = 0; index < samples.length; index += 1) {
      const x = index * step;
      const y = (samples[index] / 255) * height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
    controller.waveformFrame = requestAnimationFrame(drawWaveform);
  }

  async function startWaveform() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser cannot access a microphone. Try a supported browser on localhost or HTTPS.");
    }
    controller.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    controller.micStream.getTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        if (!controller.micStream || controller.mode !== "recording") return;
        controller.durationBaseMs = currentDurationMs();
        controller.activeStartedAt = 0;
        controller.mode = "error";
        controller.status = "Error";
        controller.error = "Microphone disconnected. Your recognized transcript has been preserved.";
        stopDurationClock();
        stopWaveform();
        controller.recognition?.abort();
        updateUi();
        publish();
      }, { once: true });
    });
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
      stopWaveform();
      throw new Error("Live audio visualization is not supported by this browser.");
    }
    controller.audioContext = new AudioContextConstructor();
    await controller.audioContext.resume();
    controller.analyser = controller.audioContext.createAnalyser();
    controller.analyser.fftSize = 1024;
    controller.waveformSamples = new Uint8Array(controller.analyser.fftSize);
    controller.audioContext.createMediaStreamSource(controller.micStream)
      .connect(controller.analyser);
    updateUi();
    drawWaveform();
  }

  function recognitionConstructor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function recognitionLanguage() {
    const selected = controller.selectedLanguage;
    if (selected === "auto") return navigator.language || "en-US";
    if (selected === "custom") return customLanguageInput.value.trim();
    return selected;
  }

  function stopDurationClock() {
    if (controller.durationTimer) clearInterval(controller.durationTimer);
    controller.durationTimer = null;
  }

  function startDurationClock() {
    stopDurationClock();
    controller.durationTicks = 0;
    controller.durationTimer = setInterval(() => {
      durationLabel.textContent = formatDuration(currentDurationMs());
      controller.durationTicks += 1;
      if (controller.durationTicks % 20 === 0) publish();
    }, 250);
  }

  function setFinalSegment(text) {
    const segment = text.trim();
    if (!segment) return;
    const restartBoundary = controller.recognitionRuns > 1;
    controller.recognizedText = appendText(
      controller.recognizedText,
      segment,
      restartBoundary,
    );
    controller.transcript = appendText(controller.transcript, segment, restartBoundary);
    transcriptInput.value = controller.transcript;
    transcriptInput.scrollTop = transcriptInput.scrollHeight;
    interimText.textContent = "";
    publish();
  }

  function finishStopped() {
    if (controller.stopTimer) clearTimeout(controller.stopTimer);
    controller.stopTimer = null;
    controller.mode = "stopped";
    controller.activeStartedAt = 0;
    stopDurationClock();
    stopWaveform();
    controller.status = "Stopped";
    controller.error = "";
    interimText.textContent = "";
    controller.recognitionRunEnded = true;
    updateUi();
    publish();
  }

  function scheduleRestart(delay) {
    if (controller.restartTimer) clearTimeout(controller.restartTimer);
    controller.restartTimer = setTimeout(() => {
      controller.restartTimer = null;
      if (controller.mode === "recording") startRecognition();
    }, delay);
  }

  function startRecognition() {
    if (controller.mode !== "recording") return;
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      controller.durationBaseMs = currentDurationMs();
      controller.mode = "error";
      controller.activeStartedAt = 0;
      stopDurationClock();
      stopWaveform();
      setStatus("Error", "Live speech recognition is unavailable in this browser. Try a recent version of Chrome or Edge.");
      return;
    }

    const recognition = new Recognition();
    controller.recognition = recognition;
    controller.recognitionRunEnded = false;
    controller.handledFinalIndices = new Set();
    controller.recognitionRuns += 1;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = recognitionLanguage();

    recognition.onstart = () => {
      if (controller.mode !== "recording") return;
      if (!controller.activeStartedAt) controller.activeStartedAt = performance.now();
      controller.pendingNetworkRetry = false;
      controller.status = "Recording";
      controller.error = "";
      updateUi();
      startDurationClock();
      publish();
    };

    recognition.onresult = (event) => {
      controller.retryCount = 0;
      controller.pendingNetworkRetry = false;
      const provisional = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript?.trim() || "";
        if (result.isFinal) {
          if (!controller.handledFinalIndices.has(index)) {
            controller.handledFinalIndices.add(index);
            setFinalSegment(text);
          }
        } else if (text) {
          provisional.push(text);
        }
      }
      interimText.textContent = provisional.join(" ") || "";
    };

    recognition.onerror = (event) => {
      const error = event.error || "unknown";
      if (error === "no-speech" || error === "aborted") return;
      if (error === "network") {
        controller.pendingNetworkRetry = true;
        controller.retryCount += 1;
        controller.status = "Processing audio";
        controller.error = "Recognition service interrupted; trying to reconnect.";
        updateUi();
        publish();
        return;
      }

      const messages = {
        "not-allowed": "Microphone permission was denied. Allow microphone access in your browser and try again.",
        "service-not-allowed": "The browser's speech-recognition service is blocked or unavailable.",
        "audio-capture": "No microphone could be captured. Check that one is connected and enabled.",
        "language-not-supported": "This browser's recognition service does not support the selected language.",
      };
      controller.durationBaseMs = currentDurationMs();
      controller.mode = "error";
      controller.activeStartedAt = 0;
      stopDurationClock();
      stopWaveform();
      controller.status = "Error";
      controller.error = messages[error] || "Live recognition was interrupted. Your transcript has been preserved.";
      updateUi();
      publish();
    };

    recognition.onend = () => {
      controller.recognitionRunEnded = true;
      if (controller.mode === "stopping") {
        finishStopped();
        return;
      }
      if (controller.mode === "paused") {
        controller.status = "Paused";
        updateUi();
        publish();
        return;
      }
      if (controller.mode !== "recording") return;

      if (controller.pendingNetworkRetry && controller.retryCount >= 5) {
        controller.durationBaseMs = currentDurationMs();
        controller.mode = "error";
        controller.activeStartedAt = 0;
        stopDurationClock();
        stopWaveform();
        controller.status = "Error";
        controller.error = "The recognition service could not reconnect after several attempts. Your transcript is saved.";
        updateUi();
        publish();
        return;
      }

      if (!navigator.onLine) {
        controller.status = "Processing audio";
        controller.error = "Internet connection lost; waiting to reconnect.";
        updateUi();
        publish();
        return;
      }

      controller.status = controller.pendingNetworkRetry ? "Processing audio" : "Recording";
      controller.error = controller.pendingNetworkRetry
        ? "Recognition service interrupted; trying to reconnect."
        : "";
      updateUi();
      const delay = controller.pendingNetworkRetry
        ? Math.min(1000 * (2 ** (controller.retryCount - 1)), 15000)
        : 250;
      scheduleRestart(delay);
    };

    try {
      recognition.start();
    } catch (error) {
      controller.durationBaseMs = currentDurationMs();
      controller.mode = "error";
      controller.activeStartedAt = 0;
      stopDurationClock();
      stopWaveform();
      controller.status = "Error";
      controller.error = error?.name === "InvalidStateError"
        ? "The browser recognition service is busy. Wait a moment and try again."
        : "Could not start live recognition. Check microphone access and try again.";
      updateUi();
      publish();
    }
  }

  async function requestMicrophoneAndStart() {
    if (!["ready", "stopped", "error", "paused"].includes(controller.mode)) return;
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      controller.mode = "error";
      setStatus("Error", "Live speech recognition is unavailable in this browser. Try a recent version of Chrome or Edge.");
      return;
    }
    const language = recognitionLanguage();
    if (!language || !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(language)) {
      controller.mode = "error";
      setStatus("Error", "Enter a valid BCP 47 language code, such as nl-NL.");
      return;
    }
    controller.mode = "requesting";
    controller.status = "Requesting microphone permission";
    controller.error = "";
    updateUi();
    publish();

    try {
      await startWaveform();
    } catch (error) {
      controller.mode = "error";
      stopWaveform();
      const denied = error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError";
      const unavailable = error?.name === "NotFoundError" || error?.name === "NotReadableError";
      controller.status = "Error";
      controller.error = denied
        ? "Microphone permission was denied. Allow microphone access in your browser and try again."
        : unavailable
          ? "A microphone is unavailable or already in use. Check your device and try again."
          : error?.message || "Could not access the microphone.";
      updateUi();
      publish();
      return;
    }

    if (controller.mode !== "requesting") {
      stopWaveform();
      return;
    }
    if (!controller.startedAt) controller.startedAt = new Date().toISOString();
    controller.mode = "recording";
    controller.activeStartedAt = performance.now();
    controller.status = "Recording";
    updateUi();
    startDurationClock();
    startRecognition();
  }

  function pauseRecording() {
    if (controller.mode !== "recording") return;
    controller.durationBaseMs = currentDurationMs();
    controller.activeStartedAt = 0;
    controller.mode = "paused";
    controller.status = "Paused";
    controller.error = "";
    if (controller.restartTimer) clearTimeout(controller.restartTimer);
    controller.restartTimer = null;
    stopDurationClock();
    stopWaveform();
    updateUi();
    publish();
    try {
      controller.recognition?.stop();
    } catch {
      controller.recognition?.abort();
    }
  }

  async function resumeRecording() {
    if (controller.mode !== "paused") return;
    await requestMicrophoneAndStart();
  }

  function stopRecording() {
    if (!["requesting", "recording", "paused"].includes(controller.mode)) return;
    if (controller.mode === "recording" && controller.activeStartedAt) {
      controller.durationBaseMs = currentDurationMs();
    }
    controller.activeStartedAt = 0;
    controller.mode = "stopping";
    controller.status = "Processing audio";
    controller.error = "";
    if (controller.restartTimer) clearTimeout(controller.restartTimer);
    controller.restartTimer = null;
    stopDurationClock();
    stopWaveform();
    updateUi();
    publish();
    if (!controller.recognition || controller.recognitionRunEnded) {
      finishStopped();
      return;
    }
    controller.stopTimer = setTimeout(() => {
      controller.recognition?.abort();
      finishStopped();
    }, 2500);
    try {
      controller.recognition.stop();
    } catch {
      controller.recognition.abort();
      finishStopped();
    }
  }

  function clearTranscript() {
    if (!controller.transcript && !controller.recognizedText) return;
    if (!window.confirm("Clear the transcript? This cannot be undone.")) return;
    controller.transcript = "";
    controller.recognizedText = "";
    transcriptInput.value = "";
    interimText.textContent = "";
    publish();
  }

  function beginNewSession() {
    if (["requesting", "recording", "paused", "stopping"].includes(controller.mode)) return;
    if ((controller.transcript || controller.recognizedText) &&
        !window.confirm("Start a new session and clear the current transcript?")) return;
    controller.sessionId = makeSessionId();
    controller.revision = 0;
    controller.mode = "ready";
    controller.status = "Ready";
    controller.transcript = "";
    controller.recognizedText = "";
    controller.durationBaseMs = 0;
    controller.activeStartedAt = 0;
    controller.startedAt = null;
    controller.error = "";
    controller.retryCount = 0;
    controller.recognitionRuns = 0;
    controller.recognition = null;
    transcriptInput.value = "";
    interimText.textContent = "";
    stopDurationClock();
    stopWaveform();
    updateUi();
    publish();
  }

  async function copyTranscript() {
    if (!controller.transcript.trim()) {
      copyStatus.textContent = "There is no transcript to copy.";
      return;
    }
    try {
      await navigator.clipboard.writeText(controller.transcript);
      copyStatus.textContent = "Transcript copied.";
    } catch {
      transcriptInput.focus();
      transcriptInput.select();
      const copied = document.execCommand("copy");
      copyStatus.textContent = copied
        ? "Transcript copied."
        : "Copy was blocked by the browser. Select the text and copy it manually.";
    }
    setTimeout(() => { copyStatus.textContent = ""; }, 2500);
  }

  function selectedLanguageChanged() {
    const value = languageSelect.value;
    customLanguageWrap.hidden = value !== "custom";
    if (value !== "custom") {
      controller.selectedLanguage = value;
      publish();
    } else {
      controller.selectedLanguage = "custom";
      publish();
      customLanguageInput.focus();
    }
  }

  function customLanguageChanged() {
    const value = customLanguageInput.value.trim();
    if (value && /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(value)) {
      controller.selectedLanguage = value;
      publish();
    }
  }

  startButton.addEventListener("click", requestMicrophoneAndStart);
  pauseButton.addEventListener("click", pauseRecording);
  resumeButton.addEventListener("click", resumeRecording);
  stopButton.addEventListener("click", stopRecording);
  newSessionButton.addEventListener("click", beginNewSession);
  clearButton.addEventListener("click", clearTranscript);
  copyButton.addEventListener("click", copyTranscript);
  languageSelect.addEventListener("change", selectedLanguageChanged);
  customLanguageInput.addEventListener("change", customLanguageChanged);
  customLanguageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") customLanguageChanged();
  });
  transcriptInput.addEventListener("input", () => setTranscript(transcriptInput.value));
  window.addEventListener("online", () => {
    if (controller.mode === "recording" && controller.pendingNetworkRetry) {
      controller.retryCount = 0;
      controller.pendingNetworkRetry = false;
      if (controller.recognitionRunEnded) scheduleRestart(0);
    }
  });
  window.addEventListener("offline", () => {
    if (controller.mode === "recording") {
      controller.pendingNetworkRetry = true;
      controller.status = "Processing audio";
      controller.error = "Internet connection lost; waiting to reconnect.";
      updateUi();
      publish();
      try {
        controller.recognition?.stop();
      } catch {
        controller.recognition?.abort();
      }
    }
  });

  function restore(value) {
    if (!value || Number(value.revision) <= controller.revision) return;
    controller.sessionId = value.session_id || controller.sessionId;
    controller.revision = Number(value.revision) || controller.revision;
    const restoredStatus = value.status || "Ready";
    const wasActive = [
      "Recording",
      "Requesting microphone permission",
      "Processing audio",
    ].includes(restoredStatus);
    controller.status = wasActive ? "Stopped" : restoredStatus;
    controller.transcript = value.transcript || "";
    controller.recognizedText = value.recognized_text || "";
    controller.selectedLanguage = value.selected_language || "auto";
    controller.durationBaseMs = Math.max(0, Number(value.duration_seconds) || 0) * 1000;
    controller.startedAt = value.started_at || null;
    controller.recognitionRuns = controller.recognizedText ? 1 : 0;
    controller.error = wasActive
      ? "The page reconnected. Your transcript was restored; start again to continue."
      : value.error || "";
    controller.mode = wasActive
      ? "stopped"
      : controller.status === "Paused"
      ? "paused"
      : controller.status === "Error"
        ? "error"
        : controller.status === "Ready"
          ? "ready"
          : "stopped";
    transcriptInput.value = controller.transcript;
    if (presetLanguages.has(controller.selectedLanguage)) {
      languageSelect.value = controller.selectedLanguage;
    } else {
      languageSelect.value = "custom";
      customLanguageInput.value = controller.selectedLanguage;
    }
    customLanguageWrap.hidden = languageSelect.value !== "custom";
    updateUi();
  }

  controller.restore = restore;
  root.__liveTranscriptionController = controller;
  updateUi();

  return () => {
    controller.disposed = true;
    if (controller.restartTimer) clearTimeout(controller.restartTimer);
    if (controller.stopTimer) clearTimeout(controller.stopTimer);
    if (controller.publishTimer) clearTimeout(controller.publishTimer);
    stopDurationClock();
    if (controller.recognition) {
      try {
        controller.recognition.abort();
      } catch {
        controller.recognition = null;
      }
    }
    stopWaveform();
    delete root.__liveTranscriptionController;
  };
}
