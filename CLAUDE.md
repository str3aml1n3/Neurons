# CLAUDE.md

Guidance for AI coding agents (Claude Code and the Claude Code GitHub Action)
working in this repository. User-facing docs live in `README.md`.

## What this is

A browser-only toy neural-network simulation in `web/`: plain HTML, CSS and
one ES module (`app.js`), using Three.js 0.171.0 from unpkg via an import map.
There is no build step, no `package.json` and no test suite. Pushes to `main`
that touch `web/` deploy to GitHub Pages.

In `app.js`, the `Brain` class holds the simulation (neurons, growth,
signal propagation, reward-gated weights). The code after it does the Three.js
scene, the visuals and the animation loop.

## Commands

```sh
npx http-server web -p 8080 -c-1   # serve locally, then open http://localhost:8080/
node --check web/app.js            # quick syntax check
```

ES modules don't load from `file://`, so always serve over HTTP. There are no
automated tests, so check changes by opening the page in a browser.

## Conventions

- Keep the app dependency-free. Don't add npm packages or a bundler without
  being asked.
- Pin CDN URLs to exact versions (currently `three@0.171.0`) and keep
  `index.html`'s import map and `app.js`'s addon imports on the same version.
- Keep the README's "educational toy, not biologically accurate" framing when
  describing behavior.
- Commit messages are short, imperative subject lines (e.g. "Smooth neural
  connection curves").
