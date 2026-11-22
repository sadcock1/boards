/**
 * Outgoing email over SMTP. Optional: without it, Boards works the same minus the
 * email features (verification, forgot password, "password changed" notices).
 *
 * Configured entirely by environment variables, never committed:
 *   SMTP_HOST, SMTP_PORT (465 = implicit TLS, 587 = STARTTLS), SMTP_USER, SMTP_PASS, MAIL_FROM
 *   MAIL_LOG=1 turns the email features on without SMTP and prints each email to the
 *   server log instead (used by `npm run server` for local development).
 */
import nodemailer from 'nodemailer';

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT ?? 465);
const from = process.env.MAIL_FROM ?? `Boards <${process.env.SMTP_USER ?? 'no-reply@localhost'}>`;

const transport = host
  ? nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

/** Whether the email features are switched on (real SMTP, or printing to the log). */
export const mailEnabled = !!transport || process.env.MAIL_LOG === '1';

export interface Mail {
  to: string;
  subject: string;
  /** Plain-text body */
  text: string;
  /** Optional call to action rendered as a button in the HTML version */
  action?: { label: string; url: string };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function html({ text, action }: Mail) {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const button = action
    ? `<p style="margin:8px 0 24px"><a href="${esc(action.url)}" style="display:inline-block;background:#2383e2;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:6px">${esc(action.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f7f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#37352f;font-size:15px;line-height:1.55">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<div style="width:36px;height:36px;border-radius:9px;background:#37352f;color:#fff;font-weight:700;font-size:18px;line-height:36px;text-align:center;margin-bottom:20px">B</div>
${paras}${button}
<p style="margin:24px 0 0;font-size:12px;color:#9b9a97">Sent by Boards</p>
</div></body></html>`;
}

/** Send an email. Never throws: failures are logged so a mail outage can't break a request. */
export async function sendMail(mail: Mail): Promise<boolean> {
  const text = mail.action ? `${mail.text}\n\n${mail.action.label}: ${mail.action.url}` : mail.text;
  if (!mailEnabled) return false;
  if (!transport) {
    console.log(`\n[mail] (MAIL_LOG: printed, not sent)\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${text}\n`);
    return true;
  }
  try {
    await transport.sendMail({ from, to: mail.to, subject: mail.subject, text, html: html(mail) });
    return true;
  } catch (e) {
    console.error('[mail] send failed:', (e as Error).message);
    return false;
  }
}
