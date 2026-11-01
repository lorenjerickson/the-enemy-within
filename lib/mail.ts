import nodemailer from "nodemailer";

// Set SMTP_URL (e.g. smtps://user:pass@smtp.gmail.com) and MAIL_FROM in .env.local.
// APP_URL sets the server link in emails (defaults to the host the GM is using).
// Without SMTP_URL, emails are printed to the server console instead.
export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (!process.env.SMTP_URL) {
    console.log(`\n--- EMAIL (SMTP_URL not set) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---\n`);
    return;
  }
  await nodemailer.createTransport(process.env.SMTP_URL).sendMail({
    from: process.env.MAIL_FROM ?? "The Enemy Within <no-reply@localhost>",
    to,
    subject,
    text,
  });
}
