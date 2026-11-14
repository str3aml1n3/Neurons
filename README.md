# Neurons

An Android toy simulation of a tiny neural network inside a rotatable 9 × 9 × 9
cube. Drag with one or more fingers to rotate it. The gold seven-segment digit
is on one face; the opposite face has a blue-to-red output strip. Blue is
**small** (0–4), red is **big** (5–9). Cyan dots are neuron bodies, cyan lines
are dendrites, purple lines are growing axons, and a yellow dot is a signal.
The cube is transparent so the network can be seen through its surface.

The lit segments stimulate input neurons. A signal travels along weighted,
growing connections to the output strip. Reaching the correct half causes a
visible dopamine-like reward and a new random digit; an incorrect answer
retries the same digit. Reward strengthens recently used connections, while
an incorrect answer weakens them. The simulation runs locally and resets when
the app is restarted; it does not require network access.

This is an **educational toy, not a biologically accurate brain simulation**.
It uses a fixed three-layer arrangement, grid-based growth toward selected
targets, and a simple reward-gated weight update. Dendrites are visual growth
proxies, not a detailed model of synaptic chemistry; there is no claim of
reliable learning or biological timescales. The design is loosely inspired by
research on [neurite outgrowth](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0086741),
[activity-dependent plasticity](https://neuronaldynamics.epfl.ch/online/Ch19.S2.html),
and [dopamine reward signals](https://pmc.ncbi.nlm.nih.gov/articles/PMC8116345/);
it does not implement those papers' full models.

## Download and install

Open the repository's **Actions** tab, select a successful **Android APK**
run, and download the **neurons-debug-apk** artifact. Unzip it and transfer
`app-debug.apk` to an Android 6.0 or newer device. Open the APK and allow
installation from that source if Android asks. This is a debug-signed build,
not a Play Store release.

To build locally, install JDK 17 and Android SDK platform 35, then run
`./gradlew assembleDebug`. The APK is at
`app/build/outputs/apk/debug/app-debug.apk`.

The dependency-free simulation checks can also be run with JDK 17:

```sh
mkdir -p /tmp/neurons-test
javac -d /tmp/neurons-test app/src/main/java/com/example/neurons/Brain.java app/src/test/java/com/example/neurons/BrainTest.java
java -cp /tmp/neurons-test com.example.neurons.BrainTest
```
