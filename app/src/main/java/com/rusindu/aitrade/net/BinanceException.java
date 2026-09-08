package com.rusindu.aitrade.net;

/** Error returned by the Binance REST API. */
public class BinanceException extends Exception {
    public final int code;

    public BinanceException(int code, String message) {
        super(message);
        this.code = code;
    }

    public BinanceException(String message) {
        this(0, message);
    }
}
