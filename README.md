# Neurons

A browser toy, built with [Three.js](https://threejs.org/), in which neurons grow,
connect and learn inside a transparent 9 × 9 × 9 cube of cells. The network
learns to tell **small** digits (0–4) from **big** ones (5–9).

**Try it:** <https://str3aml1n3.github.io/neuron-sim/>

## How it works

- **Neurons** sit in random cells, not layers. Each grows up to three
  **dendrites** (signals in) and up to three **axons** (signals out), one whole
  cell at a time.
- A **synapse** forms where an axon and a dendrite meet in the same cell.
- The **digit** segments on the front face grow axons into the cube, and the
  **output strip** on the back face grows dendrites. Neurons can also connect
  to them directly.
- Each segment has a **lit** and a **dark** channel, like the eye's ON and
  OFF cells, each with its own cells on the front face. An unlit segment sends
  a signal too.
- A neuron fires when enough signals arrive
  close together, and its signal travels on toward the output strip. A quarter
  of the neurons are **inhibitory**: they connect to other neurons' bodies and
  pull their charge down, so the network can learn "this, but not that". There,
  blue cells vote *small* and red cells vote *big*.
- A correct answer releases **dopamine**, which strengthens the synapses that
  produced it. A wrong answer weakens them. Synapses compete for limited
  support from rewarded answers, and weak or unsupported ones are pruned:
  they pull back partway and regrow nearby, avoiding the old partner.

The full rules, parameters and the meaning of every color are in
**[docs/neurons.md](docs/neurons.md)**. It currently reaches about 70% accuracy
(chance is 50%).

Drag with a mouse or finger to rotate the cube, and pinch or scroll to zoom.
Press **Reset** to grow a new network. Use the **1× / 10× / 100× / Max** buttons
to speed up time: Max runs as many steps as the device can while keeping the
animation smooth, enough to train a network for thousands of answers in about a
minute. Nothing is saved, so reloading the page resets the network (the chosen
speed is remembered).

> **This is an educational toy, not a biologically accurate brain simulation.**
> Dendrites, axons and dopamine are simplified stand-ins, and there is no claim
> of biological timescales. The design is loosely inspired by research on
> [neurite outgrowth](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0086741),
> [activity-dependent plasticity](https://neuronaldynamics.epfl.ch/online/Ch19.S2.html),
> and [dopamine reward signals](https://pmc.ncbi.nlm.nih.gov/articles/PMC8116345/),
> but does not implement those papers' full models.

## Run locally

The app is plain HTML, CSS and two ES modules. There is no build step and no
`package.json`. Because browsers don't load ES modules from `file://` pages,
serve `web/` with any static HTTP server:

```sh
npx http-server web -p 8080 -c-1      # Node.js
python -m http.server 8080 -d web     # Python 3
```

Then open <http://localhost:8080/>. You need an internet connection, because
Three.js 0.171.0 loads from unpkg through an import map.

## Tests

```sh
node tests/brain.test.mjs
```

This runs the simulation headless for five seeded networks. It checks the
growth and wiring rules and that accuracy ends up above chance.

## Project layout

```text
web/
  index.html     Page shell, HUD and Three.js import map
  brain.js       Simulation (no rendering)
  app.js         3D rendering and animation loop
  styles.css     HUD styling, including phone layouts
docs/neurons.md  Neuron behavior: rules, parameters and visuals
tests/           Headless simulation checks
.github/workflows/
  deploy-pages.yml   Publishes web/ to GitHub Pages
  claude.yml         Claude Code GitHub Action
```

## Deployment

The **Deploy web app to GitHub Pages** workflow publishes `web/` whenever a
push to `main` changes files under `web/`. It can also be run manually from
the Actions tab. GitHub Pages must be enabled for the repository
(Settings → Pages → Source: GitHub Actions).

During deploy, the workflow adds the commit hash to the `app.js`,
`styles.css` and `brain.js` URLs (for example `app.js?v=f0f2a08c`). A normal
reload then loads the new version immediately, instead of waiting out GitHub
Pages' 10-minute cache. The source `index.html` keeps plain URLs.
