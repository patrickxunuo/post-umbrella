export function sortRequests(requests) {
  return [...requests].sort((a, b) => {
    const sortA = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const sortB = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (sortA !== sortB) return sortA - sortB;
    return (a.created_at || 0) - (b.created_at || 0);
  });
}

export function upsertCollectionInState(collections, collection) {
  const existing = collections.find((item) => item.id === collection.id);
  const nextCollection = {
    ...existing,
    ...collection,
    requests: existing?.requests || [],
  };

  if (existing) {
    return collections.map((item) => (item.id === collection.id ? nextCollection : item));
  }

  return [...collections, nextCollection].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
}

export function removeCollectionBranch(collections, collectionId) {
  const idsToRemove = new Set([collectionId]);
  let changed = true;

  while (changed) {
    changed = false;
    collections.forEach((collection) => {
      if (collection.parent_id && idsToRemove.has(collection.parent_id) && !idsToRemove.has(collection.id)) {
        idsToRemove.add(collection.id);
        changed = true;
      }
    });
  }

  return collections.filter((collection) => !idsToRemove.has(collection.id));
}

export function upsertRequestInState(collections, request) {
  let existingRequest = null;

  const collectionsWithoutRequest = collections.map((collection) => ({
    ...collection,
    requests: (collection.requests || []).filter((item) => {
      if (item.id === request.id) {
        existingRequest = item;
        return false;
      }
      return true;
    }),
  }));

  return collectionsWithoutRequest.map((collection) => {
    if (collection.id !== request.collection_id) {
      return collection;
    }

    const nextRequest = {
      ...existingRequest,
      ...request,
      example_count: request.example_count ?? existingRequest?.example_count ?? 0,
    };

    return {
      ...collection,
      requests: sortRequests([...(collection.requests || []), nextRequest]),
    };
  });
}

export function removeRequestFromState(collections, requestId) {
  return collections.map((collection) => ({
    ...collection,
    requests: (collection.requests || []).filter((request) => request.id !== requestId),
  }));
}

export function patchRequestInState(collections, requestId, updater) {
  return collections.map((collection) => ({
    ...collection,
    requests: (collection.requests || []).map((request) => (
      request.id === requestId ? updater(request) : request
    )),
  }));
}

export function upsertExampleInList(examples, example) {
  const existing = examples.find((item) => item.id === example.id);
  if (existing) {
    return examples.map((item) => (item.id === example.id ? { ...item, ...example } : item));
  }

  return [example, ...examples].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
}
