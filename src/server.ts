import { Hono } from "hono";
import type { AirlockConfig, Platform, UpdateContext } from "./types";
import {
  buildMultipartResponse,
  buildNoUpdateResponse,
} from "./manifest";
import { isInRollout } from "./rollout";
import { signManifest } from "./crypto";

export function createAirlock(config: AirlockConfig) {
  const app = new Hono();

  app.get("/manifest", async (c) => {
    const platform = (c.req.header("expo-platform") ??
      c.req.query("platform")) as Platform | undefined;
    const runtimeVersion =
      c.req.header("expo-runtime-version") ?? c.req.query("runtimeVersion");
    const channel =
      c.req.header("expo-channel-name") ??
      c.req.query("channel") ??
      "default";
    const currentUpdateId =
      c.req.header("expo-current-update-id") ?? null;

    if (!platform || !runtimeVersion) {
      return c.json(
        { error: "Missing expo-platform or expo-runtime-version" },
        400
      );
    }

    const update = await config.adapter.getLatestUpdate(
      channel,
      runtimeVersion,
      platform
    );

    if (!update) return buildNoUpdateResponse();

    // Already on this update
    if (currentUpdateId && update.manifest.id === currentUpdateId) {
      return buildNoUpdateResponse();
    }

    // Rollout check — use expo-eas-client-id as stable device identifier
    const deviceId =
      c.req.header("expo-eas-client-id") ??
      c.req.header("eas-client-id") ??
      "anonymous";

    if (update.rolloutPercentage < 100) {
      const inRollout = await isInRollout(
        deviceId,
        update.manifest.id,
        update.rolloutPercentage
      );
      if (!inRollout) return buildNoUpdateResponse();
    }

    // resolveUpdate hook
    const ctx: UpdateContext = {
      channel,
      runtimeVersion,
      platform,
      headers: Object.fromEntries(
        [...c.req.raw.headers.entries()]
      ),
      currentUpdateId,
    };

    let resolved = config.resolveUpdate
      ? await config.resolveUpdate(update, ctx)
      : update;

    if (!resolved) return buildNoUpdateResponse();

    // Code signing
    let signature: string | undefined;
    if (config.signingKey) {
      signature = await signManifest(
        JSON.stringify(resolved.manifest),
        config.signingKey
      );
    }

    return buildMultipartResponse(resolved.manifest, { signature });
  });

  app.get("/assets/:hash", async (c) => {
    const hash = c.req.param("hash");
    const url = await config.adapter.getAssetUrl(hash);
    if (!url) return c.notFound();
    return c.redirect(url);
  });

  return { routes: app };
}
