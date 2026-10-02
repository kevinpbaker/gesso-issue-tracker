declare module 'commonmark-spec' {
  const spec: { readonly tests: readonly { markdown: string; html: string; section: string; number: number }[] };
  export default spec;
}
