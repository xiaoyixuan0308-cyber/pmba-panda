/**
 * Mock asset registry. Behaviour is driven by two demo settings so that the
 * failure paths of FUS5 (AC2, AC3) can be shown on demand:
 *   registryAvailable    "false" → every call fails as if the registry were down
 *   registryInvalidTags  comma-separated tags that fail verification
 */
import type { Db } from "@/db/open";
import { getSetting } from "@/domain/settings";
import { RegistryUnavailableError, type AssetRegistry } from "./index";

export function mockRegistry(db: Db): AssetRegistry {
  return {
    label: "模拟数据",
    verifyAssetTag(assetTag) {
      if (getSetting(db, "registryAvailable") !== "true") throw new RegistryUnavailableError();
      const invalid = getSetting(db, "registryInvalidTags").split(",").map((t) => t.trim()).filter(Boolean);
      return invalid.includes(assetTag)
        ? { assetTag, valid: false, reason: "资产登记系统中的标签与实物不符" }
        : { assetTag, valid: true };
    },
  };
}
