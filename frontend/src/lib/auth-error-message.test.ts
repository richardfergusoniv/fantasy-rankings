import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./auth-error-message";

describe("authErrorMessage", () => {
  it("maps email send rate limit by message (screenshot case)", () => {
    expect(authErrorMessage(new Error("email rate limit exceeded"))).toMatch(/about an hour/i);
  });

  it("maps email send rate limit by code", () => {
    expect(
      authErrorMessage({ message: "email rate limit exceeded", code: "over_email_send_rate_limit", status: 429 }),
    ).toMatch(/confirmation emails/i);
  });

  it("maps request rate limits separately", () => {
    expect(
      authErrorMessage({ message: "Request rate limit reached", code: "over_request_rate_limit", status: 429 }),
    ).toMatch(/wait a minute/i);
  });

  it("maps unauthorized recipient addresses", () => {
    expect(
      authErrorMessage({
        message: "email address not authorized",
        code: "email_address_not_authorized",
      }),
    ).toMatch(/cannot send email/i);
  });

  it("maps already-registered users", () => {
    expect(authErrorMessage(new Error("User already registered"))).toMatch(/already exists/i);
  });

  it("maps invalid credentials", () => {
    expect(
      authErrorMessage({ message: "Invalid login credentials", code: "invalid_credentials" }),
    ).toBe("Incorrect email or password.");
  });

  it("falls back for unknown snake_case provider codes", () => {
    expect(authErrorMessage(new Error("some_obscure_auth_failure"))).toBe("Something went wrong. Try again.");
  });

  it("keeps ordinary Error messages that are already readable", () => {
    expect(authErrorMessage(new Error("You are signed out. Sign in again."))).toBe(
      "You are signed out. Sign in again.",
    );
  });
});
