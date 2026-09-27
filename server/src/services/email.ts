import { config } from '../config';
import { logger } from '../lib/logger';

/**
 * Outgoing email through Brevo's HTTP API (free: 300 emails a day). Needs BREVO_API_KEY and
 * EMAIL_FROM (a sender address verified in Brevo). Plain HTTPS, so it works on hosts that
 * block SMTP ports.
 */
export const emailEnabled = () => !!(config.email.brevoApiKey && config.email.from);

export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  if (!emailEnabled()) return false;
  try {
    const res = await fetch(config.email.apiUrl, {
      method: 'POST',
      headers: { 'api-key': config.email.brevoApiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: config.email.from, name: config.email.fromName },
        to: [{ email: to }],
        subject,
        textContent: text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn(`Email to ${to} failed (${res.status}): ${(await res.text().catch(() => '')).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    logger.warn(`Email to ${to} failed:`, err);
    return false;
  }
}
