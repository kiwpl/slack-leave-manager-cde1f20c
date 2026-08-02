# Working rules for this project

## Git workflow — follow every session, without being asked

1. At the START of every session, before anything else: pull the latest from
   GitHub and tell me in plain language what came down. If there are no
   changes, say so and move on.

2. Before writing any code, check what branch we're on. If we're on `main`,
   stop and recommend creating a branch named `<name>/<short-feature-description>`
   — where `<name>` is whoever is at the keyboard. Ask me who I am if you
   don't already know from this session. Wait for my confirmation before
   creating it.

3. After each meaningful chunk of work, commit with a clear message describing
   what changed and why.

4. At the END of the session — or any time I say "done for now", "that's it",
   or similar — commit and push everything. Then tell me:
   - the branch name
   - whether a pull request is needed, and if so, the link to open it

5. Never commit `.env` files, credentials, API keys, tokens, or `node_modules`.
   If any of those are untracked and would be swept up by a commit, stop and
   tell me before proceeding.

6. If a pull brings down changes that conflict with local work, do not attempt
   a clever merge on your own. Explain the conflict in plain language and ask
   me how to proceed.

## How to work with me

- I'm non-technical. Explain what you're about to do in plain language before
  doing it, and flag anything risky or hard to undo.
- Prefer one clear recommendation over a list of options.
- If I ask for something that would take significantly longer than I seem to
  expect, say so before starting.
