export class AppError extends Error {
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(statusCode: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class InsufficientCreditsError extends AppError {
  constructor() {
    super(409, "insufficient credits");
  }
}
