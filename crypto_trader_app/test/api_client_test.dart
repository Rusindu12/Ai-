import 'dart:async';
import 'dart:convert';

import 'package:crypto_trader_app/core/errors.dart';
import 'package:crypto_trader_app/services/api_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// The client is the app's only door to the world, so its contract is tested
/// here: auth header, one-shot refresh + replay on 401, backoff on 429, and a
/// friendly [AppException] for the backend error envelope.
void main() {
  Map<String, dynamic>? lastRequest;
  String? lastAuth;

  ApiClient clientWith(
    Future<http.Response> Function(http.Request request) handler, {
    Future<List<String>?> Function()? refresh,
  }) {
    return ApiClient(
      client: MockClient((request) async {
        lastRequest = {
          'method': request.method,
          'path': request.url.path,
          'query': request.url.queryParameters,
          'body': request.body,
          'headers': request.headers,
        };
        lastAuth = request.headers['authorization'];
        return handler(request);
      }),
      baseUrl: 'https://api.test.local/api',
      tokenProvider: () async => 'access-1',
      refreshProvider: refresh,
      deviceIdProvider: () async => 'device-1',
      timeout: const Duration(seconds: 2),
    );
  }

  test('GET sends bearer token, device id and query parameters', () async {
    final client = clientWith((_) async => http.Response('{"ok":true}', 200));
    final json = await client.get('/prices', query: {'symbols': 'BTCUSDT,ETHUSDT'});
    expect(json['ok'], isTrue);
    expect(lastRequest!['path'], '/api/prices');
    expect((lastRequest!['query'] as Map)['symbols'], 'BTCUSDT,ETHUSDT');
    expect(lastAuth, 'Bearer access-1');
    expect((lastRequest!['headers'] as Map)['x-device-id'], 'device-1');
    client.close();
  });

  test('POST encodes a JSON body', () async {
    final client = clientWith((_) async => http.Response('{"id":1}', 201));
    final json = await client.post('/order', body: {'symbol': 'BTCUSDT', 'side': 'BUY', 'quantity': 0.001});
    expect(json['id'], 1);
    expect(jsonDecode(lastRequest!['body'] as String), {'symbol': 'BTCUSDT', 'side': 'BUY', 'quantity': 0.001});
    client.close();
  });

  test('401 triggers one refresh then replays the request', () async {
    var calls = 0;
    var refreshed = 0;
    final client = ApiClient(
      client: MockClient((request) async {
        calls++;
        if (calls == 1) return http.Response('{"error":"token_expired","message":"expired"}', 401);
        expect(request.headers['authorization'], 'Bearer access-2');
        return http.Response('{"price":42}', 200);
      }),
      baseUrl: 'https://api.test.local/api',
      tokenProvider: () async => calls == 1 ? 'access-1' : 'access-2',
      refreshProvider: () async {
        refreshed++;
        return ['access-2', 'refresh-2'];
      },
      deviceIdProvider: () async => 'device-1',
    );
    final json = await client.get('/prices/BTCUSDT');
    expect(json['price'], 42);
    expect(calls, 2);
    expect(refreshed, 1);
    client.close();
  });

  test('expired refresh path signs the user out instead of looping', () async {
    var expired = 0;
    final client = ApiClient(
      client: MockClient((_) async => http.Response('{"error":"token_expired"}', 401)),
      baseUrl: 'https://api.test.local/api',
      tokenProvider: () async => 'access-1',
      refreshProvider: () async => null,
      onSessionExpired: () async => expired++,
      deviceIdProvider: () async => 'device-1',
    );
    await expectLater(client.get('/account'), throwsA(isA<AppException>()));
    expect(expired, 1);
    client.close();
  });

  test('429 becomes a rate-limit error carrying retry_after', () async {
    final client = clientWith((_) async => http.Response(
          jsonEncode({'error': 'rate_limited', 'message': 'weight budget', 'retry_after': 7}),
          429,
          headers: {'retry-after': '7'},
        ));
    try {
      await client.get('/prices');
      fail('should have thrown');
    } on AppException catch (e) {
      expect(e.isRateLimited, isTrue);
      expect(e.retryAfterSeconds, 7);
      expect(e.message, contains('weight budget'));
    }
    client.close();
  });

  test('validation errors surface the field path', () async {
    final client = clientWith((_) async => http.Response(
          jsonEncode({
            'error': 'validation_error',
            'message': 'request body did not match the schema',
            'details': {
              'errors': [
                {'loc': ['body', 'quantity'], 'msg': 'ensure this value is greater than 0', 'type': 'greater_than'},
              ],
            },
          }),
          422,
        ));
    await expectLater(client.post('/order', body: {}), throwsA(predicate((AppException e) => e.message.contains('body.quantity') && e.statusCode == 422)));
    client.close();
  });

  test('network failures are retried then reported as a network error', () async {
    var attempts = 0;
    final client = ApiClient(
      client: MockClient((_) async {
        attempts++;
        throw http.ClientException('socket hang up');
      }),
      baseUrl: 'https://api.test.local/api',
      tokenProvider: () async => 'access-1',
      deviceIdProvider: () async => 'device-1',
    );
    await expectLater(client.get('/prices'), throwsA(isA<AppException>()));
    expect(attempts, ApiClient.maxAttempts);
    client.close();
  });

  test('timeouts become a timeout error', () async {
    final client = ApiClient(
      client: MockClient((_) async {
        await Future<void>.delayed(const Duration(seconds: 5));
        return http.Response('{}', 200);
      }),
      baseUrl: 'https://api.test.local/api',
      tokenProvider: () async => 'access-1',
      deviceIdProvider: () async => 'device-1',
      timeout: const Duration(milliseconds: 120),
    );
    await expectLater(client.get('/prices'), throwsA(isA<AppException>()));
    client.close();
  });

  test('empty 204-ish bodies parse as an empty map', () async {
    final client = clientWith((_) async => http.Response('', 200));
    expect(await client.delete('/watchlist/BTCUSDT'), isEmpty);
    client.close();
  });
}
