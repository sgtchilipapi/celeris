import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../db/memory-store.js";
import {
  LocalGoogleIdentityTokenVerifier,
  LocalZkLoginProver,
  ZkLoginAuthService,
  createGoogleTestIdToken
} from "../services/zklogin-auth-service.js";

function createAuthService() {
  const store = new MemoryStore();
  return new ZkLoginAuthService({
    store,
    config: {
      authProvider: "zklogin",
      googleClientId: "google-client-dev",
      googleIssuer: "https://accounts.google.com",
      googleVerifierSecret: "google-dev-secret",
      zkLoginSaltSeed: "zklogin-salt-dev-seed",
      zkLoginMaxEpoch: 30,
      zkLoginProverOrigin: "http://localhost:3001"
    },
    googleIdentityTokenVerifier: new LocalGoogleIdentityTokenVerifier({
      secret: "google-dev-secret",
      issuer: "https://accounts.google.com"
    }),
    prover: new LocalZkLoginProver({
      proverOrigin: "http://localhost:3001"
    })
  });
}

test("ZkLoginAuthService resolves a verified Google login into a stable Sui wallet principal", async () => {
  const authService = createAuthService();
  const nonce = authService.resolveLoginNonce({
    loginRequestId: "login-123",
    ephemeralPublicKey: "ephemeral-public-key-material-1234567890",
    maxEpoch: 30
  });

  const identity = await authService.resolveVerifiedIdentity({
    googleIdToken: createGoogleTestIdToken({
      subject: "google-test-user",
      email: "player@example.com",
      nonce,
      audience: "google-client-dev"
    }, {
      secret: "google-dev-secret"
    }),
    allowedChainId: "sui:testnet",
    nonce,
    ephemeralPublicKey: "ephemeral-public-key-material-1234567890",
    maxEpoch: 30
  });

  assert.equal(identity.externalSubject, "https://accounts.google.com:google-test-user");
  assert.equal(identity.email, "player@example.com");
  assert.equal(identity.walletPrincipal.chainId, "sui:testnet");
  assert.match(identity.walletPrincipal.walletAddress, /^0x[a-f0-9]{64}$/);
  assert.equal(identity.zkLogin.nonce, nonce);
  assert.equal(identity.zkLogin.maxEpoch, 30);
  assert.equal(identity.zkLogin.proof.proverOrigin, "http://localhost:3001");
});

test("ZkLoginAuthService rejects missing subject and nonce mismatches", async () => {
  const authService = createAuthService();
  const nonce = authService.resolveLoginNonce({
    loginRequestId: "login-456",
    ephemeralPublicKey: "ephemeral-public-key-material-abcdefghij",
    maxEpoch: 30
  });

  await assert.rejects(
    () =>
      authService.resolveVerifiedIdentity({
        googleIdToken: createGoogleTestIdToken({
          subject: "google-test-user",
          nonce: "wrong-nonce",
          audience: "google-client-dev"
        }, {
          secret: "google-dev-secret"
        }),
        allowedChainId: "sui:testnet",
        nonce,
        ephemeralPublicKey: "ephemeral-public-key-material-abcdefghij",
        maxEpoch: 30
      }),
    /hosted login nonce mismatch/
  );

  const verifier = new LocalGoogleIdentityTokenVerifier({
    secret: "google-dev-secret",
    issuer: "https://accounts.google.com"
  });
  assert.throws(
    () =>
      verifier.verifyToken(
        createGoogleTestIdToken({
          subject: "",
          nonce,
          audience: "google-client-dev"
        }, {
          secret: "google-dev-secret"
        }),
        {
          expectedNonce: nonce,
          expectedAudience: "google-client-dev"
        }
      ),
    /Google identity token missing subject/
  );
});

test("the same external subject resolves the same persisted user salt and derived Sui address", async () => {
  const authService = createAuthService();
  const nonce = authService.resolveLoginNonce({
    loginRequestId: "login-789",
    ephemeralPublicKey: "ephemeral-public-key-material-klmnopqrst",
    maxEpoch: 30
  });

  const first = await authService.resolveVerifiedIdentity({
    googleIdToken: createGoogleTestIdToken({
      subject: "same-user",
      nonce,
      audience: "google-client-dev"
    }, {
      secret: "google-dev-secret"
    }),
    allowedChainId: "sui:testnet",
    nonce,
    ephemeralPublicKey: "ephemeral-public-key-material-klmnopqrst",
    maxEpoch: 30
  });
  const second = await authService.resolveVerifiedIdentity({
    googleIdToken: createGoogleTestIdToken({
      subject: "same-user",
      nonce,
      audience: "google-client-dev"
    }, {
      secret: "google-dev-secret"
    }),
    allowedChainId: "sui:testnet",
    nonce,
    ephemeralPublicKey: "ephemeral-public-key-material-klmnopqrst",
    maxEpoch: 30
  });

  assert.equal(first.zkLogin.userSalt, second.zkLogin.userSalt);
  assert.equal(first.walletPrincipal.walletAddress, second.walletPrincipal.walletAddress);
});
