import configuration from "../access-policy";
import specification from "../catalog/openapi.json";

const routes = Object.entries(specification.paths)
  .map(([path, entry]) => ({
    path,
    operation: entry.get.operationId,
    segments: path.split("/"),
    entry,
  }))
  .sort(
    (first, second) =>
      second.segments.filter((segment) => !segment.startsWith("{")).length -
      first.segments.filter((segment) => !segment.startsWith("{")).length,
  );

export function createAccessPolicy(policy: {
  enabled: boolean;
  allowedOperations: string[];
}) {
  if (
    typeof policy.enabled !== "boolean" ||
    !Array.isArray(policy.allowedOperations) ||
    policy.allowedOperations.some(
      (operation) => !routes.some((route) => route.operation === operation),
    )
  )
    throw new Error(
      "Invalid access-policy.ts: use documented GET operation IDs.",
    );

  const allowed = new Set(policy.allowedOperations);
  return {
    specification: policy.enabled
      ? {
          ...specification,
          paths: Object.fromEntries(
            routes
              .filter((route) => allowed.has(route.operation))
              .map((route) => [route.path, route.entry]),
          ),
        }
      : specification,
    allows(url: URL): boolean {
      if (!policy.enabled) return true;
      let segments: string[];
      try {
        segments = url.pathname.split("/").map(decodeURIComponent);
      } catch {
        return false;
      }
      if (
        segments.some(
          (segment) =>
            /[/\\%?#]/.test(segment) ||
            Array.from(segment).some(
              (character) =>
                character.charCodeAt(0) <= 32 ||
                character.charCodeAt(0) === 127,
            ) ||
            segment === "." ||
            segment === "..",
        )
      )
        return false;
      const matched = routes.find(
        (route) =>
          route.segments.length === segments.length &&
          route.segments.every((segment, index) =>
            segment.startsWith("{")
              ? segments[index].length > 0
              : segment === segments[index],
          ),
      );
      return matched !== undefined && allowed.has(matched.operation);
    },
  };
}

export const accessPolicy = createAccessPolicy(configuration);
