package com.example.neurons;

import android.app.Activity;
import android.os.Bundle;

public final class MainActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(new BrainView(this));
    }
}
