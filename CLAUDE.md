# CLAUDE.md

Guidance for AI coding agents (Claude Code and the Claude Code GitHub Action)
working in this repository. User-facing docs live in `README.md`.

## What this is

A browser-only toy neural-network simulation in `web/`: plain HTML, CSS and
two ES modules, using Three.js 0.171.0 from unpkg via an import map. There is
no build step and no `package.json`. Pushes to `main` that touch `web/` deploy
to GitHub Pages.

- `web/brain.js`: the simulation (voxel neurons, growth, synapses, spikes,
  dopamine learning). No DOM or Three.js, so it runs in Node.
- `web/app.js`: Three.js rendering, HUD updates and the animation loop.
- `docs/neurons.md`: plain-language description of the neuron behavior,
  including a table of every `PARAMS` value.
- `tests/brain.test.mjs`: headless checks of the simulation rules and learning.

## Keep docs/neurons.md current

`docs/neurons.md` must always match `web/brain.js`. In the same commit as any
change to the simulation's rules, parameters or learning, update the matching
sections of `docs/neurons.md`, including the parameter table and the measured
accuracy. Also update its "What you see" table when `app.js` changes what a
color or shape means.

## Commands

```sh
node tests/brain.test.mjs          # simulation checks (Node 18+, no install)
npx http-server web -p 8080 -c-1   # serve locally, then open http://localhost:8080/
node --check web/app.js            # quick syntax check
```

ES modules don't load from `file://`, so always serve over HTTP. Run the test
after changing `brain.js`. Rendering has no automated test, so check it in a
browser, including a phone-sized viewport (about 390 × 844).

## Conventions

- Keep the app dependency-free. Don't add npm packages or a bundler without
  being asked.
- Pin CDN URLs to exact versions (currently `three@0.171.0`) and keep
  `index.html`'s import map and `app.js`'s addon imports on the same version.
- The deploy workflow adds `?v=<sha>` to `./app.js` and `./styles.css` in
  `index.html` and to `'./brain.js'` in `app.js` for cache busting. Keep those
  references in exactly that form, don't add versions by hand, and add any new
  local file to that workflow step.
- Colors carry meaning (see `COLORS` in `app.js` and the variables in
  `styles.css`). Keep the two in sync and don't add decorative color coding.
- Keep the README's "educational toy, not biologically accurate" framing when
  describing behavior.
- Commit messages are short, imperative subject lines (e.g. "Smooth neural
  connection curves").
