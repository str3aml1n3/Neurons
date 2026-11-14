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

**Elimination.** Each connector counts its failures in a row (prunes and
give-ups); earning trophic support resets the count. After **3 failures** it
retracts completely and is **removed**. A neuron always keeps at least one
dendrite and one axon. So neurons lose connectors that never earn their keep:
they settle at about one dendrite and one axon, with a third fewer synapses
and the same accuracy (see
[Connector lifecycle experiments](#connector-lifecycle-experiments)).

## How well it learns

The headless test (`node tests/brain.test.mjs`) runs 5 random networks for
30,000 ticks each. Over each run's last 300 answers, accuracy averages about
**69%** (chance is 50%). It learns, but only modestly. Results vary a lot
between networks: averages over 10 networks still move by 3–4 points from one
set of networks to another, so the experiments below use two or three sets.

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
| Cube 7 / 8 | 67.9 / 71.0% |
| Cube 7 with 8 or 12 neurons; cube 8 with 12 neurons | 68.9 / 65.8%; 66.4% |
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
- **A smaller cube doesn't help.** Cubes 7 and 8 stay within noise of cube 9,
  though individual networks vary more (from 56% up to 92% at cube 8). On a
  cube smaller than 9 the digit and output strip shrink to the face (3-cell bars
  at cube 7), and at cube 7 only about 14.5 of 16 neurons fit. 7 is the
  minimum: below that, the dark rows of the middle and bottom bars collide.
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

### Learning experiments

Three changes to learning were tried, each switchable by a parameter and
**off by default**. Results use *balanced accuracy*, the mean of the ten
per-digit accuracies, because retrying wrong answers shows hard digits more
often and would otherwise distort the comparison.

| Option | Networks 1–10 | Networks 11–20 |
| --- | --- | --- |
| Baseline | 72.9% | 76.4% |
| **Synaptic scaling**: after an answer, each changed neuron rescales its excitatory inputs toward a budget (\`scaling\`, \`scalingTotal\`) | 63.9–71.5% depending on budget and rate | 71.5% (rate 0.3) |
| **Timing credit**: a synapse's change shrinks by \`timingCredit\` per tick its signal arrived before the firing | 71.9% (0.5), 74.4% (0.7) | 73.1% (0.7) |
| **Random next digit** after a wrong answer (\`retryWrong: false\`) | 67.8% | — |

- **Synaptic scaling hurt.** Making inputs compete for a fixed budget weakened
  the inputs that rarely get credit but are still needed, and they were pruned.
  The stronger the competition, the worse the accuracy.
- **Timing credit made no difference.** Its best setting scored above baseline
  on one set of networks and below on the other.
- **Retrying wrong answers helps.** Without retries, 0 and 7 dropped to 37%
  and 31%. Repetition gives hard digits extra practice, a natural curriculum.
  It is not the cause of the ~70% ceiling.

### Connector lifecycle experiments

Originally a neuron kept the number of dendrites and axons it was born with: a
pruned connector always regrew. Two rules let the count change during the
neuron's life. Elimination is **on by default** (after 3 failures); sprouting
is off:

- **Elimination** (\`eliminateAfter\`): a connector counts its failures (prunes
  and give-ups) in a row; earning trophic support resets the count. After this
  many failures it retracts completely and is removed. A neuron always keeps
  at least one dendrite and one axon.
- **Sprouting** (\`sproutChance\`, \`sproutActivity\`): each neuron keeps an
  *activity* trace, raised by 1 whenever it is in the chain of a correct answer
  and fading by \`activityDecay\` per tick. A neuron with enough activity and
  fewer than its maximum connectors occasionally grows a new one.
  \`startMinimal\` makes neurons start with one of each and grow from there.

| Setting | Networks 1–10 | Networks 11–20 | Synapses |
| --- | --- | --- | --- |
| Baseline | 72.9% | 76.4% | ~51 |
| **Eliminate after 3 failures** | 74.0% | 75.1% | **~34** |
| Eliminate after 2 failures | 73.5% | 71.8% | ~32 |
| Sprouting (rate 0.002 or 0.01) | 68.0–69.3% | — | ~64 |
| Elimination + sprouting (several variants) | 69.0–71.7% | 70.5% | 55–62 |

- **Elimination after 3 failures keeps the same accuracy with a third fewer
  synapses.** Neurons settle at about one dendrite and one axon instead of
  two, so much of the default wiring isn't doing anything useful.
- **Sprouting alone fills every neuron to its maximum and does slightly
  worse**, matching the earlier finding that more inputs don't help.
- **Together they churn**: about 800–950 sprouts and as many eliminations per
  network. New connectors grow toward random goals, mostly fail and are
  removed, and the still-active neuron sprouts again. Sprouting would need
  guidance, for example toward co-active neurons, to be useful.

### "Fire together, wire together" experiments

With \`coactivityGain\` above 0 (off by default), an excitatory connector
choosing a neuron to grow toward prefers partners that were active alongside
its owner in recent correct answers: the chance of each partner is weighted by
1 + gain × activity(owner) × activity(partner). Activity counts for digit
channels and output cells as well as neurons. Inhibitory axons still choose at
random. These runs all have elimination on.

| Setting | Networks 1–10 | Networks 11–20 | Combination neurons |
| --- | --- | --- | --- |
| Baseline | 74.0% | 75.1% | ~1.8 |
| Co-activity 2 / 10 / 50 | 75.5 / 68.1 / 73.0% | 73.6% (gain 2) | 1.3–2.2 |
| Co-activity 10 + sprouting | 73.3% | 70.1% | **~8** |
| Weak new synapses (0.6 or 0.75), with or without the above | 71.6–72.5% | — | 1.2–8.4 |
| Sparser firing (threshold target 1 per 30–120 ticks instead of 1 per 20) | 71.1–77.2% | 69.7–70.2% | 1.4–8.4 |

*Combination neurons* are neurons wired directly to two or more different digit
channels.

- **Guidance builds the right wiring.** With sprouting, combination neurons
  rise from about 2 to about 8 per network.
- **But they behave as OR, not AND.** They fire for 8.4–8.7 of the 10 digits
  on average (57–60% fire for nine or ten), so they carry little information.
  New synapses start at weight 1, the firing threshold, so any single input
  fires the neuron.
- **Neither weaker new synapses nor sparser firing fixed that.** Sparse firing
  at 1 per 40 ticks scored 77.2% on the first set of networks, then 69.7% and
  73.6% on two more: noise. No setting in this family beat the baseline
  consistently.

### NMDA-like boost experiments

Real dendrites respond supralinearly: NMDA receptors pass current only when the
membrane is already depolarized, so coincident inputs add up to more than their
sum. With \`nmdaGain\` above 0 (off by default), an excitatory input that arrives
while the neuron's charge is above \`nmdaVoltage\` (0.3) is multiplied by the
gain. Because charge leaks quickly, that only happens when inputs arrive within
about a tick of each other. For a neuron to act as AND, a single input must
also stay below threshold, so the boost was tested with weaker new synapses
and a higher minimum threshold.

| Setting (networks 1–10) | Balanced accuracy | Answers per run | Digits an active neuron fires for |
| --- | --- | --- | --- |
| Baseline | 74.0% | 791 | 5.5 |
| NMDA boost 2 alone | 70.9% | 753 | 5.0 |
| Weak synapses (0.6) + minimum threshold 0.9 | 70.0% | 543 | 4.9 |
| Boost + weak synapses + minimum 0.9 | 57.8–64.0% | 282–300 | 3.0–3.5 |
| …plus fire together | 63.0–65.7% | 397–439 | 4.7–6.2 |

- **Neurons became more selective**, firing for about 3 digits instead of 5.5:
  AND-like behavior.
- **But the network went quiet and lost accuracy.** Far fewer answers, and the
  combination neurons were pruned away. A selective neuron rarely fires at
  first; learning only credits synapses that fired a neuron in a *rewarded*
  answer, so its synapses earn no support and are pruned before they can
  become useful.
- **What's missing is learning without reward.** Every weight change in this
  model is gated by dopamine. Real synapses also strengthen from timing alone
  (Hebbian plasticity, STDP), with dopamine modulating it. That would let a
  selective neuron's coincident inputs consolidate before any reward arrives.

### Hebbian (STDP) experiments

Spike-timing-dependent plasticity changes synapses with no reward involved
(off by default):

- \`hebbRate\`: input that arrived up to 2 ticks *before* a neuron fired is
  strengthened by this much;
- \`hebbDepress\`: input that arrives up to 2 ticks *after* it fired is
  weakened by this much;
- \`hebbTrophic\`: each helpful arrival also earns this much trophic support
  (activity-dependent survival).

When scaling is also on, each neuron rescales its inputs right after its
Hebbian change: Hebbian growth plus normalization, the classic recipe
(Oja's and BCM rules) for selective feature detectors.

| Setting (networks 1–10) | Balanced accuracy | Answers per run | Digits an active neuron fires for |
| --- | --- | --- | --- |
| Baseline | 74.0% | 791 | 5.5 |
| STDP 0.02 or 0.05 | 71.7–73.1% | ~835 | 6.2–6.4 |
| STDP + support | 66.2% | 806 | 6.0 |
| NMDA + weak synapses + STDP + support | 57.8–61.6% | 609–741 | 5.0–6.2 |
| STDP + scaling 0.1–0.3 | 70.7–72.3% | ~830 | 5.6–6.1 |
| STDP + full scaling | 57.2% | 808 | 5.3 |
| NMDA + weak + STDP + support + scaling 0.3 | 70.1% | 376 | 3.6 |

- **STDP keeps the network active**, which rescues the quiet NMDA networks
  (answers rise from about 300 to 600–740).
- **But it undoes selectivity.** It strengthens whatever fires a neuron, so
  neurons drift back toward responding to most digits. This is the known
  weakness of Hebbian learning without competition.
- **Pairing it with scaling didn't fix that.** Gentle scaling came within 2
  points of the baseline; full scaling hurt badly. The one variant that kept
  neurons selective (3.6 digits) still ran too quietly to answer well.

**Overall:** across all the learning experiments (synaptic scaling, timing
credit, retry protocol, connector lifecycle, fire together, sparse firing,
NMDA-like boost, STDP), no mechanism improved on the baseline's ~74% balanced
accuracy consistently. Elimination is the only one kept on, because it keeps
accuracy with a third fewer synapses. The rest stay available as parameters.

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
| `size` | 9 | Cube edge in cells, at least 7. Up to 9, the digit and output strip fill their faces; on a bigger cube they stay 9 wide, centered. (The app always draws 9.) |
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
| `scaling` | 0 (off) | Experimental: synaptic scaling rate after an answer |
| `scalingTotal` | 0 | Experimental: input budget per neuron (0 = keep the average at `initialWeight`) |
| `timingCredit` | 0 (off) | Experimental: credit factor per tick between a signal's arrival and the firing |
| `retryWrong` | true | Show the same digit again after a wrong answer |
| `eliminateAfter` | 3 | Lifecycle: remove a connector after this many failures in a row (0 = never) |
| `sproutChance` | 0 (off) | Lifecycle: per-tick chance an active neuron below its maximum grows a new connector |
| `sproutActivity` | 1 | Lifecycle: activity a neuron needs before it can sprout |
| `activityDecay` | 0.999 | Lifecycle: share of activity kept per tick |
| `startMinimal` | false | Lifecycle: neurons start with one axon and one dendrite |
| `coactivityGain` | 0 (off) | Experimental: "fire together, wire together" bias toward co-active partners |
| `nmdaGain` | 0 (off) | Experimental: multiplier for input arriving while the neuron is already charged |
| `nmdaVoltage` | 0.3 | Experimental: charge above which the NMDA-like boost applies |
| `hebbRate` | 0 (off) | Experimental STDP: weight gain for input that arrived just before the neuron fired |
| `hebbDepress` | 0 (off) | Experimental STDP: weight loss for input that arrived just after it fired |
| `hebbTrophic` | 0 | Experimental STDP: trophic support earned per helpful arrival |
| `pause` | 12 | Ticks between trials |
