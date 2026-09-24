// Resource invalidation follows relationships among configured resources.
// This model owns those relationships and their invariants before runtime work begins.

import type { ResourceDefinition } from "../../../public/index";

// A dependency supplies a derived resource's value; a dependant consumes that value.
// Keeping both directions makes reads follow dependencies while invalidation follows dependants.
export type ResourceDependencyGraph = Readonly<{
  dependencies: ReadonlyMap<string, ReadonlySet<string>>;
  dependants: ReadonlyMap<string, ReadonlySet<string>>;
}>;

type MutableResourceGraph = Map<string, Set<string>>;

const emptyGraphFor = (resourceIds: readonly string[]): MutableResourceGraph =>
  new Map(resourceIds.map((resourceId) => [resourceId, new Set<string>()]));

const visitDependencies = ({
  dependencies,
  path,
  resourceId,
  visited,
  visiting,
}: {
  dependencies: ReadonlyMap<string, ReadonlySet<string>>;
  path: readonly string[];
  resourceId: string;
  visited: Set<string>;
  visiting: Set<string>;
}) => {
  if (visiting.has(resourceId)) {
    throw new Error(
      `Resource dependency cycle: ${[...path, resourceId].join(" -> ")}`,
    );
  }
  if (visited.has(resourceId)) {
    return;
  }
  visiting.add(resourceId);
  dependencies.get(resourceId)?.forEach((dependencyId) => {
    visitDependencies({
      dependencies,
      path: [...path, resourceId],
      resourceId: dependencyId,
      visited,
      visiting,
    });
  });
  visiting.delete(resourceId);
  visited.add(resourceId);
};

const assertAcyclic = (
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
) => {
  // Derived reads recurse through dependencies, so a cycle could never produce a value or finish activation.
  const visited = new Set<string>();
  const visiting = new Set<string>();
  dependencies.forEach((_, resourceId) => {
    visitDependencies({
      dependencies,
      path: [],
      resourceId,
      visited,
      visiting,
    });
  });
};

export const createResourceDependencyGraph = (
  resources: Readonly<Record<string, ResourceDefinition>>,
): ResourceDependencyGraph => {
  const resourceIds = Object.keys(resources);
  if (resourceIds.some((resourceId) => !resourceId)) {
    throw new Error("Resource IDs must not be empty");
  }
  const dependencies = emptyGraphFor(resourceIds);
  const dependants = emptyGraphFor(resourceIds);

  Object.entries(resources).forEach(([resourceId, resource]) => {
    if (resource.kind !== "derived") {
      return;
    }
    Object.entries(
      resource.dependencies as Readonly<Record<string, string>>,
    ).forEach(([dependencyName, dependencyId]) => {
      if (!dependencyName) {
        throw new Error(`Resource ${resourceId} has an empty dependency name`);
      }
      if (!dependencyId) {
        throw new Error(`Resource ${resourceId} has an empty dependency ID`);
      }
      if (!dependencies.has(dependencyId)) {
        throw new Error(`Unknown resource dependency: ${dependencyId}`);
      }
      dependencies.get(resourceId)?.add(dependencyId);
      dependants.get(dependencyId)?.add(resourceId);
    });
  });

  assertAcyclic(dependencies);
  return Object.freeze({ dependencies, dependants });
};

const collectInvalidatedResourceIds = (
  graph: ResourceDependencyGraph,
  resourceId: string,
  invalidated: Set<string>,
) => {
  if (invalidated.has(resourceId)) {
    return;
  }
  invalidated.add(resourceId);
  graph.dependants.get(resourceId)?.forEach((dependantId) => {
    collectInvalidatedResourceIds(graph, dependantId, invalidated);
  });
};

export const getInvalidatedResourceIds = (
  graph: ResourceDependencyGraph,
  resourceId: string,
): ReadonlySet<string> => {
  // A changed value invalidates itself and the full reverse-edge closure, not just immediate consumers.
  // Set membership is essential for diamonds: a shared dependant must notify once despite multiple paths.
  const invalidated = new Set<string>();
  collectInvalidatedResourceIds(graph, resourceId, invalidated);
  return invalidated;
};
