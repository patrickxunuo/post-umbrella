// Postman parser — identity passthrough. The Edge Function accepts both v2.0
// and v2.1 shapes (the `item[]` tree is the same in practice for the fields we
// care about), so there's no up-conversion step required at this layer.

/** Parse a Postman v2.0 / v2.1 export into the shape we send to importCollection. */
export function parse(parsed) {
  return { postmanJson: parsed, warnings: [], idMap: undefined };
}
