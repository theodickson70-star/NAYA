package tz.naya.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * "Sasisha" ndani ya app: inapakua APK mpya ya NAYA na kufungua dirisha la Android la "Install".
 * Android hairuhusu app iliyo nje ya Play Store kujisakinisha kimya — mtumiaji anabonyeza "Install" mwenyewe.
 *
 * Usalama: APK iliyopakuliwa inakaguliwa kabla ya kufunguliwa — lazima iwe ya app hii hii (tz.naya.app) na toleo
 * jipya kuliko lililopo. Android yenyewe inakataa APK isiyo na sahihi (signature) ile ile.
 */
final class NayaUpdater {

    static final String IDLE = "idle";
    static final String DOWNLOADING = "downloading";
    static final String READY = "ready";
    static final String ERROR = "error";

    private static volatile String state = IDLE;
    private static volatile int percent = 0;
    private static volatile String error = null;
    private static volatile File apk = null;

    private NayaUpdater() {}

    static String state() { return state; }
    static int percent() { return percent; }
    static String error() { return error; }

    static long currentVersionCode(Context c) {
        try {
            PackageInfo p = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    /** Android 8+: mtumiaji lazima aruhusu NAYA "kusakinisha programu" mara ya kwanza. */
    static boolean canInstall(Context c) {
        return Build.VERSION.SDK_INT < 26 || c.getPackageManager().canRequestPackageInstalls();
    }

    static void openInstallPermission(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + c.getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            c.startActivity(i);
        } catch (Exception e) {
            c.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + c.getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
    }

    /** Anza kupakua (kama haipakui tayari). Ikimaliza, dirisha la "Install" linafunguka lenyewe. */
    static synchronized void start(final Context app, final String url) {
        if (DOWNLOADING.equals(state)) return;
        state = DOWNLOADING;
        percent = 0;
        error = null;
        new Thread(() -> {
            try {
                File dir = new File(app.getCacheDir(), "sasisha");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("Hakuna nafasi kwenye simu");
                File out = new File(dir, "NAYA.apk");
                download(url, out);
                verify(app, out);
                apk = out;
                state = READY;
                percent = 100;
                openInstaller(app);
            } catch (Exception e) {
                error = e.getMessage() == null ? "Upakuaji umeshindwa" : e.getMessage();
                state = ERROR;
            }
        }, "naya-sasisha").start();
    }

    /** Fungua tena dirisha la "Install" (mf. mtumiaji alilifunga kabla ya kubonyeza Install). */
    static boolean reopen(Context app) {
        if (apk == null || !apk.exists()) return false;
        openInstaller(app);
        return true;
    }

    private static void download(String url, File out) throws Exception {
        HttpURLConnection http = null;
        try {
            URL u = new URL(url);
            // GitHub inaelekeza (redirect) mara mbili — HttpURLConnection inafuata https → https yenyewe; tunaruhusu 5.
            for (int hops = 0; hops < 5; hops++) {
                http = (HttpURLConnection) u.openConnection();
                http.setInstanceFollowRedirects(false);
                http.setConnectTimeout(15_000);
                http.setReadTimeout(30_000);
                http.setRequestProperty("x-naya-client", "android-updater");
                int code = http.getResponseCode();
                if (code >= 300 && code < 400) {
                    String next = http.getHeaderField("location");
                    http.disconnect();
                    if (next == null) throw new Exception("Upakuaji umeshindwa");
                    u = new URL(u, next);
                    if (!"https".equals(u.getProtocol())) throw new Exception("Upakuaji umeshindwa");
                    continue;
                }
                if (code != 200) throw new Exception("Upakuaji umeshindwa (" + code + ")");
                long total = http.getContentLength();
                long done = 0;
                try (InputStream in = http.getInputStream(); OutputStream os = new FileOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        os.write(buf, 0, n);
                        done += n;
                        if (total > 0) percent = (int) Math.min(99, done * 100 / total);
                    }
                }
                if (total > 0 && done != total) throw new Exception("Upakuaji haukukamilika. Jaribu tena.");
                return;
            }
            throw new Exception("Upakuaji umeshindwa");
        } catch (java.io.IOException e) {
            throw new Exception("Hakuna mtandao. Washa data kisha jaribu tena.");
        } finally {
            if (http != null) http.disconnect();
        }
    }

    private static void verify(Context c, File f) throws Exception {
        PackageInfo p = c.getPackageManager().getPackageArchiveInfo(f.getAbsolutePath(), 0);
        if (p == null || !c.getPackageName().equals(p.packageName)) {
            f.delete();
            throw new Exception("Faili lililopakuliwa si la NAYA");
        }
        long code = Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
        if (code <= currentVersionCode(c)) {
            f.delete();
            throw new Exception("Tayari una toleo jipya zaidi");
        }
    }

    private static void openInstaller(Context c) {
        Uri uri = FileProvider.getUriForFile(c, c.getPackageName() + ".fileprovider", apk);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        c.startActivity(i);
    }

    /** Kusafisha: APK ya zamani iliyopakuliwa haihitajiki tena baada ya kusakinisha. */
    static void cleanup(Context c) {
        File f = new File(new File(c.getCacheDir(), "sasisha"), "NAYA.apk");
        if (f.exists() && !DOWNLOADING.equals(state)) {
            PackageManager pm = c.getPackageManager();
            PackageInfo p = pm.getPackageArchiveInfo(f.getAbsolutePath(), 0);
            long code = p == null ? 0 : (Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode);
            if (code <= currentVersionCode(c)) f.delete();
        }
    }
}
