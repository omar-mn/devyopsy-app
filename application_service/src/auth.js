import { createHash, timingSafeEqual } from "node:crypto";
import { importSPKI, jwtVerify } from "jose";
import { HttpError } from "./errors.js";

export async function createUserAuthentication({
  publicKey,
  issuer,
  audience,
}) {
  const key = await importSPKI(publicKey, "RS256");

  return async (request, _response, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(request.get("authorization") || "");
    if (!match)
      throw new HttpError(
        401,
        "unauthorized",
        "A bearer access token is required.",
      );

    try {
      const { payload } = await jwtVerify(match[1], key, {
        algorithms: ["RS256"],
        issuer,
        audience,
        requiredClaims: ["exp", "user_id", "token_type"],
      });

      // Django SimpleJWT can serialize user_id as a number or a decimal string.
      const rawId = payload.user_id;
      const userId =
        typeof rawId === "string" && /^[1-9]\d*$/.test(rawId)
          ? Number(rawId)
          : rawId;
      if (
        !Number.isInteger(userId) ||
        userId < 1 ||
        userId > 2147483647 ||
        payload.token_type !== "access"
      ) {
        throw new Error("Invalid identity claims");
      }
      request.auth = { userId };
    } catch {
      throw new HttpError(
        401,
        "invalid_token",
        "The access token is invalid or expired.",
      );
    }
    next();
  };
}

export function createServiceAuthentication(token) {
  const expected = createHash("sha256").update(token).digest();
  return (request, _response, next) => {
    const supplied = /^Bearer ([^\s]+)$/i.exec(
      request.get("authorization") || "",
    )?.[1];
    const actual = createHash("sha256")
      .update(supplied || "")
      .digest();
    if (!supplied || !timingSafeEqual(actual, expected)) {
      throw new HttpError(
        401,
        "invalid_service_token",
        "A valid Build Service token is required.",
      );
    }
    next();
  };
}
