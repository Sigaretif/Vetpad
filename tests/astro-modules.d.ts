// typescript-eslint does not know the type of a `.astro` import in a `.ts` file and reports
// no-unsafe-argument when a test hands one to the Container API's renderToString.
declare module "*.astro" {
  const component: import("astro/runtime/server/index.js").AstroComponentFactory;
  export default component;
}
