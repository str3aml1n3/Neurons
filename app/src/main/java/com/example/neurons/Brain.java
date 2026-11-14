package com.example.neurons;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/** A deliberately small, discrete model; coordinates are grid cells, not biological units. */
final class Brain {
    static final int SIZE = 9;
    // Seven-segment order: top, upper right, lower right, bottom, lower left, upper left, middle.
    static final int[] DIGITS = {63, 6, 91, 79, 102, 109, 125, 7, 127, 111};
    private static final int[][] POSITIONS = {
            {4, 1}, {7, 2}, {7, 6}, {4, 7}, {1, 6}, {1, 2}, {4, 4}
    };

    static final class Point {
        final int x, y, z;
        Point(int x, int y, int z) { this.x = x; this.y = y; this.z = z; }
    }

    static final class Neuron {
        final Point soma;
        final List<Point> dendrite = new ArrayList<>();
        final List<Edge> edges = new ArrayList<>();
        Neuron(Point soma) { this.soma = soma; dendrite.add(soma); }
    }

    static final class Edge {
        final Neuron target;
        final Point destination;
        final List<Point> axon = new ArrayList<>();
        float weight = 1f;
        Edge(Neuron source, Neuron target, Point destination) {
            this.target = target;
            this.destination = destination;
            axon.add(source.soma);
        }
        boolean complete() {
            Point p = axon.get(axon.size() - 1);
            return p.x == destination.x && p.y == destination.y && p.z == destination.z;
        }
    }

    final List<Neuron> neurons = new ArrayList<>();
    private final Random random;
    private final List<Edge> activePath = new ArrayList<>();
    private Edge signal;
    private int signalIndex;
    private int pause;
    private int ticks;
    int digit;
    int rewards;
    int attempts;
    float dopamine;
    String status = "Growing connections";

    Brain(Random random) {
        this.random = random;
        Neuron[][] layers = new Neuron[3][7];
        for (int layer = 0; layer < layers.length; layer++) {
            for (int i = 0; i < 7; i++) {
                layers[layer][i] = new Neuron(new Point(POSITIONS[i][0], POSITIONS[i][1], 1 + layer * 3));
                neurons.add(layers[layer][i]);
            }
        }
        for (int layer = 0; layer < 3; layer++) {
            for (int i = 0; i < 7; i++) {
                Neuron source = layers[layer][i];
                for (int branch = 0; branch < 2; branch++) {
                    Neuron target = layer < 2 ? layers[layer + 1][(i + branch * 3) % 7] : null;
                    Point destination = target != null ? target.soma
                            : new Point(branch == 0 ? 1 : 7, 4, SIZE - 1);
                    source.edges.add(new Edge(source, target, destination));
                }
            }
        }
        digit = random.nextInt(10);
    }

    void step() {
        ticks++;
        dopamine *= 0.9f;
        for (Neuron neuron : neurons) {
            if (neuron.dendrite.size() < 3 && ticks % 3 == 0) {
                Point p = neuron.dendrite.get(neuron.dendrite.size() - 1);
                neuron.dendrite.add(new Point(p.x, p.y, Math.max(0, p.z - 1)));
            }
            for (Edge edge : neuron.edges) {
                if (!edge.complete() && ticks % 2 == 0) grow(edge);
            }
        }
        if (pause > 0) {
            pause--;
            return;
        }
        if (signal == null) {
            List<Neuron> inputs = new ArrayList<>();
            for (int i = 0; i < 7; i++) {
                if ((DIGITS[digit] & (1 << i)) != 0) inputs.add(neurons.get(i));
            }
            startEdge(inputs.get(random.nextInt(inputs.size())));
            return;
        }
        if (++signalIndex < signal.axon.size()) return;
        if (!signal.complete()) {
            signalIndex = signal.axon.size() - 1;
            return;
        }
        if (signal.target != null) {
            startEdge(signal.target);
        } else {
            attempts++;
            boolean smallOutput = signal.destination.x < SIZE / 2;
            if (smallOutput == (digit < 5)) {
                rewards++;
                dopamine = 1f;
                for (Edge edge : activePath) edge.weight = Math.min(5f, edge.weight + 0.45f);
                status = "Correct! Dopamine reward";
                int nextDigit = random.nextInt(9);
                digit = nextDigit >= digit ? nextDigit + 1 : nextDigit;
            } else {
                for (Edge edge : activePath) edge.weight = Math.max(0.2f, edge.weight - 0.08f);
                status = "Not yet — trying again";
            }
            activePath.clear();
            signal = null;
            pause = 12;
        }
    }

    private void startEdge(Neuron neuron) {
        Edge a = neuron.edges.get(0), b = neuron.edges.get(1);
        signal = random.nextFloat() * (a.weight + b.weight) < a.weight ? a : b;
        activePath.add(signal);
        signalIndex = 0;
        status = "Signal traveling";
    }

    Point signalPoint() {
        return signal == null ? null : signal.axon.get(signalIndex);
    }

    private void grow(Edge edge) {
        Point p = edge.axon.get(edge.axon.size() - 1), d = edge.destination;
        int[] axes = new int[3];
        int count = 0;
        if (p.x != d.x) axes[count++] = 0;
        if (p.y != d.y) axes[count++] = 1;
        if (p.z != d.z) axes[count++] = 2;
        int axis = axes[random.nextInt(count)];
        edge.axon.add(new Point(p.x + (axis == 0 ? Integer.signum(d.x - p.x) : 0),
                p.y + (axis == 1 ? Integer.signum(d.y - p.y) : 0),
                p.z + (axis == 2 ? Integer.signum(d.z - p.z) : 0)));
    }

    static boolean digitCell(int digit, int x, int y) {
        int mask = DIGITS[digit];
        return ((mask & 1) != 0 && y == 1 && x >= 2 && x <= 6)
                || ((mask & 2) != 0 && x == 7 && y >= 2 && y <= 3)
                || ((mask & 4) != 0 && x == 7 && y >= 5 && y <= 6)
                || ((mask & 8) != 0 && y == 7 && x >= 2 && x <= 6)
                || ((mask & 16) != 0 && x == 1 && y >= 5 && y <= 6)
                || ((mask & 32) != 0 && x == 1 && y >= 2 && y <= 3)
                || ((mask & 64) != 0 && y == 4 && x >= 2 && x <= 6);
    }
}
