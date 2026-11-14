package com.example.neurons;

import java.util.Random;

public final class BrainTest {
    public static void main(String[] args) {
        for (int digit = 0; digit < 10; digit++) {
            check(Brain.digitCell(digit, 4, 1) == ((Brain.DIGITS[digit] & 1) != 0),
                    "top segment");
            check(Brain.digitCell(digit, 4, 4) == ((Brain.DIGITS[digit] & 64) != 0),
                    "middle segment");
        }
        Brain brain = new Brain(new Random(42));
        int previousRewards = 0, previousAttempts = 0, previousDigit = brain.digit;
        for (int i = 0; i < 30000; i++) {
            Brain.Point previousSignal = brain.signalPoint();
            brain.step();
            if (brain.attempts != previousAttempts) {
                check(previousSignal != null && previousSignal.z == 8 && previousSignal.y == 4,
                        "answers must reach the output strip");
                boolean correct = (previousSignal.x < Brain.SIZE / 2) == (previousDigit < 5);
                check((brain.rewards > previousRewards) == correct,
                        "only the correct half earns a reward");
            }
            if (brain.rewards != previousRewards) {
                check(brain.rewards == previousRewards + 1, "one reward per answer");
                check(brain.attempts == previousAttempts + 1, "reward requires an answer");
                check(brain.digit != previousDigit, "reward must advance the problem");
                check(brain.dopamine == 1f, "reward must trigger dopamine");
            } else {
                check(brain.digit == previousDigit, "wrong answers must not advance");
            }
            previousRewards = brain.rewards;
            previousAttempts = brain.attempts;
            previousDigit = brain.digit;
        }
        check(brain.rewards > 0 && brain.attempts > brain.rewards, "both outcomes occur");
        for (Brain.Neuron neuron : brain.neurons) {
            for (Brain.Edge edge : neuron.edges) {
                check(edge.complete(), "axon must reach its target");
                check(edge.weight >= 0.2f && edge.weight <= 5f, "weights stay bounded");
                for (Brain.Point p : edge.axon) {
                    check(p.x >= 0 && p.x < Brain.SIZE && p.y >= 0 && p.y < Brain.SIZE
                            && p.z >= 0 && p.z < Brain.SIZE, "axon stays in the grid");
                }
            }
        }
        System.out.println("Brain simulation checks passed: " + brain.rewards
                + " rewards in " + brain.attempts + " attempts");
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
