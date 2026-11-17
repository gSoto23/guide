import type { FastifyInstance } from "fastify";
import { LocalObjectStorage, type ObjectStoragePort } from "@guidesk/integrations";
import { LOCAL_UPLOAD_PATH } from "./storage.provider.js";

/** A screenshot plus the form fields, with room for multipart framing. */
const MAX_BODY_BYTES = 11 * 1024 * 1024;

/**
 * The development-only stand-in for an S3 presigned POST (T021, STORAGE_MODE=local). It is
 * registered only in local storage mode, inside its own Fastify scope, so multipart bodies are
 * parsed on this route and nowhere else (the API refuses form posts elsewhere, T103). The signed
 * form decides the key, the content type, the size, and the expiry, as an S3 policy would.
 */
export function registerLocalUploadRoute(
  fastify: FastifyInstance,
  storage: ObjectStoragePort,
): void {
  if (!(storage instanceof LocalObjectStorage)) return;
  void fastify.register(async (scope) => {
    scope.addContentTypeParser(
      "multipart/form-data",
      { parseAs: "buffer", bodyLimit: MAX_BODY_BYTES },
      (_request, body, done) => done(null, body),
    );
    scope.post(LOCAL_UPLOAD_PATH, async (request, reply) => {
      const contentType = request.headers["content-type"] ?? "";
      if (!contentType.startsWith("multipart/form-data") || !Buffer.isBuffer(request.body)) {
        return reply.status(400).send({ code: "invalid_upload" });
      }
      let form: FormData;
      try {
        form = await new Response(request.body, {
          headers: { "content-type": contentType },
        }).formData();
      } catch {
        return reply.status(400).send({ code: "invalid_upload" });
      }
      const fields: Record<string, string> = {};
      let file: File | undefined;
      for (const [name, value] of form.entries()) {
        if (typeof value === "string") fields[name] = value;
        else if (name === "file") file = value;
      }
      if (!file) return reply.status(400).send({ code: "invalid_upload" });
      const result = await storage.acceptUpload(fields, {
        contentType: file.type,
        bytes: Buffer.from(await file.arrayBuffer()),
      });
      // S3 answers 204 on success and 403 when the policy refuses the post.
      return result.ok ? reply.status(204).send() : reply.status(403).send({ code: result.reason });
    });
  });
}
