# Contributing

Thanks for considering a contribution. Issues and pull requests are welcome.

## Before you start

- Search existing issues and pull requests to avoid duplicate work.
- For larger changes, open an issue first to agree on scope.
- Do not commit credentials, private recordings, or other sensitive data.

## Local setup

Use Python 3.11 or later:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
```

## Validate your changes

```powershell
ruff check .
ruff format --check .
python -m unittest discover -s tests -v
```

For changes to the Streamlit interface, also run the app locally and check the
relevant workflow in a supported browser. Microphone and speech-provider
behavior require a real browser, microphone permission, and an internet
connection; automated tests do not establish that behavior.

## Pull requests

- Keep changes focused and preserve existing behavior unless a change is
  explicitly intended.
- Add or update tests for behavior changes.
- Document user-visible features, configuration, privacy, and limitations.
- Include a concise summary and the validation you actually ran.
