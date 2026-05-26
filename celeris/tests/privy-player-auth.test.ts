import test from "node:test";
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
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
      googleAuthorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      googleJwksUri: "https://www.googleapis.com/oauth2/v3/certs",
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

function createEphemeralPublicKey() {
  return Ed25519Keypair.generate().getPublicKey().toBase64();
}

test("ZkLoginAuthService resolves a verified Google login into a stable Sui wallet principal", async () => {
  const authService = createAuthService();
  const ephemeralPublicKey = createEphemeralPublicKey();
  const jwtRandomness = "123456789";
  const nonce = authService.resolveLoginNonce({
    ephemeralPublicKey,
    maxEpoch: 30,
    jwtRandomness
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
    ephemeralPublicKey,
    maxEpoch: 30,
    jwtRandomness
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
  const ephemeralPublicKey = createEphemeralPublicKey();
  const jwtRandomness = "987654321";
  const nonce = authService.resolveLoginNonce({
    ephemeralPublicKey,
    maxEpoch: 30,
    jwtRandomness
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
        ephemeralPublicKey,
        maxEpoch: 30,
        jwtRandomness
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
          expectedAudience: "google-client-dev",
          expectedIssuer: "https://accounts.google.com"
        }
      ),
    /Google identity token missing subject/
  );
});

test("the same external subject resolves the same persisted user salt and derived Sui address", async () => {
  const authService = createAuthService();
  const ephemeralPublicKey = createEphemeralPublicKey();
  const jwtRandomness = "123123123";
  const nonce = authService.resolveLoginNonce({
    ephemeralPublicKey,
    maxEpoch: 30,
    jwtRandomness
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
    ephemeralPublicKey,
    maxEpoch: 30,
    jwtRandomness
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
    ephemeralPublicKey,
    maxEpoch: 30,
    jwtRandomness
  });

  assert.equal(first.zkLogin.userSalt, second.zkLogin.userSalt);
  assert.equal(first.walletPrincipal.walletAddress, second.walletPrincipal.walletAddress);
});
