package tz.naya.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Kitufe cha "Zima kengele" kwenye arifa ya ombi. */
public class StopRingReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        NayaAlerts.stopRinging(context);
    }
}
