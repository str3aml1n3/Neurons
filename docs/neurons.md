# Neuron behavior

How the simulation in [`web/brain.js`](../web/brain.js) works, in plain
language. This document is kept in sync with the code: when the simulation
changes, update this file in the same commit.

It is an educational toy, not a biologically accurate model.

## The world

- The cube is a 9 × 9 × 9 grid of **cells**.
- **A cell holds at most one thing**: a neuron body, one piece of a connector,
  a synapse, or a digit or output cell.
- Everything moves and grows in **whole cells**. A connector steps into one of
  the 6 neighboring cells (left, right, up, down, forward, back). There are no
  diagonal or partial steps.

## Nodes

Three kinds of node send and receive signals.

| Node | Where | Grows | Role |
| --- | --- | --- | --- |
| **Neuron** | 16 random cells inside the cube, at least 2 cells apart | 1–3 dendrites and 1–3 axons | Adds up incoming signals and fires. 12 are excitatory and 4 are **inhibitory** (see [Inhibition](#inhibition)). |
| **Digit channel** (input) | The front face. Each of the 7 segments has a **lit** and a **dark** channel with their own cells, so there are 14. | 1 axon, from a random cell of the channel | The lit channel sends signals while its segment is lit, the dark channel while it is unlit |
| **Output cell** | 8 cells of the strip on the back face | 1 dendrite | Collects votes: left half *small*, right half *big* (the middle cell is neutral) |

Signals have a direction: **dendrites carry signals in, axons carry them out.**

**Lit and dark channels.** Like the eye's ON and OFF cells, darkness is a
signal of its own rather than silence. Every digit therefore sends exactly 7
signals, one per segment, and an unlit segment is evidence the network can
use. A neuron can't tell a lit signal from a dark one; what a signal means
comes from which synapse it arrives on.

The two channels have **separate cells** on the front face (z = 0). The lit
cells form the digit around the outside, and each segment's dark cells form a
parallel row just inside it. Capitals are lit cells, lowercase are dark cells,
and `.` is an empty cell:

```text
y=0  . . A A A A A . .
y=1  . . a a a a a . .
y=2  F f . . . . . b B
y=3  F f . . . . . b B
y=4  . . G G G G G . .
y=5  E e g g g g g c C
y=6  E e . . . . . c C
y=7  . . d d d d d . .
y=8  . . D D D D D . .
```

Segments a–g are top, top right, bottom right, bottom, bottom left, top left
and middle. Each channel has 23 cells (5 for a, d and g, 2 for the sides), and
the middle bar's dark row sits just below it. The layout is `SEGMENT_LAYOUT`
in `web/brain.js`.

## Growth

Every 2 ticks, each growing connector tries to step one cell from its tip.

- **Only the tip moves.** The tip (like a real growth cone) explores one cell
  per step. Behind it, the rest of the connector follows the **shortest path
  of free cells** from its body to the tip, so detours straighten out and the
  cells they used are freed. If no shorter free path exists, it keeps its
  current route.
- **Goal.** The tip heads for a goal cell. On first growth, the goals act like
  the chemical guidance cues of a developing brain:
  - Digit axons and output dendrites aim at a random neuron.
  - A neuron's axon aims at another neuron or the output strip (50/50).
  - A neuron's dendrite aims at another neuron or the digit (50/50).

  Neurons the connector is currently avoiding (see
  [Pruning and regrowth](#pruning-and-regrowth)) are never picked.
- **Drift.** 60% of tip steps move closer to the goal. The rest go in a random
  direction, so the tip explores.
- **Blocked.** A step into an occupied cell that doesn't form a synapse is
  blocked. After 7 blocked steps in a row, the connector gives up.
- **Giving up.** A connector also gives up after 30 tip steps without
  connecting, or when its straightened path grows past 10 cells. It then
  retracts **all the way** to its body and starts over with a new guided goal.
- **Retracting** pulls back one cell per tick.

## Synapses

A **synapse** forms when a growing tip steps into a cell held by the opposite
kind of connector:

- an axon tip entering a cell of a growing dendrite, or
- a dendrite tip entering a cell of a growing axon.

The connector that was entered is cut back to that cell, and the cell becomes
the synapse. Each connector has at most one synapse; once connected, both stop
growing.

Digit and output cells also connect directly, without growing anything:

- A neuron's **dendrite** that reaches a **digit cell** connects to that
  cell's channel (lit or dark).
- A neuron's **axon** that reaches an **output cell** connects to it.

Signals always pass through at least one neuron. A digit's axon cannot connect
to an output's dendrite, nothing connects a node to itself, and a connector
won't connect to a partner it is avoiding.

**Inhibitory neurons connect differently.** Their axons always aim at another
neuron's body, and connect only when the tip reaches a **neuron's body cell**
(or an output cell). They never connect to dendrites. A body can take several
inhibitory synapses, so inhibition doesn't use up any dendrite. In real
cortex, too, most synapses on the cell body are inhibitory. Every synapse an
inhibitory neuron makes is inhibitory (Dale's principle).

Every synapse has:

- a **weight** (strength), starting at 1.0 and kept between 0.05 and 2.0, and
- **trophic support**, starting at 1.0 (see
  [Pruning and regrowth](#pruning-and-regrowth)).

## Signals and firing

Time runs in **ticks** (10 per second in the browser).

1. **Input.** Every 5 ticks, each segment's active channel sends a signal
   through all of its synapses: the lit channel if the segment is lit, the dark
   channel if it isn't.
2. **Travel.** A signal (spike) moves one cell per tick, along the axon to the
   synapse and then along the dendrite to the receiving body.
3. **Charge.** When a signal arrives, the neuron's **charge** rises by the
   synapse's weight. Every tick the charge leaks to 70% of its value and gains
   a little random noise.
4. **Fire.** When the charge reaches the neuron's **threshold**, the neuron
   fires: its charge resets to 0, it sends a signal down every connected axon,
   and it rests for 4 ticks.
5. **Adaptive threshold.** Thresholds start at 1.0. Each firing raises the
   threshold by 0.08, and every tick lowers it by 0.004, kept between 0.5 and
   2.5. Busy neurons calm down and silent neurons wake up, so the network never
   goes permanently quiet.

A neuron with a strong synapse (weight ≥ threshold) fires from one signal. With
weaker synapses it needs several signals arriving close together, so it can
respond to a *combination* of lit segments.

## Inhibition

A quarter of the neurons (4 of 16) are inhibitory. They receive and fire by the
same rules as the rest, but their signals pull charge **down**, modeled on
real chloride (GABA) inhibition:

- **Pull toward a floor.** An inhibitory signal moves the target's charge part
  of the way toward a floor of −0.2, just below rest: 50% of the way per unit
  of weight, capped at all the way. The more charged the target is, the harder
  it is pulled down. Inhibition matters most on a neuron about to fire, and
  never drives charge below the floor.
- **Shunting.** For a few ticks afterward, part of any excitation the target
  receives leaks away: excitation is scaled by (1 − shunt), and the shunt
  fades to 60% each tick. Inhibition that arrives just before excitation
  vetoes it.
- **On the output strip**, an inhibitory signal subtracts its weight from that
  side's vote, down to zero.

This gives the network "but not" logic. A neuron that votes *small* when the
top-left segment is dark (1, 2, 3, 7) is wrong on 7. An inhibitory neuron
driven by "bottom dark" (1, 4, 7) that reaches it can veto it on 7.

## Answering

- A signal that reaches an output cell adds the synapse's weight to that
  side's **vote** (*small* or *big*).
- At tick 35 of a trial, the side with more votes is the network's answer.
  On a tie (including no votes) the trial continues until one side leads.
- If no answer comes by tick 60, the trial ends without learning and restarts
  after a pause.

## Learning (dopamine)

After an answer, the simulation finds the synapses **responsible** for it:

1. Start with the output synapses that voted for the chosen side.
2. Add every synapse that helped fire the neurons that sent those votes. A
   synapse helped a firing if its signal arrived within 2 ticks before it.
3. Repeat back through the network, all the way to the digit.

Then:

- **Correct:** dopamine is released, and each responsible synapse is
  strengthened by +0.2. Each receiving neuron (or output cell) also shares
  **1.0 unit of trophic support** among its responsible inputs: one
  responsible input gets all of it, three get a third each. A new digit is
  shown.
- **Wrong:** no dopamine, each responsible synapse is weakened by −0.2, and
  the same digit is shown again.

Synapses that didn't contribute to the answer are not changed.

**Inhibitory synapses** are judged by whom they suppressed. A vetoed neuron
didn't fire, so it isn't in the responsible chain. Instead, each neuron
**leans** toward the side its excitatory connections lead to: small, big, or
neither. Every inhibitory synapse that delivered a signal this trial is:

- **helpful** if its target leans toward the wrong side (or is a wrong-side
  output cell): it and the chain that fired its neuron are strengthened by
  +0.2 and share trophic support;
- **harmful** if its target leans toward the correct side: it and the chain
  that fired its neuron are weakened by −0.2.

Because the chain that *fired* the inhibitory neuron is credited too, an
inhibitory neuron learns which digits to fire for, not just whom to inhibit.
Without that (an earlier version), inhibition stayed unselective and lowered
accuracy.

## Pruning and regrowth

This follows how real neurons rewire: support is limited and earned, failures
are fixed locally, and new contacts form near successful ones.

**Trophic competition.** Every synapse's trophic support fades by 0.05% per
tick, about halving every 1,400 ticks, and only rewarded answers renew it.
Because each receiver shares a fixed amount, its inputs compete for it.

**A synapse is pruned** when either:

- its weight drops below 0.3 (repeated wrong answers), or
- its trophic support drops below 0.1 (not part of rewarded answers for a
  long time).

**After a prune**, each side of the synapse:

1. **Retracts partway**: 5 cells, not all the way back to its body.
2. **Avoids that partner** for 3,000 ticks. It won't connect to the same node
   again in that time.
3. **Regrows locally** toward a new goal:
   - 50% of the time, near its owner's **best-supported synapse** (within 2
     cells), so new contacts cluster next to successful ones;
   - otherwise, near where its tip stopped (within 4 cells).

A connector that retracts completely (its path was shorter than 5 cells) or
that gave up while growing starts over from its body with a new guided goal.

## How well it learns

The headless test (`node tests/brain.test.mjs`) runs 5 random networks for
30,000 ticks each. Over each run's last 300 answers, accuracy averages about
**72%** (chance is 50%). It learns, but only modestly.

Over 10 networks and 40,000 ticks, the regrowth rules (partial retraction,
avoiding pruned partners, local and clustered regrowth, trophic competition)
cut prunes by about 40% and rebuilt same-partner connections by about 70%. They
improved accuracy only slightly, from about 58% to about 62%, which is close to
the run-to-run noise. Adding dark channels then raised it to about 64% and cut
prunes by another quarter. Giving the two channels separate cells, with the
bigger face layout, raised it to about 69%. Inhibitory neurons then added
about 2.5 points: 69.2% → 71.9% on one set of 10 networks, and 67.3% → 69.8%
on a second, independent set.

**Per digit**, late in training (10 networks):

| Digit | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Correct | 63% | 95% | 82% | 52% | 84% | 97% | 94% | 45% | 69% | 82% |

Digits that one dark segment identifies are learned well. The top segment is
dark only for 1 and 4 (small), top-right only for 5 and 6 (big), and
bottom-right only for 2 (small). Digits that need a *combination* of segments
are harder. Inhibition helped 0 (48% → 63%) and 9 (70% → 82%), but 3 and 7
remain near chance. Learning those needs neurons that reliably respond to
specific combinations, which this small network with simple credit assignment
rarely develops.

### What the size parameters do

A sweep varied one parameter at a time from the defaults, 10 networks of
40,000 ticks each. At the defaults, individual networks range from 60% to 77%,
so differences of about 3 points or less are noise.

| Change | Accuracy |
| --- | --- |
| Defaults (cube 9, 16 neurons, ≤3 axons, ≤3 dendrites) | 68.9% |
| Cube 11 / 13 / 15 | 66.9 / 64.5 / 58.1% |
| Cube 13 with longer reach (14 cells, 42 steps) | 66.2% |
| Cube 13 with 48 neurons (same density) | 66.3% |
| Neurons 8 / 12 / 24 / 32 | 65.8 / 68.1 / 70.1 / 68.5% |
| Axons ≤1 / ≤2 / ≤5 | 69.5 / 67.9 / 64.7% |
| Dendrites ≤1 / ≤2 / ≤5 | 62.6 / 69.3 / 67.8% |
| Axons ≤5 and dendrites ≤5 | 65.8% |

- **A bigger cube hurts.** The input and output stay the same size, so extra
  space only adds distance: connectors take longer to reach anything, fewer
  answers happen, and some networks barely learn. Longer reach recovers about
  half of the loss; keeping the neuron density doesn't help.
- **Network size barely matters** from 12 to 32 neurons.
- **One dendrite per neuron is too few:** neurons get about one input each and
  can't combine anything. Two or more is enough.
- **More connectors don't help, and more axons slightly hurt** (crowding and
  competition for dendrites). Five dendrites raise the average excitatory
  inputs per neuron from 1.9 to 2.7 without changing accuracy.
- **3 and 7 stay near chance in every configuration.** The ceiling of about
  70% doesn't respond to size, space or connectivity, which points to the
  learning rule (one flat ±0.2 for every responsible synapse) rather than to
  capacity.

## What you see

| Visual | Meaning |
| --- | --- |
| Pale, irregular body with a halo | Neuron body. The halo brightens as charge builds and flashes gold when it fires. |
| Cyan tube, thick at the body and tapering | Dendrite (signals in) |
| Coral tube with a cone at the body | Axon (signals out). The cone is the axon hillock; a connected axon ends in a round bouton at its synapse. |
| Tube thickness | Synapse weight, once connected |
| Smooth curves | Connectors are drawn as curves that cut the grid's corners, so paths look shorter than their cell routes. The simulation still grows them cell by cell: the faint tinted cubes show the cells they really occupy, and signals follow the drawn curves. |
| Faint tinted cube | A cell occupied by a connector |
| Lime cube | Synapse. Size shows weight; glow shows trophic support and fades before a prune. Responsible synapses flash on dopamine. |
| Magenta body, axon and signal | An inhibitory neuron, its axons and its signals |
| Magenta bar on a body | Inhibitory synapse (the "⊣" symbol), facing the incoming axon. Size shows weight; glow shows trophic support. |
| Gold glowing dot with a trail | A signal traveling one cell per tick |
| Violet glowing dot | A dark-channel signal, on its way to the first neuron. What a neuron fires is always gold. |
| Gold cells (front, outer) | Lit-channel cells; bright while their segment is lit, faint gold otherwise |
| Violet cells (front, inner) | Dark-channel cells; glow while their segment is unlit and flash when they fire, faint violet otherwise |
| Blue and red cells (back) | Output strip: blue = small, red = big |
| Gold cube outline | Dopamine is being released |
| Gold ring, expanding | A synapse was **strengthened** by the latest answer (and, on a correct answer, gained trophic support) |
| Blue ring, contracting | A synapse was **weakened** by the latest answer |
| Grey ring, bursting | A synapse was **pruned**: its weight or its trophic support ran out |
| Small white flash | A new synapse **formed** |
| "Last answer" in the HUD | How many synapses the latest answer strengthened, weakened and pruned |

Each synapse shows at most one strengthen or weaken ring per answer: if several
learning rules touch the same synapse, their changes are added up first.

## Parameters

All values live in `PARAMS` in [`web/brain.js`](../web/brain.js).

| Parameter | Value | Meaning |
| --- | --- | --- |
| `size` | 9 | Cube edge in cells. On a bigger cube the 9-wide digit and output strip are centered on their faces. (The app always draws 9.) |
| `neurons` | 16 | Number of neurons |
| `maxAxons` | 3 | Each neuron gets 1 to this many axons |
| `maxDendrites` | 3 | Each neuron gets 1 to this many dendrites |
| `maxLength` | 10 | Longest straightened path before a connector gives up |
| `maxSteps` | 30 | Tip steps without connecting before a connector gives up |
| `stuckLimit` | 6 | Blocked steps tolerated before giving up |
| `partialRetract` | 5 | Cells pulled back after a synapse is pruned |
| `avoidTicks` | 3000 | Ticks a connector avoids a pruned partner |
| `localRadius` | 4 | Regrowth goal distance from the tip after a prune |
| `cluster` | 0.5 | Chance regrowth aims near the owner's best-supported synapse |
| `clusterRadius` | 2 | Goal distance from that synapse |
| `growEvery` | 2 | Ticks between growth steps |
| `drift` | 0.6 | Chance a step moves toward the goal |
| `initialWeight` | 1 | Weight of a new synapse |
| `maxWeight` / `minWeight` | 2 / 0.05 | Weight limits |
| `pruneBelow` | 0.3 | Weight below which a synapse is pruned |
| `trophicStart` | 1 | Trophic support of a new synapse |
| `trophicDecay` | 0.9995 | Share of support kept each tick |
| `trophicShare` | 1 | Support a receiver shares among its responsible inputs per reward |
| `trophicMax` | 3 | Support limit |
| `trophicFloor` | 0.1 | Support below which a synapse is pruned |
| `inhibitoryShare` | 0.25 | Share of neurons that are inhibitory |
| `inhibitionFloor` | −0.2 | Charge an inhibitory signal pulls toward |
| `inhibitionStrength` | 0.5 | Share of the way to the floor per unit of weight |
| `shuntDecay` | 0.6 | Share of shunting kept each tick |
| `threshold` | 1 | Starting firing threshold |
| `minThreshold` / `maxThreshold` | 0.5 / 2.5 | Threshold limits |
| `thresholdRecovery` | 0.004 | Threshold drop per tick |
| `thresholdBoost` | 0.08 | Threshold rise per firing |
| `leak` | 0.7 | Share of charge kept each tick |
| `noise` | 0.08 | Max random charge added per tick |
| `refractory` | 4 | Rest ticks after firing |
| `coincidence` | 2 | Ticks within which an arrival counts toward a firing |
| `inputPeriod` | 5 | Ticks between signals from a lit segment |
| `window` | 35 | Trial tick when votes are compared |
| `trialTicks` | 60 | Trial length before giving up |
| `reward` / `punish` | 0.2 / 0.2 | Weight change after a correct / wrong answer |
| `pause` | 12 | Ticks between trials |
