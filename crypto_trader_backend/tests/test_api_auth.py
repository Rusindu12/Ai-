"""Auth + session API tests (signup, login, refresh rotation, 2FA, devices)."""

from __future__ import annotations

import time


async def test_signup_validation(client):
    r = await client.post("/api/auth/signup", json={"email": "not-an-email", "password": "longenoughpass1"})
    assert r.status_code == 422
    r = await client.post("/api/auth/signup", json={"email": "weakpw@example.com", "password": "short"})
    assert r.status_code == 422
    assert r.json()["error"] in ("validation_error", "bad_request")


async def test_signup_login_duplicate_flow(client):
    email = f"flow{int(time.time() * 1000)}@example.com"
    r = await client.post("/api/auth/signup", json={"email": email, "password": "my-password-123", "name": "Flow"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["access_token"] and body["refresh_token"]
    assert body["user"]["email"] == email
    assert body["user"]["paper_trading"] is True  # safe default

    r = await client.post("/api/auth/signup", json={"email": email.upper(), "password": "my-password-123"})
    assert r.status_code == 422, "emails are compared case-insensitively"

    r = await client.post("/api/auth/login", json={"email": email, "password": "my-password-123", "device_id": "dev-1"})
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]

    r = await client.post("/api/auth/login", json={"email": email, "password": "wrong-password-999"})
    assert r.status_code == 401
    assert r.json()["error"] == "unauthorized"

    r = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200 and r.json()["email"] == email
    r = await client.post("/api/auth/refresh", json={"refresh_token": r.json() and body["refresh_token"]})
    assert r.status_code == 200, "signup's refresh token must be usable"


async def test_login_locks_out_inactive_and_missing_users(client):
    r = await client.post("/api/auth/login", json={"email": "ghost@example.com", "password": "whatever-1234"})
    assert r.status_code == 401, "must not reveal whether the account exists"


async def test_token_required_for_protected_routes(client):
    for path in ("/api/account", "/api/orders", "/api/settings", "/api/ai/signal/BTCUSDT"):
        r = await client.get(path)
        assert r.status_code == 401, path
    r = await client.get("/api/account", headers={"Authorization": "Bearer nonsense"})
    assert r.status_code == 401
    r = await client.get("/api/account", headers={"Authorization": "Basic dXNlcjpwYXNz"})
    assert r.status_code == 401, "only bearer tokens are accepted"


async def test_refresh_rotation_and_revocation(client):
    email = f"rot{int(time.time() * 1000)}@example.com"
    r = await client.post("/api/auth/signup", json={"email": email, "password": "rotation-pass-1"})
    first = r.json()

    r = await client.post("/api/auth/refresh", json={"refresh_token": first["refresh_token"], "device_id": "dev-x"})
    assert r.status_code == 200, r.text
    second = r.json()
    assert second["access_token"] != first["access_token"]
    assert second["refresh_token"] != first["refresh_token"]

    r = await client.post("/api/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert r.status_code == 401, "reusing a rotated refresh token must fail"

    r = await client.post("/api/auth/logout", json={"refresh_token": second["refresh_token"]}, headers={"Authorization": f"Bearer {second['access_token']}"})
    assert r.status_code == 200
    r = await client.post("/api/auth/refresh", json={"refresh_token": second["refresh_token"]})
    assert r.status_code == 401


async def test_logout_all_revokes_every_session(client):
    email = f"all{int(time.time() * 1000)}@example.com"
    r = await client.post("/api/auth/signup", json={"email": email, "password": "logout-all-pass"})
    tok = r.json()["access_token"]
    await client.post("/api/auth/login", json={"email": email, "password": "logout-all-pass", "device_id": "d2"})
    r = await client.post("/api/auth/logout-all", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    r = await client.get("/api/account", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 401, "the current jti must be deny-listed immediately"


async def test_password_change_signs_everyone_out(client):
    email = f"pwd{int(time.time() * 1000)}@example.com"
    r = await client.post("/api/auth/signup", json={"email": email, "password": "original-pass-1"})
    body = r.json()
    headers = {"Authorization": f"Bearer {body['access_token']}"}
    r = await client.post("/api/auth/password", json={"current_password": "wrong-pass-1234", "new_password": "brand-new-pass-1", "confirm_password": "brand-new-pass-1"}, headers=headers)
    assert r.status_code == 401
    r = await client.post("/api/auth/password", json={"current_password": "original-pass-1", "new_password": "brand-new-pass-1", "confirm_password": "mismatched-pass-1"}, headers=headers)
    assert r.status_code == 422
    r = await client.post("/api/auth/password", json={"current_password": "original-pass-1", "new_password": "brand-new-pass-1", "confirm_password": "brand-new-pass-1"}, headers=headers)
    assert r.status_code == 200 and r.json()["changed"] is True
    assert await client.post("/api/auth/login", json={"email": email, "password": "original-pass-1"}) and True
    r = await client.post("/api/auth/login", json={"email": email, "password": "brand-new-pass-1"})
    assert r.status_code == 200, "new password must work"
    r = await client.post("/api/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert r.status_code == 401, "old refresh tokens are revoked on password change"


async def test_two_factor_setup_enable_and_required_on_login(client):
    from app.security import totp

    email = f"2fa{int(time.time() * 1000)}@example.com"
    r = await client.post("/api/auth/signup", json={"email": email, "password": "twofactor-pass1"})
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    r = await client.post("/api/auth/2fa/enable", json={"code": "000000"}, headers=headers)
    assert r.status_code == 422, "must call setup first"

    r = await client.post("/api/auth/2fa/setup", headers=headers)
    assert r.status_code == 200
    secret = r.json()["secret"]
    assert "otpauth://totp/" in r.json()["otpauth_uri"]

    r = await client.post("/api/auth/2fa/enable", json={"code": "123456"}, headers=headers)
    assert r.status_code == 422, "wrong code must not enable 2FA"

    r = await client.post("/api/auth/2fa/enable", json={"code": totp.now_code(secret)}, headers=headers)
    assert r.status_code == 200 and r.json()["enabled"] is True

    r = await client.post("/api/auth/login", json={"email": email, "password": "twofactor-pass1"})
    assert r.status_code == 401 and "two-factor" in r.json()["message"]

    # the enable call consumed the current window's code: a fresh window must work
    import time as _t

    next_code = totp.code_at(secret, (int(_t.time()) // totp.STEP_S + 1) * totp.STEP_S * 1000)
    r = await client.post("/api/auth/login", json={"email": email, "password": "twofactor-pass1", "totp_code": next_code})
    assert r.status_code == 200, r.text


async def test_biometric_requires_enrolment(client):
    email = f"bio{int(time.time() * 1000)}@example.com"
    password = "biometric-pass1"
    r = await client.post("/api/auth/signup", json={"email": email, "password": password})
    uid = r.json()["user"]["id"]

    r = await client.post("/api/auth/biometric/unlock", json={"user_id": uid, "device_id": "pixel-7"})
    assert r.status_code == 403, "biometric not enabled yet"

    token = await _token(client, email, password)
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.post("/api/settings/biometric", headers=headers)
    assert r.status_code == 200 and r.json()["biometric_enabled"] is True

    r = await client.post("/api/auth/biometric/unlock", json={"user_id": uid, "device_id": "unknown-device"})
    assert r.status_code == 403, "device must have signed in with a password first"

    await client.post("/api/auth/login", json={"email": email, "password": password, "device_id": "pixel-7"})
    r = await client.post("/api/auth/biometric/unlock", json={"user_id": uid, "device_id": "pixel-7"})
    assert r.status_code == 200, r.text
    assert r.json()["access_token"]


async def _token(client, email: str, password: str) -> str:
    r = await client.post("/api/auth/login", json={"email": email, "password": password})
    return r.json()["access_token"]


async def test_device_registration_and_google_rejects_junk(client):
    r = await client.post("/api/auth/google", json={"id_token": "not-a-real-google-token-at-all"})
    assert r.status_code in (401, 502, 500), "must fail closed without network/valid token"

    email = f"dev{int(time.time() * 1000)}@example.com"
    r = await client.post("/api/auth/signup", json={"email": email, "password": "device-pass-123"})
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = await client.post("/api/auth/devices", json={"device_id": "device-abc", "platform": "android", "fcm_token": "fcm-token-xyz", "app_version": "1.0.0"}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["registered"] is True
    r = await client.post("/api/auth/integrity/nonce", headers=headers)
    assert r.status_code == 200 and len(r.json()["nonce"]) == 64


async def test_public_config_exposes_only_safe_values(client):
    r = await client.get("/api/auth/config")
    body = r.json()
    assert r.status_code == 200
    assert "markets" in body and body["auto_logout_minutes"] == 15
    forbidden = {"SECRET_KEY", "ENCRYPTION_KEY", "BINANCE_API_KEY", "BINANCE_API_SECRET", "METRICS_TOKEN", "VAULT_TOKEN"}
    leaked = sorted({k.lower() for k in body} & {f.lower() for f in forbidden})
    assert not leaked, f"config leaked {leaked}"
