export class AppError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class InsufficientCreditsError extends AppError {
  constructor() {
    super(409, "insufficient credits");
  }
}
