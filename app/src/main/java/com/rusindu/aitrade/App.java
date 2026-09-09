package com.rusindu.aitrade;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;

/** Creates the notification channels used by the signal watcher. */
public class App extends Application {

    public static final String CHANNEL_SIGNALS = "signals";
    public static final String CHANNEL_STATUS = "status";

    @Override
    public void onCreate() {
        super.onCreate();
        applyTheme(this);
        createChannels();
    }

    /** Applies the saved light / dark / system preference. */
    public static void applyTheme(android.content.Context c) {
        String theme = com.rusindu.aitrade.store.Prefs.theme(c);
        switch (theme) {
            case "light":
                androidx.appcompat.app.AppCompatDelegate
                        .setDefaultNightMode(androidx.appcompat.app.AppCompatDelegate.MODE_NIGHT_NO);
                break;
            case "dark":
                androidx.appcompat.app.AppCompatDelegate
                        .setDefaultNightMode(androidx.appcompat.app.AppCompatDelegate.MODE_NIGHT_YES);
                break;
            default:
                androidx.appcompat.app.AppCompatDelegate
                        .setDefaultNightMode(androidx.appcompat.app.AppCompatDelegate
                                .MODE_NIGHT_FOLLOW_SYSTEM);
                break;
        }
    }

    private void createChannels() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;

        NotificationChannel signals = new NotificationChannel(
                CHANNEL_SIGNALS,
                getString(R.string.channel_signals),
                NotificationManager.IMPORTANCE_HIGH);
        signals.setDescription(getString(R.string.channel_signals_desc));
        signals.enableVibration(true);
        nm.createNotificationChannel(signals);

        NotificationChannel status = new NotificationChannel(
                CHANNEL_STATUS,
                getString(R.string.channel_status),
                NotificationManager.IMPORTANCE_LOW);
        status.setDescription(getString(R.string.channel_status_desc));
        nm.createNotificationChannel(status);
    }

    public static boolean canNotify(android.content.Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        return nm == null || nm.areNotificationsEnabled();
    }

    public static boolean needsPermission() {
        return Build.VERSION.SDK_INT >= 33;
    }
}
