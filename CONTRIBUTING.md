# Contributing

Bug reports and pull requests are welcome. Wrong or badly formatted citations are the most useful reports, so please include the exact input and the output you got.

## Setup

Follow [Local development](README.md#local-development) in the README. You need Python 3.11+ and Node.js 20.9+.

## Before opening a pull request

Run the test suites from the repository root:

```bash
python -m pytest
```

```bash
cd frontend
npm test
npm run build
```

`pytest` collects only `tests/`. The scripts under `profiling/` make live, paid API calls and are never part of the test run. Keep new tests offline by mocking external services, as the existing ones do.

## Citation rules

The McGill Guide is the authority on formatting. When you change how a citation is formatted, name the Guide rule you followed in the pull request description. Do not copy text from the Guide into the repository; it is a separate copyrighted publication.

## Secrets

Never commit `.env` or API keys, and never expose a private key through a `NEXT_PUBLIC_` variable.
