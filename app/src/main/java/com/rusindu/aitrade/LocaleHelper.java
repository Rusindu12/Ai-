package com.rusindu.aitrade;

import android.content.Context;
import android.content.res.Configuration;
import android.content.res.Resources;

import com.rusindu.aitrade.store.Prefs;

import java.util.Locale;

/**
 * In-app language switch (සිංහල / English).
 * Activities call {@link #wrap(Context)} from {@code attachBaseContext}.
 */
public final class LocaleHelper {

    public static final String SYSTEM = "system";
    public static final String EN = "en";
    public static final String SI = "si";

    private LocaleHelper() {
    }

    public static Context wrap(Context base) {
        String lang = Prefs.lang(base);
        if (lang == null || lang.isEmpty() || SYSTEM.equals(lang)) return base;

        Locale locale = new Locale(lang);
        Locale.setDefault(locale);
        Resources res = base.getResources();
        Configuration config = new Configuration(res.getConfiguration());
        config.setLocale(locale);
        config.setLayoutDirection(locale);
        return base.createConfigurationContext(config);
    }

    public static void set(Context c, String lang) {
        Prefs.putString(c, Prefs.K_LANG, lang);
    }

    public static String label(String lang) {
        if (SI.equals(lang)) return "සිංහල";
        if (EN.equals(lang)) return "English";
        return "System";
    }
}
