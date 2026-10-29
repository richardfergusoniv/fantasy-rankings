/**
 * Map Supabase Auth (and similar) errors to short, user-facing copy.
 * Prefer known codes/messages over raw provider strings so rate limits and
 * SMTP restrictions do not leak cryptic API text into the UI.
 */

type AuthLikeError = {
  message?: string;
  code?: string;
  status?: number;
};

const EMAIL_RATE_LIMIT_MESSAGE =
  "Too many confirmation emails were sent from this app recently. Wait about an hour, then try again. If it still fails, ask the app owner to check email settings.";

const REQUEST_RATE_LIMIT_MESSAGE =
  "Too many attempts from this network. Wait a minute, then try again.";

const EMAIL_NOT_AUTHORIZED_MESSAGE =
  "This app cannot send email to that address yet. Ask the app owner to finish email setup, or try again later.";

function readAuthLike(err: unknown): AuthLikeError {
  if (!err || typeof err !== "object") return {};
  const record = err as Record<string, unknown>;
  return {
    message: typeof record.message === "string" ? record.message : undefined,
    code: typeof record.code === "string" ? record.code : undefined,
    status: typeof record.status === "number" ? record.status : undefined,
  };
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

/** Known provider codes and message fragments → friendly copy. */
export function authErrorMessage(err: unknown, fallback = "Something went wrong. Try again."): string {
  const { message, code, status } = readAuthLike(err);
  const normalizedCode = code ? normalize(code) : "";
  const normalizedMessage = message ? normalize(message) : "";

  if (
    normalizedCode === "over_email_send_rate_limit" ||
    normalizedMessage.includes("email rate limit exceeded") ||
    normalizedMessage.includes("over_email_send_rate_limit")
  ) {
    return EMAIL_RATE_LIMIT_MESSAGE;
  }

  if (
    normalizedCode === "over_request_rate_limit" ||
    normalizedMessage.includes("request rate limit") ||
    (status === 429 && normalizedMessage.includes("rate limit"))
  ) {
    return REQUEST_RATE_LIMIT_MESSAGE;
  }

  if (
    normalizedCode === "email_address_not_authorized" ||
    normalizedMessage.includes("email_address_not_authorized") ||
    normalizedMessage.includes("email address not authorized")
  ) {
    return EMAIL_NOT_AUTHORIZED_MESSAGE;
  }

  if (
    normalizedCode === "user_already_exists" ||
    normalizedMessage.includes("user already registered") ||
    normalizedMessage.includes("already been registered")
  ) {
    return "An account with that email already exists. Sign in instead.";
  }

  if (
    normalizedCode === "invalid_credentials" ||
    normalizedMessage.includes("invalid login credentials")
  ) {
    return "Incorrect email or password.";
  }

  if (normalizedCode === "email_not_confirmed" || normalizedMessage.includes("email not confirmed")) {
    return "Confirm your email before signing in. Check your inbox for the link.";
  }

  if (normalizedCode === "weak_password" || normalizedMessage.includes("password should be")) {
    return message && message.length < 160 ? message : "Choose a stronger password.";
  }

  if (err instanceof Error && err.message && !looksLikeRawProviderNoise(err.message)) {
    return err.message;
  }

  return fallback;
}

function looksLikeRawProviderNoise(message: string): boolean {
  const normalized = normalize(message);
  if (!normalized) return true;
  if (normalized.includes("_") && !normalized.includes(" ")) return true;
  if (/^[a-z]+(?:_[a-z0-9]+)+$/.test(normalized)) return true;
  return false;
}
