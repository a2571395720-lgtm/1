# JobPilot

JobPilot is a local-first personal job application assistant for China and overseas opportunities.

## Review build V0.4

- English-first multilingual dashboard
- Local profile storage
- Five-star job matching
- Built-in tailored Cover Letter drafting
- Application task preparation with resume and letter selection
- Remote / Hybrid / Onsite and location preferences
- Safety checkpoints for visa, salary, identity, CAPTCHA, signature, and final submission

## Important boundary

The web app prepares an application task. Cross-site form filling requires the optional browser extension or the planned desktop helper. JobPilot does not bypass CAPTCHA and does not submit sensitive answers without the user's confirmation.

## Run locally

```bash
node server.mjs
```

Then open `http://127.0.0.1:4174/`.

## Browser extension

The `browser-extension` directory contains the optional Manifest V3 helper. Load it as an unpacked extension in Chrome or Edge. It fills ordinary fields, highlights sensitive questions, and never clicks the final submit button.

## Privacy

The review build stores profile, preferences, generated Cover Letters, and prepared application tasks in browser local storage. Do not commit personal credentials, platform cookies, API keys, or private resumes to a public repository.

## Status

This is an experimental personal-use prototype, not a production batch-application bot. Platform-specific adapters will be added incrementally, beginning with Workday, Greenhouse, and Lever.

## License

MIT

