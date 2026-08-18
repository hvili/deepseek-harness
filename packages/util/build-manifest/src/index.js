/** The context key under which the launcher provides the build manifest. */
export const DSH_BUILD_MANIFEST_KEY = 'buildManifest';
/** The manifest the launcher provided for this launch, or `undefined` when a composition mounted without one. */
export function buildManifestOf(ctx) {
    return ctx.get(DSH_BUILD_MANIFEST_KEY);
}
//# sourceMappingURL=index.js.map