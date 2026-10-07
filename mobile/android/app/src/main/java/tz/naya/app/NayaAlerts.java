package tz.naya.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.core.app.NotificationCompat;
import java.util.Map;

/**
 * Arifa za NAYA upande wa simu.
 *
 * Ombi jipya la safari kwa dereva: kengele (sauti ya naya_ring) inayojirudia mpaka sekunde 30,
 * hata kama app imefungwa au skrini imezimwa. Kengele inasimama dereva akigusa arifa, akibonyeza
 * "Zima kengele", akigusa app, ombi likiisha (server inatuma offer_cancel), au sekunde 30 zikipita.
 */
final class NayaAlerts {
    static final String CH_OFFER = "naya_offer_ring_v1";
    static final String CH_GENERAL = "naya_general_v1";
    static final int OFFER_ID = 4201;
    static final long RING_MS = 30_000L;
    static final String PREFS = "naya_native";
    static final String KEY_TOKEN = "fcm_token";
    static final String KEY_RING_RIDE = "ring_ride";
    static final String EXTRA_OFFER = "naya_offer";
    static final long[] VIBRATE = new long[] { 0, 700, 400, 700, 400, 700, 1200 };

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static Runnable pendingStop;

    private NayaAlerts() {}

    static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void saveToken(Context c, String token) {
        prefs(c).edit().putString(KEY_TOKEN, token).apply();
    }

    static String savedToken(Context c) {
        return prefs(c).getString(KEY_TOKEN, null);
    }

    static Uri ringUri(Context c) {
        return Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + c.getPackageName() + "/" + R.raw.naya_ring);
    }

    private static NotificationManager manager(Context c) {
        return (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
    }

    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = manager(c);
        if (nm == null) return;

        NotificationChannel offer = new NotificationChannel(CH_OFFER, "Maombi ya safari (kengele)", NotificationManager.IMPORTANCE_HIGH);
        offer.setDescription("Kengele ya sekunde 30 ombi jipya la safari likifika");
        AudioAttributes ring = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        offer.setSound(ringUri(c), ring);
        offer.enableVibration(true);
        offer.setVibrationPattern(VIBRATE);
        offer.enableLights(true);
        offer.setLightColor(Color.YELLOW);
        offer.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(offer);

        NotificationChannel general = new NotificationChannel(CH_GENERAL, "Taarifa za NAYA", NotificationManager.IMPORTANCE_DEFAULT);
        general.setDescription("Safari yako, malipo ya ada na taarifa nyingine");
        nm.createNotificationChannel(general);
    }

    static boolean notificationsEnabled(Context c) {
        NotificationManager nm = manager(c);
        if (nm == null) return false;
        if (Build.VERSION.SDK_INT >= 24 && !nm.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = nm.getNotificationChannel(CH_OFFER);
            if (ch != null && ch.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        }
        return true;
    }

    static boolean canFullScreen(Context c) {
        if (Build.VERSION.SDK_INT < 34) return true;
        NotificationManager nm = manager(c);
        return nm != null && nm.canUseFullScreenIntent();
    }

    private static int immutable() {
        return PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    }

    private static PendingIntent openApp(Context c, String rideId, int requestCode) {
        Intent open = new Intent(c, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (rideId != null) open.putExtra(EXTRA_OFFER, rideId);
        return PendingIntent.getActivity(c, requestCode, open, immutable());
    }

    private static String text(Map<String, String> data, String key, String fallback) {
        String v = data.get(key);
        return v == null || v.isEmpty() ? fallback : v;
    }

    /** Ombi jipya la safari: piga kengele. force=true ni kwa "Jaribu kengele" (hata app ikiwa wazi). */
    static void showOffer(Context c, Map<String, String> data, boolean force, long ringMs) {
        // App ikiwa wazi mbele ya dereva, ukurasa wenyewe unaonyesha ombi na kupiga kengele yake.
        if (!force && MainActivity.isForeground()) return;

        long ms = ringMs;
        String expires = data.get("expiresAt");
        if (expires != null) {
            try {
                long left = Long.parseLong(expires) - System.currentTimeMillis();
                if (left <= 0) return; // ombi limekwisha muda wake njiani
                ms = Math.min(ms, left);
            } catch (NumberFormatException ignored) {
                // tumia muda wa kawaida
            }
        }

        ensureChannels(c);
        NotificationManager nm = manager(c);
        if (nm == null) return;

        String rideId = text(data, "rideId", "test");
        prefs(c).edit().putString(KEY_RING_RIDE, rideId).apply();

        PendingIntent open = openApp(c, rideId, 1);
        Intent stopIntent = new Intent(c, StopRingReceiver.class);
        PendingIntent stop = PendingIntent.getBroadcast(c, 2, stopIntent, immutable());

        String title = text(data, "title", "Ombi jipya la safari");
        String body = text(data, "body", "Fungua NAYA kuona na kukubali ombi.");

        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH_OFFER)
            .setSmallIcon(R.drawable.ic_stat_naya)
            .setColor(0xFF0A6E47)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(open)
            .addAction(0, "Fungua NAYA", open)
            .addAction(0, "Zima kengele", stop)
            .setTimeoutAfter(ms)
            .setSound(ringUri(c), AudioManager.STREAM_RING)
            .setVibrate(VIBRATE)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true);
        if (canFullScreen(c)) b.setFullScreenIntent(open, true);

        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT; // sauti inajirudia mpaka arifa iondolewe
        try {
            nm.notify(OFFER_ID, n);
        } catch (SecurityException e) {
            return; // ruhusa ya arifa haijatolewa
        }

        // Android 7 haina setTimeoutAfter — simamisha kwa mkono baada ya muda.
        final Context app = c.getApplicationContext();
        synchronized (NayaAlerts.class) {
            if (pendingStop != null) MAIN.removeCallbacks(pendingStop);
            pendingStop = () -> stopRinging(app);
            MAIN.postDelayed(pendingStop, ms);
        }
    }

    /** Ombi limekubaliwa, limekataliwa au limepewa dereva mwingine. */
    static void cancelOffer(Context c, String rideId) {
        String ringing = prefs(c).getString(KEY_RING_RIDE, null);
        if (rideId == null || ringing == null || rideId.equals(ringing)) stopRinging(c);
    }

    static void stopRinging(Context c) {
        NotificationManager nm = manager(c);
        if (nm != null) nm.cancel(OFFER_ID);
        prefs(c).edit().remove(KEY_RING_RIDE).apply();
        synchronized (NayaAlerts.class) {
            if (pendingStop != null) {
                MAIN.removeCallbacks(pendingStop);
                pendingStop = null;
            }
        }
    }

    static boolean isRinging(Context c) {
        return prefs(c).getString(KEY_RING_RIDE, null) != null;
    }

    /** Taarifa ya kawaida (safari imeanza, ada, nk.). */
    static void showNotice(Context c, String title, String body, String tag) {
        if (title == null || title.isEmpty()) return;
        ensureChannels(c);
        NotificationManager nm = manager(c);
        if (nm == null) return;
        String text = body == null ? "" : body;
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH_GENERAL)
            .setSmallIcon(R.drawable.ic_stat_naya)
            .setColor(0xFF0A6E47)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(openApp(c, null, 3));
        int id = tag == null || tag.isEmpty() ? (int) (System.currentTimeMillis() % 100000) + 5000 : (tag.hashCode() & 0x7fffffff) % 100000 + 5000;
        try {
            nm.notify(id, b.build());
        } catch (SecurityException ignored) {
            // ruhusa ya arifa haijatolewa
        }
    }
}
