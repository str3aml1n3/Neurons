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

## Copilot emulator

After `.github/workflows/copilot-setup-steps.yml` is merged into the default
branch, Copilot's setup installs the Android emulator, an API 35 x86_64 image,
and an AVD named `neurons-api35`, and warms the Gradle build cache. GitHub's
Copilot setup supports runner steps, but not a job-level container; the SDK is
therefore installed on its Ubuntu runner rather than in a custom container.
Hardware acceleration depends on `/dev/kvm` being exposed to the agent. If it
is unavailable, the emulator can use `-accel off`, which is much slower.

For example, start the AVD with
`"$ANDROID_HOME/emulator/emulator" -avd neurons-api35 -no-window -no-audio -no-snapshot`
and wait for Android to boot before installing an APK with
`"$ANDROID_HOME/platform-tools/adb" install -r app/build/outputs/apk/debug/app-debug.apk`.
Launch the app with `adb shell am start -n io.github.str3aml1n3.neurons/com.example.neurons.MainActivity`
and capture a screenshot with `adb exec-out screencap -p > screenshot.png`.
Network restrictions, runner architecture, or unavailable acceleration can
still prevent the emulator from starting.

## Google Play internal prototype

The **Publish prototype** workflow is manual, runs only from the default branch,
and targets the Play **internal testing** track, never production. The application
ID is `io.github.str3aml1n3.neurons`; confirm it is available in Play Console
before creating the app. It differs from the previous debug-only
`com.example.neurons`, so Android treats the new APK as a separate app.
The application ID cannot be changed after the Play app is published.

The debug APK's signing key is generated on each runner and is not suitable for
Play. A persistent upload key must be generated and retained by the owner; do
not commit the keystore or private key. The public upload certificate is not a
private key. Play App Signing uses a separate app signing key for APKs delivered
to users.

1. On a trusted machine, create an upload key outside the repository. Keep
   the keystore and passwords securely backed up, and use the same key for
   future releases. Choose strong passwords when prompted:
   ```sh
   keytool -genkeypair -v -keystore ~/neurons-upload.jks -alias neurons-upload \
     -keyalg RSA -keysize 4096 -validity 10000
   keytool -exportcert -rfc -keystore ~/neurons-upload.jks -alias neurons-upload \
     -file ~/neurons-upload-certificate.pem
   keytool -printcert -file ~/neurons-upload-certificate.pem
   ```
   The PEM file and SHA-256 fingerprint are the public certificate for this
   upload key. No permanent release certificate exists until you create one.
2. Create a GitHub Actions environment named `play-internal`; restrict its
   deployment branches to the default branch and configure required reviewers.
   Add these **environment secrets** (or equivalent repository secrets):
   `ANDROID_KEYSTORE_BASE64` (the output of `base64 -w 0 ~/neurons-upload.jks`
   on Linux), `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`neurons-upload`
   above), and `ANDROID_KEY_PASSWORD`. Never paste secret values into a PR or
   commit. Configure `PLAY_SERVICE_ACCOUNT_JSON` later for publishing.
3. Run **Publish prototype** from the default branch with `publish` unchecked
   and a positive `version_code`. Download the `neurons-release-<version>`
   artifact: it contains the signed APK, AAB, and `upload-certificate.pem`.
   The workflow also prints the certificate fingerprints. Compare its SHA-256
   fingerprint with the one from step 1 before registering or uploading it.
4. Create the app in Play Console using that exact application ID, enroll in
   Play App Signing, and manually upload the signed AAB to the internal testing
   track for the first release. Complete Play Console's required setup and
   configure internal testers. The APK/AAB is signed with the upload key;
   Play-generated APKs use the Play app signing key.
5. Enable the Google Play Developer API for a Google Cloud project, create a
   service account, and grant its email the minimum testing-release permissions
   for this app in Play Console. Add its JSON key as the
   `PLAY_SERVICE_ACCOUNT_JSON` environment secret. Protect the environment and
   key; this account can publish to the testing track.
6. For later releases, run **Publish prototype** with `publish` checked and a
   version code greater than every code previously uploaded to Play. This
   uploads the AAB to internal testing. Play may require further account or
   review steps; this workflow does not publish to production.
