# Neurons

A browser toy, built with [Three.js](https://threejs.org/), that simulates a tiny
neural network learning to tell **small** digits (0–4) from **big** ones (5–9)
inside a rotatable, transparent 9 × 9 × 9 cube.

**Try it:** <https://str3aml1n3.github.io/neuron-sim/>

## How it works

- A gold seven-segment **digit** is on one face of the cube. Its lit segments
  stimulate the input neurons.
- Neurons sit in three layers (cyan input, violet hidden, pink output). Each
  one is placed randomly within its layer. Axons grow freely toward their
  targets, and dendrites keep extending and retracting.
- A **signal** (yellow dot) travels along weighted connections to a
  blue-to-red **output strip** on the opposite face. Blue means *small*, red
  means *big*.
- Reaching the correct half triggers a visible dopamine-like **reward** and a
  new random digit. A wrong answer retries the same digit.
- Reward strengthens the connections that were just used, and a wrong answer
  weakens them. An axon's thickness shows its learned strength.

Drag with a mouse or finger to rotate the cube. Press **Reset simulation** to
start over. Nothing is saved, so reloading the page resets everything.

> **This is an educational toy, not a biologically accurate brain simulation.**
> It uses three layers of neurons, growth toward selected targets, and a simple
> reward-gated weight update. Dendrites are visual growth proxies, not a model
> of synaptic chemistry, and there is no claim of reliable learning or
> biological timescales. The design is loosely inspired by research on
> [neurite outgrowth](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0086741),
> [activity-dependent plasticity](https://neuronaldynamics.epfl.ch/online/Ch19.S2.html),
> and [dopamine reward signals](https://pmc.ncbi.nlm.nih.gov/articles/PMC8116345/),
> but does not implement those papers' full models.

## Run locally

The app is plain HTML, CSS and one ES module. There is no build step and no
`package.json`. Because browsers don't load ES modules from `file://` pages,
serve `web/` with any static HTTP server:

```sh
npx http-server web -p 8080 -c-1      # Node.js
python -m http.server 8080 -d web     # Python 3
```

Then open <http://localhost:8080/>. You need an internet connection, because
Three.js 0.171.0 loads from unpkg through an import map.

## Project layout

```text
web/
  index.html     Page shell, HUD and Three.js import map
  app.js         Simulation (Brain class) and 3D rendering
  styles.css     HUD styling
.github/workflows/
  deploy-pages.yml   Publishes web/ to GitHub Pages
  claude.yml         Claude Code GitHub Action
```

## Deployment

The **Deploy web app to GitHub Pages** workflow publishes `web/` whenever a
push to `main` changes files under `web/`. It can also be run manually from
the Actions tab. GitHub Pages must be enabled for the repository
(Settings → Pages → Source: GitHub Actions).

During deploy, the workflow adds the commit hash to the `app.js` and
`styles.css` URLs in `index.html` (for example `app.js?v=f0f2a08c`). A normal
reload then loads the new version immediately, instead of waiting out GitHub
Pages' 10-minute cache. The source `index.html` keeps plain URLs.
