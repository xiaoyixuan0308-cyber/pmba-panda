/**
 * A rule was broken or an operation is not allowed. `message` is shown to the
 * user as-is, in business language (NFUS5 AC3); `rule` links back to the spec.
 */
export class DomainError extends Error {
  constructor(
    public code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "INVALID_STATE"
      | "GUARD_FAILED"
      | "VALIDATION"
      | "REGISTRY_UNAVAILABLE"
      | "ACCOUNT_LOCKED"
      | "BAD_CREDENTIALS",
    message: string,
    public rule?: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
