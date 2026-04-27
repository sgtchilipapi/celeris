export class AuthService {
  constructor({ store }) {
    this.store = store;
  }

  createSession({ externalSubject, idempotencyKey }) {
    const cached = this.store.getIdempotent(`session:${externalSubject}`, idempotencyKey);
    if (cached) {
      return cached;
    }
    const user = this.store.findUserByExternalSubject(externalSubject) ?? this.store.createUser({ externalSubject });
    const session = {
      userId: user.userId,
      sessionToken: `session_${user.userId}`,
      createdAt: new Date().toISOString()
    };
    this.store.setIdempotent(`session:${externalSubject}`, idempotencyKey, session);
    return session;
  }
}
