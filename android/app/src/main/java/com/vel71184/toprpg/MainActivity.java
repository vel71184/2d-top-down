package com.vel71184.toprpg;

import android.os.Bundle;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    /** Fullscreen game mode: status and navigation bars hidden; swipe from an edge to show them briefly. */
    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    // ------------------------------------------------------------------
    // Game controllers (8BitDo, Xbox, PlayStation...). The WebView doesn't
    // reliably expose the browser Gamepad API, so controller input is caught
    // here and forwarded to the game (see src/engine/gamepad.ts).
    // ------------------------------------------------------------------

    private static boolean isFromController(int source) {
        return (source & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
            || (source & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK
            || (source & InputDevice.SOURCE_DPAD) == InputDevice.SOURCE_DPAD;
    }

    /** Maps Android key codes to the game's position-based button names. */
    private static String buttonName(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_BUTTON_A:
            case KeyEvent.KEYCODE_DPAD_CENTER:
                return "a";
            case KeyEvent.KEYCODE_BUTTON_B:
            case KeyEvent.KEYCODE_BACK: // some controllers send BACK for B; never let it close the game
                return "b";
            case KeyEvent.KEYCODE_BUTTON_X: return "x";
            case KeyEvent.KEYCODE_BUTTON_Y: return "y";
            case KeyEvent.KEYCODE_BUTTON_L1: return "l1";
            case KeyEvent.KEYCODE_BUTTON_R1: return "r1";
            case KeyEvent.KEYCODE_BUTTON_START:
            case KeyEvent.KEYCODE_MENU:
                return "start";
            case KeyEvent.KEYCODE_BUTTON_SELECT: return "select";
            case KeyEvent.KEYCODE_DPAD_UP: return "up";
            case KeyEvent.KEYCODE_DPAD_DOWN: return "down";
            case KeyEvent.KEYCODE_DPAD_LEFT: return "left";
            case KeyEvent.KEYCODE_DPAD_RIGHT: return "right";
            default: return null;
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (isFromController(event.getSource())) {
            String name = buttonName(event.getKeyCode());
            if (name != null) {
                int action = event.getAction();
                if (event.getRepeatCount() == 0 && (action == KeyEvent.ACTION_DOWN || action == KeyEvent.ACTION_UP)) {
                    sendToGame("button('" + name + "'," + (action == KeyEvent.ACTION_DOWN) + ")");
                }
                return true; // handled: don't also deliver it to the WebView or the system
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent event) {
        if ((event.getSource() & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK
            && event.getAction() == MotionEvent.ACTION_MOVE) {
            float x = centeredAxis(event, MotionEvent.AXIS_X);
            float y = centeredAxis(event, MotionEvent.AXIS_Y);
            float hatX = event.getAxisValue(MotionEvent.AXIS_HAT_X);
            float hatY = event.getAxisValue(MotionEvent.AXIS_HAT_Y);
            sendToGame(String.format(Locale.US, "axes(%.3f,%.3f,%.3f,%.3f)", x, y, hatX, hatY));
            return true;
        }
        return super.dispatchGenericMotionEvent(event);
    }

    /** Axis value with the controller's own dead zone ("flat" area) treated as zero. */
    private static float centeredAxis(MotionEvent event, int axis) {
        InputDevice device = event.getDevice();
        float value = event.getAxisValue(axis);
        if (device != null) {
            InputDevice.MotionRange range = device.getMotionRange(axis, event.getSource());
            if (range != null && Math.abs(value) <= range.getFlat()) return 0f;
        }
        return value;
    }

    private void sendToGame(String call) {
        if (bridge == null) return;
        WebView webView = bridge.getWebView();
        if (webView == null) return;
        webView.evaluateJavascript("window.__nativeGamepad && window.__nativeGamepad." + call, null);
    }
}
