# Security Policy

## Reporting a Vulnerability
If you find a security issue (secrets exposure, logic that could trigger unwanted orders, etc.), 
please open a private issue or email the maintainer. Avoid sharing sensitive details publicly.

## Secrets
Do **not** commit API tokens, chat IDs, or sheet IDs. Use environment variables or the `.env` file 
(locally only). This repo uses placeholders like `YOUR_BOT_TOKEN`, `YOUR_CHAT_ID`, and `YOUR_SHEET_ID`.
