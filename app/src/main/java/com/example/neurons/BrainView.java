package com.example.neurons;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowInsets;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Random;

final class BrainView extends View {
    private final Brain brain = new Brain(new Random());
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final List<Brain.Point> surface = new ArrayList<>();
    private float yaw = -0.5f, pitch = -0.3f;
    private float lastX, lastY;
    private long lastStep;
    private float scale, centerX, centerY;
    private int insetLeft, insetTop, insetRight, insetBottom;

    BrainView(Context context) {
        super(context);
        for (int x = 0; x < Brain.SIZE; x++) {
            for (int y = 0; y < Brain.SIZE; y++) {
                for (int z = 0; z < Brain.SIZE; z++) {
                    if (x == 0 || y == 0 || z == 0 || x == 8 || y == 8 || z == 8) {
                        surface.add(new Brain.Point(x, y, z));
                    }
                }
            }
        }
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        long now = SystemClock.uptimeMillis();
        if (lastStep == 0) lastStep = now;
        if (now - lastStep >= 100) {
            brain.step();
            lastStep = now;
        }
        canvas.drawColor(Color.rgb(8, 14, 28));
        canvas.save();
        canvas.translate(insetLeft, insetTop);
        int width = getWidth() - insetLeft - insetRight;
        int height = getHeight() - insetTop - insetBottom;
        float density = getResources().getDisplayMetrics().density;
        scale = Math.min(width / 15f, height / 21f);
        centerX = width / 2f;
        centerY = height * 0.53f;

        Collections.sort(surface, new Comparator<Brain.Point>() {
            @Override public int compare(Brain.Point a, Brain.Point b) {
                return Float.compare(project(a.x, a.y, a.z)[2], project(b.x, b.y, b.z)[2]);
            }
        });
        for (Brain.Point p : surface) drawCell(canvas, p);
        for (Brain.Neuron neuron : brain.neurons) {
            drawLine(canvas, neuron.dendrite, Color.rgb(64, 194, 216), 1.4f * density);
            for (Brain.Edge edge : neuron.edges) {
                drawLine(canvas, edge.axon, Color.rgb(103, 113, 171), 1.1f * density);
            }
            float[] s = project(neuron.soma.x, neuron.soma.y, neuron.soma.z);
            paint.setColor(Color.rgb(88, 232, 214));
            canvas.drawCircle(s[0], s[1], 2.4f * density, paint);
        }
        Brain.Point signal = brain.signalPoint();
        if (signal != null) {
            float[] s = project(signal.x, signal.y, signal.z);
            paint.setColor(Color.rgb(255, 242, 103));
            canvas.drawCircle(s[0], s[1], 5f * density, paint);
        }

        paint.setColor(Color.WHITE);
        paint.setTextSize(20 * density);
        canvas.drawText("NEURONS", 18 * density, 32 * density, paint);
        paint.setTextSize(14 * density);
        canvas.drawText("Digit: " + brain.digit + "   |   Small: 0–4   Big: 5–9",
                18 * density, 57 * density, paint);
        canvas.drawText(brain.status, 18 * density, 79 * density, paint);
        canvas.drawText("Rewards: " + brain.rewards + " / " + brain.attempts,
                18 * density, 101 * density, paint);
        if (brain.dopamine > 0.1f) {
            paint.setColor(Color.rgb(255, 213, 74));
            canvas.drawText("DOPAMINE", 18 * density, 123 * density, paint);
        }
        paint.setColor(Color.rgb(188, 203, 222));
        canvas.drawText("Drag to rotate • opposite face: blue small → red big",
                18 * density, height - 38 * density, paint);
        canvas.drawText("Yellow = signal   •   cyan = neuron", 18 * density,
                height - 18 * density, paint);
        canvas.restore();
        postInvalidateDelayed(33);
    }

