import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { KMSClient, type KMSClientConfig } from "@aws-sdk/client-kms";
import {
  AwsKeyManagement,
  KeyManagementError,
  LOCAL_KMS_KEY_ID,
  LocalKeyManagement,
  createKeyManagement,
} from "../src/index.js";

const WORKSPACE_A = "141fa7ac-2951-4767-a0ac-52946105f7d4";
const WORKSPACE_B = "78fab41a-f759-4cdd-8744-d46f424449eb";

describe("LocalKeyManagement (contract, research R5)", () => {
  const kms = new LocalKeyManagement(randomBytes(32));

  it("round-trips a 32-byte data key and stores only the wrapped copy", async () => {
    const generated = await kms.generateDataKey({ workspaceId: WORKSPACE_A });

    expect(generated.kmsKeyId).toBe(LOCAL_KMS_KEY_ID);
    expect(generated.plaintext).toHaveLength(32);
    // version (1) || iv (12) || wrapped key (32) || tag (16)
    expect(generated.wrapped).toHaveLength(61);
    expect(generated.wrapped.includes(generated.plaintext)).toBe(false);

    const unwrapped = await kms.decryptDataKey(generated.wrapped, { workspaceId: WORKSPACE_A });
    expect(unwrapped.equals(generated.plaintext)).toBe(true);
  });

  it("creates a different data key every time", async () => {
    const first = await kms.generateDataKey({ workspaceId: WORKSPACE_A });
    const second = await kms.generateDataKey({ workspaceId: WORKSPACE_A });
    expect(first.plaintext.equals(second.plaintext)).toBe(false);
    expect(first.wrapped.equals(second.wrapped)).toBe(false);
  });

  it("refuses to unwrap a key with another workspace's context", async () => {
    const generated = await kms.generateDataKey({ workspaceId: WORKSPACE_A });
    const attempt = kms.decryptDataKey(generated.wrapped, { workspaceId: WORKSPACE_B });
    await expect(attempt).rejects.toBeInstanceOf(KeyManagementError);
    await expect(attempt).rejects.toThrow("could not unwrap");
  });

  it("refuses a key wrapped under another local key", async () => {
    const other = new LocalKeyManagement(randomBytes(32));
    const generated = await other.generateDataKey({ workspaceId: WORKSPACE_A });
    await expect(
      kms.decryptDataKey(generated.wrapped, { workspaceId: WORKSPACE_A }),
    ).rejects.toBeInstanceOf(KeyManagementError);
  });

  it("refuses tampered or truncated wrapped keys", async () => {
    const generated = await kms.generateDataKey({ workspaceId: WORKSPACE_A });
    const tampered = Buffer.from(generated.wrapped);
    tampered[20] = (tampered[20] ?? 0) ^ 0xff;
    await expect(kms.decryptDataKey(tampered, { workspaceId: WORKSPACE_A })).rejects.toBeInstanceOf(
      KeyManagementError,
    );
    await expect(
      kms.decryptDataKey(generated.wrapped.subarray(0, 40), { workspaceId: WORKSPACE_A }),
    ).rejects.toBeInstanceOf(KeyManagementError);
  });

  it("requires a 32-byte local key and a workspace ID", async () => {
    expect(() => new LocalKeyManagement(randomBytes(16))).toThrow("32 bytes");
    await expect(kms.generateDataKey({ workspaceId: "" })).rejects.toThrow("workspace ID");
  });
});

// --- AWS KMS against recorded responses ------------------------------------------------------

const KEY_ARN = "arn:aws:kms:us-east-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab";
const PLAINTEXT_B64 = "fspl1JELc5VoH4i1UMBfAfonz+dptvR0IHiT5XzcTGY=";
const WRAPPED_B64 =
  "AQICAHiDWUMIEFaASNCGXDKIyajyZSoOI9TI6KiXbp6D0d9l85tdCcCADvZJl4GtFsudLRNBNIfHI8Ea3xNEtmEu+OyDDIXpQvcH8zQ026f7ZbwfBlfVZK4hbJhkgJJNE3ad8FVyUGioEuqs/QR/26cV5kuf69CKtF8iBpqoqhWGw4OXpR8twJyIQJAQpanlVnPrU9QoW6o+M4aSz3K2GU8q6dF1g8wH1PX9bwz/OmajwB+hpR1DJA==";

interface RecordedResponse {
  status: number;
  requestId: string;
  /** `x-amzn-ErrorType` for an error response. */
  errorType?: string;
  body: Record<string, unknown>;
}

/**
 * KMS responses (AWS JSON 1.1 protocol) as recorded, with the account, ARNs, and key material
 * replaced by example values.
 */
const RECORDED = {
  generateDataKey: {
    status: 200,
    requestId: "7c2e8f4a-0d1b-4c3e-9a5f-1b2c3d4e5f60",
    body: {
      CiphertextBlob: WRAPPED_B64,
      KeyId: KEY_ARN,
      KeyMaterialId: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
      Plaintext: PLAINTEXT_B64,
    },
  },
  decrypt: {
    status: 200,
    requestId: "0f9e8d7c-6b5a-4938-8271-605f4e3d2c1b",
    body: {
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      KeyId: KEY_ARN,
      KeyMaterialId: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
      Plaintext: PLAINTEXT_B64,
    },
  },
  /** What KMS returns when the encryption context differs from the one used to wrap. */
  invalidCiphertext: {
    status: 400,
    requestId: "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d",
    errorType: "InvalidCiphertextException:",
    body: { __type: "InvalidCiphertextException" },
  },
  accessDenied: {
    status: 400,
    requestId: "9d8c7b6a-5f4e-4d3c-2b1a-0f9e8d7c6b5a",
    errorType: "AccessDeniedException:",
    body: {
      __type: "AccessDeniedException",
      Message:
        "User: arn:aws:sts::111122223333:assumed-role/api-task/abc is not authorized to perform: kms:Decrypt",
    },
  },
} satisfies Record<string, RecordedResponse>;

