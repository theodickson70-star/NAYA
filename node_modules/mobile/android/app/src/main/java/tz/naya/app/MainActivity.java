package tz.naya.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static volatile boolean foreground = false;

    static boolean isForeground() {
        return foreground;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NayaNativePlugin.class);
        super.onCreate(savedInstanceState);
        NayaAlerts.ensureChannels(this);
        applyLockScreen(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applyLockScreen(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        foreground = true;
    }

    @Override
    public void onPause() {
        foreground = false;
        super.onPause();
    }

    /** Dereva akigusa skrini, ameshaona ombi — nyamazisha kengele. */
    @Override
    public void onUserInteraction() {
        super.onUserInteraction();
        if (NayaAlerts.isRinging(this)) NayaAlerts.stopRinging(this);
    }

    /** Ombi likifika simu ikiwa imefungwa, onyesha NAYA juu ya skrini ya kufunga (kama simu inayoingia). */
    private void applyLockScreen(Intent intent) {
        boolean offer = intent != null && intent.hasExtra(NayaAlerts.EXTRA_OFFER);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(offer);
            setTurnScreenOn(offer);
        } else if (offer) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
    }
}
