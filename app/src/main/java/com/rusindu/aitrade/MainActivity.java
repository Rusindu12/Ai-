package com.rusindu.aitrade;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.MenuItem;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;
import androidx.fragment.app.FragmentTransaction;

import com.google.android.material.appbar.MaterialToolbar;
import com.google.android.material.bottomnavigation.BottomNavigationView;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.snackbar.Snackbar;
import com.rusindu.aitrade.core.TradeEngine;
import com.rusindu.aitrade.service.SignalService;
import com.rusindu.aitrade.store.Prefs;
import com.rusindu.aitrade.ui.MarketFragment;
import com.rusindu.aitrade.ui.ModelFragment;
import com.rusindu.aitrade.ui.SignalsFragment;
import com.rusindu.aitrade.ui.TradeFragment;

/** Hosts the four tabs and the toolbar actions. */
public class MainActivity extends AppCompatActivity {

    private static final int TAB_MARKET = 0;
    private static final int TAB_SIGNALS = 1;
    private static final int TAB_TRADE = 2;
    private static final int TAB_MODEL = 3;
    private static final int PERMISSION_NOTIFICATIONS = 100;

    private final Fragment[] tabs = new Fragment[4];
    private MaterialToolbar toolbar;

    @Override
    protected void attachBaseContext(Context newBase) {
        super.attachBaseContext(LocaleHelper.wrap(newBase));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        toolbar = findViewById(R.id.toolbar);
        setupToolbar();

        BottomNavigationView nav = findViewById(R.id.bottomNav);
        nav.setOnItemSelectedListener(item -> {
            int id = item.getItemId();
            if (id == R.id.nav_market) {
                select(TAB_MARKET);
                return true;
            }
            if (id == R.id.nav_signals) {
                select(TAB_SIGNALS);
                return true;
            }
            if (id == R.id.nav_trade) {
                select(TAB_TRADE);
                return true;
            }
            if (id == R.id.nav_model) {
                select(TAB_MODEL);
                return true;
            }
            return false;
        });

        select(TAB_MARKET);
        TradeEngine.get().start(this);
        maybeAskNotificationPermission();
    }

    @Override
    protected void onResume() {
        super.onResume();
        syncWatchToggle();
    }

    /** Called when the scanner picks a pair: jump back to the market tab. */
    public void showMarket() {
        BottomNavigationView nav = findViewById(R.id.bottomNav);
        nav.setSelectedItemId(R.id.nav_market);
    }

    // ------------------------------------------------------------------ tabs

    private void select(int index) {
        FragmentTransaction tx = getSupportFragmentManager().beginTransaction();
        for (int i = 0; i < tabs.length; i++) {
            if (i == index) {
                if (tabs[i] == null) {
                    tabs[i] = create(i);
                    tx.add(R.id.container, tabs[i], "tab" + i);
                } else {
                    tx.show(tabs[i]);
                }
            } else if (tabs[i] != null) {
                tx.hide(tabs[i]);
            }
        }
        tx.commitNowAllowingStateLoss();
    }

    private Fragment create(int index) {
        switch (index) {
            case TAB_SIGNALS:
                return new SignalsFragment();
            case TAB_TRADE:
                return new TradeFragment();
            case TAB_MODEL:
                return new ModelFragment();
            case TAB_MARKET:
            default:
                return new MarketFragment();
        }
    }

    // ------------------------------------------------------------------ toolbar

    private void setupToolbar() {
        toolbar.inflateMenu(R.menu.menu_main);
        toolbar.setOnMenuItemClickListener(item -> {
            int id = item.getItemId();
            if (id == R.id.action_lang) {
                String current = Prefs.lang(this);
                LocaleHelper.set(this, LocaleHelper.SI.equals(current)
                        ? LocaleHelper.EN : LocaleHelper.SI);
                recreate();
                return true;
            }
            if (id == R.id.action_theme) {
                cycleTheme();
                return true;
            }
            if (id == R.id.action_watch) {
                boolean on = !Prefs.watchEnabled(this);
                Prefs.putBool(this, Prefs.K_WATCH, on);
                if (on) SignalService.start(this);
                else SignalService.stop(this);
                syncWatchToggle();
                return true;
            }
            if (id == R.id.action_settings) {
                startActivity(new Intent(this, SettingsActivity.class));
                return true;
            }
            return false;
        });
    }

    private void syncWatchToggle() {
        if (toolbar == null) return;
        MenuItem item = toolbar.getMenu().findItem(R.id.action_watch);
        if (item != null) item.setChecked(Prefs.watchEnabled(this));
    }

    private void cycleTheme() {
        String current = Prefs.theme(this);
        String next = "system".equals(current) ? "light" : ("light".equals(current) ? "dark" : "system");
        Prefs.putString(this, Prefs.K_THEME, next);
        App.applyTheme(this);
        recreate();
    }

    // ------------------------------------------------------------------ permissions

    private void maybeAskNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        ActivityCompat.requestPermissions(this,
                new String[]{Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_NOTIFICATIONS);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_NOTIFICATIONS
                && (grantResults.length == 0 || grantResults[0] != PackageManager.PERMISSION_GRANTED)) {
            Snackbar.make(findViewById(R.id.container), R.string.permission_needed,
                    Snackbar.LENGTH_LONG).show();
        }
    }
}