interface SeenRequest {
  target: string | undefined;
  body: Record<string, unknown>;
}

/** A real KMS client whose HTTP layer replays recorded responses, so serialization is tested. */
function replayingClient(...responses: RecordedResponse[]): {
  client: KMSClient;
  requests: SeenRequest[];
} {
  const requests: SeenRequest[] = [];
  const requestHandler = {
    handle: async (request: { headers: Record<string, string>; body?: Uint8Array | string }) => {
      const recorded = responses.shift();
      if (!recorded) throw new Error("No recorded KMS response left");
      const raw =
        typeof request.body === "string" ? request.body : new TextDecoder().decode(request.body);
      requests.push({ target: request.headers["x-amz-target"], body: JSON.parse(raw) });
      return {
        response: {
          statusCode: recorded.status,
          headers: {
            "content-type": "application/x-amz-json-1.1",
            "x-amzn-requestid": recorded.requestId,
            ...(recorded.errorType ? { "x-amzn-errortype": recorded.errorType } : {}),
          },
          body: new TextEncoder().encode(JSON.stringify(recorded.body)),
        },
      };
    },
  };
  const client = new KMSClient({
    region: "us-east-1",
    credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "not-a-real-secret" },
    maxAttempts: 1,
    requestHandler: requestHandler as unknown as KMSClientConfig["requestHandler"],
  });
  return { client, requests };
}

describe("AwsKeyManagement (contract, recorded responses)", () => {
  it("generates an AES-256 data key with the workspace encryption context", async () => {
    const { client, requests } = replayingClient(RECORDED.generateDataKey);
    const kms = new AwsKeyManagement({ keyId: "alias/guidesk-restricted", client });

    const generated = await kms.generateDataKey({ workspaceId: WORKSPACE_A });

    expect(requests).toEqual([
      {
        target: "TrentService.GenerateDataKey",
        body: {
          KeyId: "alias/guidesk-restricted",
          KeySpec: "AES_256",
          EncryptionContext: { workspace_id: WORKSPACE_A },
        },
      },
    ]);
    expect(generated.plaintext.toString("base64")).toBe(PLAINTEXT_B64);
    expect(generated.wrapped.toString("base64")).toBe(WRAPPED_B64);
    expect(generated.kmsKeyId).toBe(KEY_ARN);
  });

  it("unwraps a data key with the key ID and the workspace encryption context", async () => {
    const { client, requests } = replayingClient(RECORDED.decrypt);
    const kms = new AwsKeyManagement({ keyId: KEY_ARN, client });

    const plaintext = await kms.decryptDataKey(Buffer.from(WRAPPED_B64, "base64"), {
      workspaceId: WORKSPACE_A,
    });

    expect(requests).toEqual([
      {
        target: "TrentService.Decrypt",
        body: {
          CiphertextBlob: WRAPPED_B64,
          KeyId: KEY_ARN,
          EncryptionContext: { workspace_id: WORKSPACE_A },
        },
      },
    ]);
    expect(plaintext.toString("base64")).toBe(PLAINTEXT_B64);
  });

  it("reports a context mismatch without key material or the SDK error", async () => {
    const { client } = replayingClient(RECORDED.invalidCiphertext);
    const kms = new AwsKeyManagement({ keyId: KEY_ARN, client });

    const error = await kms
      .decryptDataKey(Buffer.from(WRAPPED_B64, "base64"), { workspaceId: WORKSPACE_B })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(KeyManagementError);
    const failure = error as KeyManagementError;
    expect(failure.code).toBe("InvalidCiphertextException");
    expect(failure.message).toBe(
      `KMS Decrypt failed (InvalidCiphertextException, request ${RECORDED.invalidCiphertext.requestId})`,
    );
    // Nothing from the SDK error (request, response, metadata) rides along.
    expect(failure.cause).toBeUndefined();
    expect(Object.keys(failure).sort()).toEqual(["code", "name"]);
  });

  it("keeps provider messages (which name roles and accounts) out of the error", async () => {
    const { client } = replayingClient(RECORDED.accessDenied);
    const kms = new AwsKeyManagement({ keyId: KEY_ARN, client });

    const attempt = kms.decryptDataKey(Buffer.from(WRAPPED_B64, "base64"), {
      workspaceId: WORKSPACE_A,
    });

    await expect(attempt).rejects.toThrow(
      `KMS Decrypt failed (AccessDeniedException, request ${RECORDED.accessDenied.requestId})`,
    );
    await expect(attempt).rejects.not.toThrow("assumed-role");
  });

  it("rejects a response without a complete data key", async () => {
    const { client } = replayingClient({
      ...RECORDED.generateDataKey,
      body: { CiphertextBlob: WRAPPED_B64, KeyId: KEY_ARN },
    });
    const kms = new AwsKeyManagement({ keyId: KEY_ARN, client });

    await expect(kms.generateDataKey({ workspaceId: WORKSPACE_A })).rejects.toThrow(
      "incomplete data key",
    );
  });
});

describe("createKeyManagement", () => {
  it("builds the adapter for the configured KMS mode", () => {
    expect(createKeyManagement({ mode: "local", localKey: randomBytes(32) })).toBeInstanceOf(
      LocalKeyManagement,
    );
    expect(createKeyManagement({ mode: "aws", keyId: KEY_ARN })).toBeInstanceOf(AwsKeyManagement);
  });
});
