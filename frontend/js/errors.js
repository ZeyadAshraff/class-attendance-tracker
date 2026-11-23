// Same information the backend sends: { error: { code, message, field } } plus the HTTP status.
// field (optional) is the form field the message belongs to.
export class ApiError extends Error {
  constructor(status, code, message, field) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (field) this.field = field;
  }
}
