# Security Policy

## Reporting a vulnerability

Please do not report security vulnerabilities in public issues. Use GitHub's
private vulnerability reporting for this repository when available. If it is
unavailable, contact the maintainer privately through the contact information
on the repository profile.

Include a description of the issue, steps to reproduce it, and its potential
impact. Do not include real credentials, personal recordings, or private user
data in reports.

## Scope and privacy notes

The app does not intentionally persist uploaded audio. Recorded/uploaded audio
is processed for the one-shot transcription request; live mode uses the
browser's speech-recognition provider, whose handling of microphone audio is
outside this project's control. Avoid submitting sensitive recordings.
