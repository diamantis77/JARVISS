# JARVIS Phone

JARVIS Phone is an owner-only outbound voice channel. It supports Twilio Programmable Voice and Vonage Voice API behind one provider-neutral boundary. Both transports bridge to the same server-side OpenAI Live session, JARVIS run loop, tool registry, persistence, and approval gate. It does not create a second assistant or bypass approvals.

## Safety and reliability

- Calls can target only `JARVIS_OWNER_PHONE_NUMBER`; API callers cannot submit a destination number.
- Phone notifications are opt-in and default off. Local calling hours default to 09:00–23:00, with outside-hours calls disabled.
- Outbound dialing is a durable `outbound_jarvis_call` job with one provider attempt. This deliberately avoids duplicate real calls after an ambiguous provider timeout.
- Twilio HTTP and WebSocket entry points require Twilio signatures. The media stream additionally requires a short-lived, call-bound HMAC token.
- Vonage Answer/Event webhooks require Vonage signed-callback JWTs. The media WebSocket requires a separate short-lived RS256 token bound to the `vonage` provider, audience, database call ID, provider call ID, expiry, and unique token ID.
- Audio is bridged as raw PCMU/8 kHz and is not persisted. Only normal JARVIS run state and safe call metadata are stored.
- Spoken confirmation never satisfies an application approval. JARVIS directs the owner to the UI.
- Barge-in clears the selected provider's buffered playback and cancels the active OpenAI response while inbound media continues to OpenAI Live.

## Provider selection

`TELEPHONY_PROVIDER` accepts `twilio` or `vonage` and defaults safely to Twilio when unset. The durable `outbound_jarvis_call` job records its provider in `phone_calls`, so retries and workers use the provider selected when the job was created.

Vonage uses Voice API application JWT authentication for outbound calls, `audio/l16;rate=16000` for the provider WebSocket, and explicit PCM16 little-endian resampling to/from the OpenAI Live 24 kHz PCM bridge. Apply migration `0012_vonage_phone_provider.sql` before creating Vonage call records.

Required Vonage configuration is documented in `.env.example`. `VONAGE_PRIVATE_KEY` may be an inline PEM (with escaped newlines) or a path resolved from the project directory. Never commit the private key, API secret, signature secret, or real phone numbers.

For a Vonage trial/demo development call to the account sign-up phone only, set `VONAGE_DEVELOPMENT_TEST_MODE=true` and `VONAGE_PHONE_NUMBER=123456789` in `.env.local`, then run the full development stack with `npm run dev:jarvis`. This documented test caller ID is rejected outside development/test runtime, when another provider is selected, or when the destination differs from `JARVIS_OWNER_PHONE_NUMBER`. The worker revalidates authorization immediately before dialing. Production requires a real Voice-capable number authorized by the Vonage account. `RUN_LIVE_VONAGE_TESTS` is a separate test-suite switch and must remain off unless an actual call is explicitly approved.

## Required configuration

Apply `supabase/migrations/0010_jarvis_phone.sql`, then configure these values only in `.env.local`:

```dotenv
TELEPHONY_PROVIDER=twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
JARVIS_OWNER_PHONE_NUMBER=
PUBLIC_TELEPHONY_BASE_URL=https://your-public-host.example
RUN_LIVE_TWILIO_TESTS=false
```

`PUBLIC_TELEPHONY_BASE_URL` must be a public HTTPS origin that forwards HTTP and WebSocket upgrades to the JARVIS server. `npm run dev:jarvis` starts the application, worker, scheduler, and the media gateway on the same port.

The normal test suite mocks providers. A real provider test is skipped unless `RUN_LIVE_TWILIO_TESTS=true`; enabling it causes an actual call and must be intentional.
