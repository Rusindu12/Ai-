package com.rusindu.aitrade.service;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.rusindu.aitrade.App;
import com.rusindu.aitrade.MainActivity;
import com.rusindu.aitrade.R;
import com.rusindu.aitrade.ai.Snapshot;
import com.rusindu.aitrade.core.TradeEngine;
import com.rusindu.aitrade.model.Candle;
import com.rusindu.aitrade.model.Direction;
import com.rusindu.aitrade.model.Signal;
import com.rusindu.aitrade.store.Prefs;
import com.rusindu.aitrade.util.Fmt;
import com.rusindu.aitrade.util.Intervals;

import org.json.JSONObject;

import java.util.List;

/**
 * Keeps the watcher alive when the app is in the background: polls Binance through
 * {@link TradeEngine} and raises a notification for every new signal.
 */
public class SignalService extends Service implements TradeEngine.Listener {

    public static final String ACTION_START = "com.rusindu.aitrade.START";
    public static final String ACTION_STOP = "com.rusindu.aitrade.STOP";
    private static final int ONGOING_ID = 1001;
    private static final int SIGNAL_ID = 2000;

    private int signalCounter;
    private TradeEngine engine;
    private String lastOngoingText = "";

    public static void start(Context c) {
        Intent i = new Intent(c, SignalService.class);
        i.setAction(ACTION_START);
        try {
            if (android.os.Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
            else c.startService(i);
        } catch (Exception ignored) {
            // background-start restrictions: the activity will retry when it is visible
        }
    }

    public static void stop(Context c) {
        c.startService(new Intent(c, SignalService.class).setAction(ACTION_STOP));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        engine = TradeEngine.get();
        engine.addListener(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopForegroundCompat();
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            startForeground(ONGOING_ID, ongoing(getString(R.string.status_starting)));
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        engine.start(this);
        Prefs.putBool(this, Prefs.K_WATCH, true);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        engine.removeListener(this);
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ------------------------------------------------------------------ engine callbacks

    @Override
    public void onMarketUpdate(List<Candle> candles, Snapshot snapshot, JSONObject ticker) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        String text;
        if (snapshot != null && snapshot.valid) {
            text = getString(R.string.notif_watching,
                    Fmt.pair(Prefs.symbol(this)),
                    Intervals.label(Prefs.interval(this)),
                    getString(directionLabel(snapshot.direction)));
        } else {
            text = getString(R.string.status_starting);
        }
        if (text.equals(lastOngoingText)) return; // do not re-post every poll
        lastOngoingText = text;
        nm.notify(ONGOING_ID, ongoing(text));
    }

    @Override
    public void onNewSignal(Signal signal) {
        if (!Prefs.notify(this) || !App.canNotify(this)) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;

        boolean buy = signal.direction == Direction.BUY;
        String title = getString(buy ? R.string.notif_buy_title : R.string.notif_sell_title,
                Fmt.pair(signal.symbol));
        String body = getString(R.string.notif_body,
                Fmt.price(signal.price),
                (int) Math.round(signal.confidence * 100));

        Notification n = new NotificationCompat.Builder(this, App.CHANNEL_SIGNALS)
                .setSmallIcon(R.drawable.ic_signal)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setColor(getColor(buy ? R.color.up : R.color.down))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(openApp())
                .build();
        nm.notify(SIGNAL_ID + (signalCounter++ % 5), n);
    }

    @Override
    public void onEngineMessage(String message) {
        // surfaced in the activity; the ongoing notification keeps the last good state
    }

    private int directionLabel(int direction) {
        if (direction == Direction.BUY) return R.string.signal_buy;
        if (direction == Direction.SELL) return R.string.signal_sell;
        return R.string.signal_neutral;
    }

    private Notification ongoing(String text) {
        return new NotificationCompat.Builder(this, App.CHANNEL_STATUS)
                .setSmallIcon(R.drawable.ic_signal)
                .setContentTitle(getString(R.string.notif_ongoing_title))
                .setContentText(text)
                .setOngoing(true)
                .setSilent(true)
                .setContentIntent(openApp())
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private PendingIntent openApp() {
        Intent i = new Intent(this, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (android.os.Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(this, 0, i, flags);
    }

    @SuppressWarnings("deprecation")
    private void stopForegroundCompat() {
        stopForeground(true);
    }
}
