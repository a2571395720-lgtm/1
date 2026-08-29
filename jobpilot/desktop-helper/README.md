# Desktop helper roadmap

The desktop helper will run platform adapters with a visible browser session.

Planned sequence:

1. Workday adapter
2. Greenhouse and Lever adapters
3. LinkedIn and Indeed assisted flows
4. China platform adapters after account and policy testing

Safety requirements:

- pause on CAPTCHA;
- never infer visa, salary, demographic, disability, veteran, or signature answers;
- show a review screen before final submission;
- keep credentials and cookies out of the repository;
- record every attempted application and its outcome.

The V0.4 repository includes the working web task preparer and optional browser extension. The desktop runtime is intentionally not represented as complete yet.

