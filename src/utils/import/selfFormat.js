// Post Umbrella's own export shape is Postman v2.1 + a marker field on
// `info._post_umbrella_version`. The marker was only there so shapeCheck could
// distinguish self-exports from third-party Postman files; strip it before
// handing off so the Edge Function sees a plain Postman v2.1 payload.

/** Parse a Post Umbrella export back into Postman v2.1 form. */
export function parse(parsed) {
  const cloned = { ...parsed, info: { ...(parsed.info || {}) } };
  delete cloned.info._post_umbrella_version;
  return { postmanJson: cloned, warnings: [], idMap: undefined };
}