    @Override public WindowInsets onApplyWindowInsets(WindowInsets insets) {
        insetLeft = insets.getSystemWindowInsetLeft();
        insetTop = insets.getSystemWindowInsetTop();
        insetRight = insets.getSystemWindowInsetRight();
        insetBottom = insets.getSystemWindowInsetBottom();
        invalidate();
        return insets;
    }

    private void drawCell(Canvas canvas, Brain.Point p) {
        int color = Color.argb(24, 99, 145, 184);
        if (p.z == 0 && Brain.digitCell(brain.digit, p.x, p.y)) {
            color = Color.argb(205, 255, 209, 80);
        } else if (p.z == 8 && p.y == 4) {
            float t = p.x / 8f;
            color = Color.argb(210, (int) (50 + 205 * t), 100, (int) (255 - 190 * t));
        }
        float r = 0.43f;
        float[][] vertices = {
                {p.x-r,p.y-r,p.z-r}, {p.x+r,p.y-r,p.z-r},
                {p.x+r,p.y+r,p.z-r}, {p.x-r,p.y+r,p.z-r},
                {p.x-r,p.y-r,p.z+r}, {p.x+r,p.y-r,p.z+r},
                {p.x+r,p.y+r,p.z+r}, {p.x-r,p.y+r,p.z+r}
        };
        int[][] faces = {{0,1,2,3}, {4,5,6,7}, {0,1,5,4},
                {2,3,7,6}, {0,3,7,4}, {1,2,6,5}};
        for (int[] face : faces) {
            Path path = new Path();
            for (int i = 0; i < 4; i++) {
                float[] v = vertices[face[i]];
                float[] s = project(v[0], v[1], v[2]);
                if (i == 0) path.moveTo(s[0], s[1]); else path.lineTo(s[0], s[1]);
            }
            path.close();
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(color);
            canvas.drawPath(path, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(0.5f);
            paint.setColor(Color.argb(70, 116, 159, 190));
            canvas.drawPath(path, paint);
            paint.setStyle(Paint.Style.FILL);
        }
    }

    private void drawLine(Canvas canvas, List<Brain.Point> points, int color, float width) {
        paint.setColor(color);
        paint.setStrokeWidth(width);
        for (int i = 1; i < points.size(); i++) {
            Brain.Point a = points.get(i - 1), b = points.get(i);
            float[] p = project(a.x, a.y, a.z), q = project(b.x, b.y, b.z);
            canvas.drawLine(p[0], p[1], q[0], q[1], paint);
        }
    }

    private float[] project(float x, float y, float z) {
        x -= 4; y -= 4; z -= 4;
        float cx = (float) Math.cos(yaw), sx = (float) Math.sin(yaw);
        float cy = (float) Math.cos(pitch), sy = (float) Math.sin(pitch);
        float rotatedX = x * cx - z * sx;
        float depth = x * sx + z * cx;
        return new float[]{centerX + rotatedX * scale, centerY + (y * cy - depth * sy) * scale,
                y * sy + depth * cy};
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        float x = 0, y = 0;
        int count = 0;
        for (int i = 0; i < event.getPointerCount(); i++) {
            if (event.getActionMasked() == MotionEvent.ACTION_POINTER_UP
                    && i == event.getActionIndex()) continue;
            x += event.getX(i);
            y += event.getY(i);
            count++;
        }
        x /= count;
        y /= count;
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
            case MotionEvent.ACTION_POINTER_DOWN:
            case MotionEvent.ACTION_POINTER_UP:
                lastX = x; lastY = y;
                return true;
            case MotionEvent.ACTION_MOVE:
                yaw += (x - lastX) * 0.01f;
                pitch += (y - lastY) * 0.01f;
                lastX = x; lastY = y;
                invalidate();
                return true;
            case MotionEvent.ACTION_UP:
                performClick();
                return true;
            default:
                return true;
        }
    }

    @Override public boolean performClick() {
        super.performClick();
        return true;
    }
}
