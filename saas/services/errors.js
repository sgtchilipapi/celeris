export class AppError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class InsufficientCreditsError extends AppError {
  constructor() {
    super(409, "insufficient credits");
  }
}
