package tz.naya.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.HashMap;
import java.util.Map;

/**
 * Daraja kati ya ukurasa wa NAYA (JavaScript) na simu.
 * Kutoka JS: window.Capacitor.nativePromise('NayaNative', '<method>', {...})
 */
@CapacitorPlugin(
    name = "NayaNative",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class NayaNativePlugin extends Plugin {

    private boolean firebaseReady() {
        try {
            return !FirebaseApp.getApps(getContext()).isEmpty();
        } catch (Exception e) {
            return false;
        }
    }

    private JSObject info() {
        Context c = getContext();
        JSObject r = new JSObject();
        r.put("native", true);
        r.put("platform", "android");
        r.put("sdk", Build.VERSION.SDK_INT);
        try {
            PackageInfo p = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            r.put("appVersion", p.versionName);
        } catch (Exception e) {
            r.put("appVersion", "?");
        }
        r.put("firebase", firebaseReady());
        r.put("notifications", NayaAlerts.notificationsEnabled(c));
        r.put("fullScreen", NayaAlerts.canFullScreen(c));
        r.put("token", NayaAlerts.savedToken(c));
        return r;
    }

    @PluginMethod
    public void getInfo(PluginCall call) {
        call.resolve(info());
    }

    @PluginMethod
    public void getToken(PluginCall call) {
        if (!firebaseReady()) {
            call.reject("Firebase haijawekwa kwenye APK hii", "NO_FIREBASE");
            return;
        }
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (task.isSuccessful() && task.getResult() != null) {
                    NayaAlerts.saveToken(getContext(), task.getResult());
                    JSObject r = new JSObject();
                    r.put("token", task.getResult());
                    call.resolve(r);
                } else {
                    call.reject("Imeshindwa kupata token ya arifa", "TOKEN_FAILED");
                }
            });
        } catch (Exception e) {
            call.reject("Imeshindwa kupata token ya arifa", "TOKEN_FAILED");
        }
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationsResult");
            return;
        }
        call.resolve(info());
    }

    @PermissionCallback
    private void notificationsResult(PluginCall call) {
        call.resolve(info());
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Context c = getContext();
        Intent i;
        if (Build.VERSION.SDK_INT >= 26) {
            i = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, c.getPackageName());
            i.putExtra(Settings.EXTRA_CHANNEL_ID, NayaAlerts.CH_OFFER);
        } else {
            i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + c.getPackageName()));
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            c.startActivity(i);
        } catch (Exception e) {
            c.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + c.getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve();
    }

    /** Android 14+: ruhusa ya kuonyesha ombi juu ya skrini iliyofungwa. */
    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        Context c = getContext();
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                Intent i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + c.getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                c.startActivity(i);
            } catch (Exception e) {
                c.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + c.getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void stopRinging(PluginCall call) {
        NayaAlerts.stopRinging(getContext());
        call.resolve();
    }

    /** "Jaribu kengele" kwenye Akaunti: dereva anasikia kengele itakavyolia (sekunde 8 kwa chaguo-msingi). */
    @PluginMethod
    public void testRing(PluginCall call) {
        int seconds = Math.max(3, Math.min(30, call.getInt("seconds", 8)));
        Map<String, String> data = new HashMap<>();
        data.put("title", "Jaribio la kengele ya NAYA");
        data.put("body", "Hivi ndivyo simu itakavyolia ombi jipya likifika. Gusa kuzima.");
        NayaAlerts.showOffer(getContext(), data, true, seconds * 1000L);
        call.resolve(info());
    }
}
