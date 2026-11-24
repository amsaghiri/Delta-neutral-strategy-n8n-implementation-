# Contributing

1. Fork the repo and create a feature branch.
2. Change logic in `src/`, never in `workflow/dsfab_process3.json` (it is generated).
3. Run `npm test`. It rebuilds the workflow and must pass.
4. Commit the regenerated workflow file together with your `src/` change.
5. If you rename an n8n node, update every `$('Node name')` reference; a test checks this.
6. Do not include secrets in commits.
