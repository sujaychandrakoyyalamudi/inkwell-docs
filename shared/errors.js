/** An error that maps directly to an HTTP status code and JSON body. */
export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
