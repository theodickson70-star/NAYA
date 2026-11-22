package tz.naya.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.app.NotificationCompat;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Dereva yuko online: huduma hii inaendelea kutuma mahali alipo kwa server ya NAYA hata skrini ikiwa imezimwa
 * au app ikiwa nyuma (Android inasimamisha ukurasa wa app, lakini si huduma hii). Kwa hiyo server inaendelea
 * kumpa maombi ya safari, na kengele (Firebase) inamwamsha.
 *
 * Inaonyesha arifa ndogo ya kudumu "NAYA: Uko online" — Android inaitaka kwa huduma za mahali.
 * Inasimama dereva akienda offline, akitoka kwenye akaunti, au server ikisema hayuko online tena.
 */
public class NayaDriverService extends Service {

    static final String CH_ONLINE = "naya_online_v1";
    private static final int NOTIFICATION_ID = 7301;
    private static final long PING_MS = 30_000L;
    private static final String PREFS = "naya_driver_service";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService net = Executors.newSingleThreadExecutor();
    private LocationManager locations;
    private Location last;
    private String token;
    private String base;
    private boolean running;

    private final LocationListener listener = new LocationListener() {
        @Override
        public void onLocationChanged(Location location) {
            if (location != null) last = location;
        }

        @Override
        public void onStatusChanged(String provider, int status, Bundle extras) {}

        @Override
        public void onProviderEnabled(String provider) {}

        @Override
        public void onProviderDisabled(String provider) {}
    };

    private final Runnable ping = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            sendLocation();
            handler.postDelayed(this, PING_MS);
        }
    };

    // ------------------------------------------------------------------ kuanzisha / kusimamisha (kutoka NayaNativePlugin)

    static void start(Context c, String token, String base) {
        c.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("token", token).putString("base", base).apply();
        Intent i = new Intent(c, NayaDriverService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    static void stop(Context c) {
        c.getSharedPreferences(PREFS, MODE_PRIVATE).edit().clear().apply();
        c.stopService(new Intent(c, NayaDriverService.class));
    }

    static boolean hasLocationPermission(Context c) {
        return c.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || c.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    // ------------------------------------------------------------------ huduma

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        token = prefs.getString("token", null);
        base = prefs.getString("base", null);
        if (token == null || base == null || !hasLocationPermission(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        Notification n = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(NOTIFICATION_ID, n);
        } catch (Exception e) {
            // Android 12+ hairuhusu kuanzisha huduma hii app ikiwa nyuma (mf. baada ya simu kuiua) — dereva akifungua
            // app tena, ukurasa unaianzisha upya.
            stopSelf();
            return START_NOT_STICKY;
        }

        if (!running) {
            running = true;
            startLocationUpdates();
            handler.postDelayed(ping, 5_000L);
        }
        // Android ikiiua huduma kwa kukosa kumbukumbu, irudishe (token na anwani ziko kwenye prefs).
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacks(ping);
        try {
            if (locations != null) locations.removeUpdates(listener);
        } catch (SecurityException ignored) {
            // ruhusa imeondolewa
        }
        net.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void startLocationUpdates() {
        locations = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (locations == null) return;
        try {
            for (String provider : new String[] { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER }) {
                if (locations.isProviderEnabled(provider)) {
                    locations.requestLocationUpdates(provider, 20_000L, 15f, listener, Looper.getMainLooper());
                    Location known = locations.getLastKnownLocation(provider);
                    if (known != null && (last == null || known.getTime() > last.getTime())) last = known;
                }
            }
        } catch (SecurityException e) {
            stopSelf();
        }
    }

    /** POST /api/driver/location — ikijibu 401/403/409 (ametoka / hayuko online) huduma inasimama. */
    private void sendLocation() {
        final Location loc = last;
        if (loc == null) return;
        final String body = String.format(Locale.US, "{\"lat\":%.6f,\"lng\":%.6f}", loc.getLatitude(), loc.getLongitude());
        net.execute(() -> {
            HttpURLConnection http = null;
            try {
                http = (HttpURLConnection) new URL(base + "/api/driver/location").openConnection();
                http.setRequestMethod("POST");
                http.setConnectTimeout(10_000);
                http.setReadTimeout(10_000);
                http.setDoOutput(true);
                http.setRequestProperty("content-type", "application/json");
                http.setRequestProperty("authorization", "Bearer " + token);
                http.setRequestProperty("x-naya-client", "android-service");
                try (OutputStream out = http.getOutputStream()) {
                    out.write(body.getBytes(StandardCharsets.UTF_8));
                }
                int code = http.getResponseCode();
                if (code == 401 || code == 403 || code == 409) handler.post(() -> stop(this));
            } catch (Exception ignored) {
                // hakuna mtandao sasa hivi — tunajaribu tena baada ya sekunde 30
            } finally {
                if (http != null) http.disconnect();
            }
        });
    }

    // ------------------------------------------------------------------ arifa ya kudumu

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CH_ONLINE) != null) return;
        NotificationChannel ch = new NotificationChannel(CH_ONLINE, "Uko online (dereva)", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Inaonyesha kwamba NAYA inapokea maombi ya safari hata skrini ikiwa imezimwa");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private Notification buildNotification() {
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open == null) open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 7301, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CH_ONLINE)
            .setSmallIcon(R.drawable.ic_stat_naya)
            .setColor(getResources().getColor(R.color.naya_green))
            .setContentTitle("NAYA: Uko online")
            .setContentText("Unapokea maombi ya safari hata skrini ikiwa imezimwa.")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(tap)
            .build();
    }
}
