export class UnconfirmedTerminationError extends AggregateError {
  constructor(
    errors: unknown[],
    message = "Worker termination remains unconfirmed",
  ) {
    super(errors, message);
  }
}
