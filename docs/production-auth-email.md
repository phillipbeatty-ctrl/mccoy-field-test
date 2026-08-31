# McCoy production authentication email

McCoy fails closed when a verified production email provider is not active. New account creation and confirmation resends are disabled rather than creating more accounts that cannot receive confirmation.

## Permanent architecture

```text
McCoy signup or Admin resend
  -> Supabase Auth confirmation request
  -> Resend SMTP through a verified McCoy-controlled domain
  -> McCoy confirmation page (token is consumed only after the user presses Confirm)
  -> signed Resend webhook events
  -> auth_email_delivery_events audit trail
  -> Pending Account Access delivery status
```

## Required one-time provider setup

1. Create or use a Resend account.
2. Add the exact domain used after `@` in the From address.
3. Publish every Resend-provided SPF and DKIM DNS record and wait until Resend reports `verified`.
4. Publish a DMARC TXT record at `_dmarc.<sending-domain>` or the parent organizational domain.
5. Add these GitHub **production environment secrets**:

| Secret | Purpose |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Patches hosted Supabase Auth configuration and installs the Edge webhook secret. |
| `SUPABASE_SERVICE_ROLE_KEY` | Audits activation and resends fresh confirmations to existing unconfirmed McCoy users. |
| `RESEND_API_KEY` | SMTP password and Resend webhook/domain API credential. |
| `MCCOY_AUTH_FROM_EMAIL` | Verified From address, for example `no-reply@auth.example.com`. |

Never commit these values to the repository.

## Activation

Run the GitHub Actions workflow **Activate production Auth email**, enter `ACTIVATE`, and use `McCoy Platform` as the sender name.

The workflow refuses activation unless:

- the exact sending domain exists in Resend;
- Resend reports the domain verified (SPF/DKIM);
- a DMARC record exists;
- all four production secrets are present;
- the signed webhook is created;
- Supabase confirms the production Site URL, redirect allow-list, and Resend SMTP host;
- every current unconfirmed McCoy account accepts a fresh confirmation request.

## Production URLs

```text
Site URL: https://mccoy-field-test.vercel.app
Confirmation page: https://mccoy-field-test.vercel.app/confirm-email.html
Webhook: https://athxxrfqxwlfnuvbqadp.supabase.co/functions/v1/auth-email-provider-webhook
Admin delivery view: https://mccoy-field-test.vercel.app/pending-access.html
```

## Delivery states

The Admin page distinguishes Auth acceptance from provider delivery:

```text
Confirmation requested
Sent
Delivered
Delivery delayed
Bounced
Suppressed
Failed
Spam complaint
Opened
Clicked
Confirmed
```

A Supabase `mail.send` event alone is not treated as proof of inbox delivery.

## Failure behavior

- Signup is blocked while production SMTP is inactive.
- Public and Admin resends are blocked while SMTP is inactive.
- Resends are limited to one per minute and five per hour per email.
- Public resend responses do not reveal whether an account exists.
- Confirmation tokens are not consumed by automated email scanners opening the McCoy page; a user must press the confirmation button.
- Provider webhook signatures are verified before delivery events are stored.
