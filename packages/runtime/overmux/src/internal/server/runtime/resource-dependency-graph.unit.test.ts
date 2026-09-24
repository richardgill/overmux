import type { ResourceDefinition } from "../../../public/index";
import { describe, expect, test as testCases } from "vitest";

import {
  createResourceDependencyGraph,
  getInvalidatedResourceIds,
} from "./resource-dependency-graph";

const queryResource = (): ResourceDefinition =>
  ({ kind: "query" }) as ResourceDefinition;

const derivedResource = (
  dependencies: Readonly<Record<string, string>>,
): ResourceDefinition =>
  ({ dependencies, kind: "derived" }) as ResourceDefinition;

const resourcesFor = (
  dependenciesByResource: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, ResourceDefinition>> =>
  Object.fromEntries(
    Object.entries(dependenciesByResource).map(([resourceId, dependencies]) => [
      resourceId,
      dependencies.length
        ? derivedResource(
            Object.fromEntries(
              dependencies.map((dependencyId) => [dependencyId, dependencyId]),
            ),
          )
        : queryResource(),
    ]),
  );

const invalidationCases = [
  {
    changed: "source",
    expected: ["source"],
    name: "returns the changed resource itself",
    resources: resourcesFor({ source: [] }),
  },
  {
    changed: "source",
    expected: ["source", "direct"],
    name: "includes direct dependants",
    resources: resourcesFor({ direct: ["source"], source: [] }),
  },
  {
    changed: "source",
    expected: ["source", "middle", "final"],
    name: "includes transitive dependants",
    resources: resourcesFor({
      final: ["middle"],
      middle: ["source"],
      source: [],
    }),
  },
  {
    changed: "source",
    expected: ["source", "left", "right", "final"],
    name: "deduplicates a dependant reached through a diamond",
    resources: resourcesFor({
      final: ["left", "right"],
      left: ["source"],
      right: ["source"],
      source: [],
    }),
  },
] as const;

const invalidGraphCases = [
  {
    expected: "Unknown resource dependency: missing",
    name: "rejects an unknown dependency",
    resources: {
      derived: derivedResource({ missing: "missing" }),
    },
  },
  {
    expected: "Resource dependency cycle: first -> second -> first",
    name: "rejects a dependency cycle",
    resources: {
      first: derivedResource({ second: "second" }),
      second: derivedResource({ first: "first" }),
    },
  },
  {
    expected: "Resource IDs must not be empty",
    name: "rejects an empty resource ID",
    resources: { "": queryResource() },
  },
  {
    expected: "Resource derived has an empty dependency name",
    name: "rejects an empty dependency name",
    resources: {
      derived: derivedResource({ "": "source" }),
      source: queryResource(),
    },
  },
  {
    expected: "Resource derived has an empty dependency ID",
    name: "rejects an empty dependency ID",
    resources: {
      derived: derivedResource({ source: "" }),
    },
  },
] as const;

describe("resource dependency graph", () => {
  testCases.each(invalidationCases)(
    "$name",
    ({ changed, expected, resources }) => {
      const graph = createResourceDependencyGraph(resources);

      const invalidated = getInvalidatedResourceIds(graph, changed);

      expect(invalidated).toEqual(new Set(expected));
    },
  );

  testCases.each(invalidGraphCases)("$name", ({ expected, resources }) => {
    expect(() => createResourceDependencyGraph(resources)).toThrow(expected);
  });
});
